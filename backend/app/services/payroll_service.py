import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from app.database import get_collection, fix_id, fix_ids
from app.config import settings
from app.services.calculation_engine import CalculationEngine
from app.services.advance_loan_service import AdvanceLoanService
from app.services.audit_service import AuditService
from app.services import sales_payroll
from app.services.pdf_service import PDFService
from app.utils.validators import MONTH_NAMES, require_month_name, search_pattern
from app.schemas.advanced_payroll import (
    SinglePayrollCalculationRequest,
    BulkPayrollRunRequest,
    PayrollEditRequest
)

logger = logging.getLogger("rexera.payroll")


def _advance_start(adv: Dict[str, Any]) -> Tuple[int, int]:
    """(year, month number) an advance's recovery starts in; unknown -> recover immediately."""
    try:
        return int(adv.get("start_year")), MONTH_NAMES.index(require_month_name(adv.get("start_month"))) + 1
    except (TypeError, ValueError):
        return (0, 0)


class PayrollService:
    # ==========================================
    # 1. SALARY STRUCTURES
    # ==========================================
    @classmethod
    async def get_or_create_salary_structure(cls, employee_id: str) -> Dict[str, Any]:
        emp_col = get_collection("employees")
        struct_col = get_collection("salary_structures")

        emp = await emp_col.find_one({"_id": employee_id})
        if not emp:
            raise ValueError(f"Employee {employee_id} not found.")

        struct = await struct_col.find_one({"employee_id": employee_id, "is_active": True})
        if not struct:
            # Generate default structure from employee record
            base = float(emp.get("base_salary", 0.0))
            hra = float(emp.get("hra", 0.0))
            conv = float(emp.get("conveyance_allowance", 0.0))
            spec = float(emp.get("special_allowance", 0.0))
            now_str = datetime.utcnow().isoformat()

            doc = {
                "employee_id": employee_id,
                "employee_code": emp.get("employee_code", ""),
                "employee_name": emp.get("full_name", ""),
                "department": emp.get("department", ""),
                "designation": emp.get("designation", ""),
                "salary_type": "monthly",
                "base_salary": base,
                "hra_type": "fixed",
                "hra_value": hra,
                "conveyance_allowance": conv,
                "medical_allowance": 0.0,
                "special_allowance": spec,
                "other_allowances": 0.0,
                "pf_opted": emp.get("pf_opted", True),
                "pf_type": "percentage_12",
                "pf_fixed_amount": 0.0,
                "esi_opted": False,
                "esi_percentage": 0.75,
                "professional_tax": float(emp.get("professional_tax", 200.0)),
                "tds_percentage": 0.0,
                "overtime_rate_per_hour": 0.0,
                "is_active": True,
                "created_at": now_str,
                "updated_at": now_str
            }
            res = await struct_col.insert_one(doc)
            doc["id"] = str(res.inserted_id)
            doc["_id"] = str(res.inserted_id)
            return doc

        return fix_id(struct)

    @staticmethod
    def to_legacy_slip_format(doc: Dict[str, Any]) -> Dict[str, Any]:
        """
        Adapts a payroll/payslip record produced by the advanced (nested) calculation
        engine into the flat shape expected by the legacy SalarySlipResponse schema.
        """
        mapped = dict(doc)
        attendance = doc.get("attendance") or {}
        earnings = doc.get("earnings") or {}
        deductions = doc.get("deductions") or {}

        mapped.setdefault("working_days", int(attendance.get("working_days", 30)))
        mapped.setdefault("paid_days", attendance.get("present_days", attendance.get("working_days", 30)))
        mapped.setdefault("lop_days", attendance.get("unpaid_leave_days", 0))

        if earnings:
            mapped["earnings"] = {
                "basic": earnings.get("basic", 0.0),
                "hra": earnings.get("hra", 0.0),
                "conveyance": earnings.get("conveyance", 0.0),
                "special_allowance": earnings.get("special_allowance", 0.0),
                "bonus": earnings.get("bonus", 0.0) + earnings.get("incentive", 0.0),
                "other_allowances": (
                    earnings.get("other_allowances", 0.0)
                    + earnings.get("medical", 0.0)
                    + earnings.get("other_earnings", 0.0)
                    + earnings.get("manual_adjustments", 0.0)
                ),
                "gross_earnings": earnings.get("gross_salary", doc.get("gross_salary", 0.0)),
            }

        if deductions:
            mapped["deductions"] = {
                "pf": deductions.get("pf", 0.0),
                "pt": deductions.get("professional_tax", deductions.get("pt", 0.0)),
                "tds": deductions.get("tds", 0.0),
                "lop_deduction": deductions.get("unpaid_leave_deduction", deductions.get("lop_deduction", 0.0)),
                "other_deductions": (
                    deductions.get("other_deductions", 0.0)
                    + deductions.get("esi", 0.0)
                    + deductions.get("late_deduction", 0.0)
                    + deductions.get("salary_advance_deduction", 0.0)
                    + deductions.get("loan_deduction", 0.0)
                    + deductions.get("manual_adjustments", 0.0)
                ),
                "gross_deductions": deductions.get("total_deductions", doc.get("total_deductions", 0.0)),
            }

        mapped.setdefault("slip_number", doc.get("payslip_number", ""))
        mapped.setdefault("payment_status", "Pending")
        mapped.setdefault("created_at", doc.get("created_at", ""))
        mapped.setdefault("date_of_joining", doc.get("joining_date", ""))
        return mapped

    @classmethod
    def calculate_salary_components(cls, req) -> Dict[str, Any]:
        """
        Legacy lightweight salary calculator (flat request, no employee/attendance lookup).
        Delegates to the shared CalculationEngine for consistent, decimal-safe statutory math.
        """
        salary_structure = {
            "base_salary": req.base_salary,
            "hra_type": "fixed",
            "hra_value": req.hra,
            "conveyance_allowance": req.conveyance_allowance,
            "medical_allowance": 0.0,
            "special_allowance": req.special_allowance,
            "other_allowances": 0.0,
            "pf_opted": req.pf_opted,
            "pf_type": "percentage_12",
            "esi_opted": False,
            "professional_tax": req.professional_tax,
            "tds_percentage": 0.0,
            "other_deductions": req.other_deductions,
        }
        attendance = {
            "working_days": req.working_days,
            "unpaid_leave_days": req.lop_days,
            "absent_days": 0,
            "half_days": 0,
            "overtime_hours": 0,
            "late_count": 0,
        }
        approved_bonuses = [{"amount": req.bonus, "type": "Bonus"}] if req.bonus else []

        result = CalculationEngine.calculate_full_payroll(
            salary_structure, attendance, approved_bonuses=approved_bonuses
        )

        return {
            "earnings": {
                "basic": result["earnings"]["basic"],
                "hra": result["earnings"]["hra"],
                "conveyance": result["earnings"]["conveyance"],
                "special_allowance": result["earnings"]["special_allowance"],
                "bonus": result["earnings"]["bonus"] + result["earnings"]["incentive"],
                "other_allowances": result["earnings"]["other_allowances"],
                "gross_earnings": result["earnings"]["gross_salary"],
            },
            "deductions": {
                "pf": result["deductions"]["pf"],
                "pt": result["deductions"]["professional_tax"],
                "tds": result["deductions"]["tds"],
                "lop_deduction": result["deductions"]["unpaid_leave_deduction"],
                "other_deductions": result["deductions"]["other_deductions"],
                "gross_deductions": result["deductions"]["total_deductions"],
            },
            "gross_salary": result["gross_salary"],
            "net_salary": result["net_salary"],
            "net_salary_words": result["net_salary_words"],
        }

    @classmethod
    async def update_salary_structure(cls, employee_id: str, updates: Dict[str, Any], user_email: str = "admin") -> Dict[str, Any]:
        struct_col = get_collection("salary_structures")
        struct = await cls.get_or_create_salary_structure(employee_id)
        now_str = datetime.utcnow().isoformat()

        clean_updates = {k: v for k, v in updates.items() if v is not None}
        clean_updates["updated_at"] = now_str

        await struct_col.update_one({"_id": struct["_id"]}, {"$set": clean_updates})
        
        await AuditService.log_action(
            user_email=user_email,
            user_role="admin",
            action="Updated Salary Structure",
            entity_type="salary_structure",
            entity_id=str(struct["_id"]),
            employee_name=struct.get("employee_name"),
            old_value=struct,
            new_value=clean_updates
        )

        updated = await struct_col.find_one({"_id": struct["_id"]})
        return fix_id(updated)

    # ==========================================
    # 2. CALCULATION & WORKFLOW ENGINE
    # ==========================================
    @classmethod
    async def calculate_employee_payroll(
        cls,
        req: SinglePayrollCalculationRequest,
        save_record: bool = False,
        status: str = "CALCULATED",
        user_email: str = "admin"
    ) -> Dict[str, Any]:
        """
        Executes end-to-end payroll calculation for a single employee for a given month and year.
        If save_record is True, creates or updates the active payroll record in the database.
        """
        emp_col = get_collection("employees")
        payroll_col = get_collection("payrolls")
        bonus_col = get_collection("bonuses")
        ot_col = get_collection("overtime")

        emp = await emp_col.find_one({"_id": req.employee_id})
        if not emp:
            raise ValueError(f"Employee {req.employee_id} not found.")

        # 1. Salary Structure
        structure = await cls.get_or_create_salary_structure(req.employee_id)

        month_no = MONTH_NAMES.index(req.month) + 1

        # 2. Attendance Data: from the employee's Start Day / End Day punches (and approved leave) unless the
        # request states attendance itself, which then wins.
        derived = None
        if all(v is None for v in (req.working_days, req.present_days, req.paid_leave_days, req.unpaid_leave_days, req.half_days, req.late_count)):
            derived = await sales_payroll.month_attendance(emp, req.year, month_no)
        d = derived or {}
        working_days = req.working_days or d.get("working_days") or 30
        present_in = req.present_days if req.present_days is not None else d.get("present_days")
        present_days = present_in if present_in is not None else float(working_days)
        paid_leave = req.paid_leave_days or d.get("paid_leave_days", 0.0)
        unpaid_leave = req.unpaid_leave_days or d.get("unpaid_leave_days", 0.0)
        half_days = req.half_days or d.get("half_days", 0)
        absent_days = (working_days - present_days - paid_leave - unpaid_leave) if present_in is not None else 0.0
        absent_days = max(0.0, absent_days)
        late_count = req.late_count or d.get("late_count", 0)
        overtime_hours = req.overtime_hours or 0.0

        attendance_dict = {
            "calendar_days": 30,
            "working_days": working_days,
            "present_days": present_days,
            "paid_leave_days": paid_leave,
            "unpaid_leave_days": unpaid_leave,
            "half_days": half_days,
            "absent_days": absent_days,
            "holidays": 0,
            "weekly_offs": d.get("weekly_offs", 4),
            "late_count": late_count,
            "overtime_hours": overtime_hours
        }

        # 3. Active Advances & Loans whose recovery has started by this payroll month
        period = (req.year, month_no)
        month_prefix = f"{req.year}-{month_no:02d}"
        active_advances = [
            a for a in await AdvanceLoanService.get_active_advances_for_employee(req.employee_id)
            if _advance_start(a) <= period
        ]
        active_loans = [
            l for l in await AdvanceLoanService.get_active_loans_for_employee(req.employee_id)
            if str(l.get("start_date") or "")[:7] <= month_prefix
        ]

        # 4. Approved Bonuses & Overtime for this payroll month (or request overrides)
        db_bonuses = await bonus_col.find({
            "employee_id": req.employee_id,
            "month": req.month,
            "year": req.year,
            "status": "Approved"
        }).to_list(1000)

        # Only overtime worked in this month: without the date filter every past entry was paid again every month.
        db_overtime = await ot_col.find({
            "employee_id": req.employee_id,
            "status": "Approved",
            "date": {"$regex": f"^{month_prefix}-"},
        }).to_list(1000)

        # If direct bonus override provided in request, inject it
        if req.bonus_amount and req.bonus_amount > 0:
            db_bonuses.append({"amount": req.bonus_amount, "type": "Performance Bonus"})
        # Sales collection incentive is worked out from client payments unless HR types an amount in.
        incentive_details = None
        if req.incentive_amount is None:
            incentive_details = await sales_payroll.month_incentive(emp, structure, req.year, month_no)
            if incentive_details and incentive_details["incentive"] > 0:
                db_bonuses.append({"amount": incentive_details["incentive"], "type": "Sales Incentive"})
        elif req.incentive_amount > 0:
            db_bonuses.append({"amount": req.incentive_amount, "type": "Sales Incentive"})

        manual_adjs = [m.model_dump() for m in (req.manual_adjustments or [])]

        # One-off amounts from the request (e.g. the payslip form's "other deductions") reach the engine
        # through the structure; they used to be dropped silently.
        structure = {**structure,
                     "other_earnings": float(req.other_earnings or 0.0),
                     "other_deductions": float(req.other_deductions or 0.0)}

        # 5. Run Calculation Engine
        calc_result = CalculationEngine.calculate_full_payroll(
            salary_structure=structure,
            attendance=attendance_dict,
            advances=active_advances,
            loans=active_loans,
            approved_bonuses=db_bonuses,
            approved_overtime=db_overtime,
            manual_adjustments=manual_adjs,
            advance_override=req.advance_deduction_override,
            loan_override=req.loan_deduction_override
        )

        payroll_id = f"REX-PAY-{req.year}{req.month[:3].upper()}-{emp.get('employee_code', 'EMP')}"
        now_str = datetime.utcnow().isoformat()

        record = {
            "payroll_id": payroll_id,
            "employee_id": str(emp["_id"]),
            "employee_code": emp.get("employee_code", ""),
            "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""),
            "designation": emp.get("designation", ""),
            "joining_date": emp.get("date_of_joining", ""),
            "bank_name": emp.get("bank_name", ""),
            "account_no": emp.get("account_no", ""),
            "ifsc_code": emp.get("ifsc_code", ""),
            "pan_number": emp.get("pan_number", ""),
            "email": emp.get("email", ""),
            "month": req.month,
            "year": req.year,
            "revision_number": 1,
            "status": status,
            "attendance": attendance_dict,
            "earnings": calc_result["earnings"],
            "deductions": calc_result["deductions"],
            "gross_salary": calc_result["gross_salary"],
            "total_deductions": calc_result["total_deductions"],
            "net_salary": calc_result["net_salary"],
            "net_salary_words": calc_result["net_salary_words"],
            "currency": "INR",
            "advances_deducted": calc_result["advances_deducted"],
            "loans_deducted": calc_result["loans_deducted"],
            "manual_adjustments": manual_adjs,
            "is_locked": False,
            "locked_by": None,
            "locked_at": None,
            "approved_by": None,
            "approved_at": None,
            "payment_status": "Pending",
            "payment_date": None,
            "payment_reference": None,
            "payment_method": "Bank Transfer",
            "payslip_generated": False,
            "payslip_id": None,
            "payslip_number": f"REX-PAY-{req.year}{req.month[:3].upper()}-{emp.get('employee_code', 'EMP')}",
            "email_sent": False,
            "email_sent_at": None,
            "remarks": req.remarks or "",
            "incentive_details": incentive_details,
            "attendance_source": "start_end_day" if derived else "manual",
            "created_at": now_str,
            "updated_at": now_str
        }

        if save_record:
            # Check existing
            existing = await payroll_col.find_one({
                "employee_id": str(emp["_id"]),
                "month": req.month,
                "year": req.year
            })
            if existing:
                if existing.get("is_locked", False) or existing.get("status") in ("FINALIZED", "PAID"):
                    raise ValueError(f"Payroll for {emp.get('full_name')} for {req.month} {req.year} is FINALIZED and locked. Unlock before recalculating.")
                # A recalculation is a new revision of the same record, not a brand-new one.
                record["revision_number"] = existing.get("revision_number", 1)
                record["created_at"] = existing.get("created_at", now_str)
                await payroll_col.update_one({"_id": existing["_id"]}, {"$set": record})
                record["_id"] = str(existing["_id"])
                record["id"] = str(existing["_id"])
            else:
                res = await payroll_col.insert_one(record)
                record["_id"] = str(res.inserted_id)
                record["id"] = str(res.inserted_id)

            await AuditService.log_action(
                user_email=user_email,
                user_role="admin",
                action="Calculated Payroll",
                entity_type="payroll",
                entity_id=record["_id"],
                employee_name=emp.get("full_name"),
                new_value={"net_salary": record["net_salary"]}
            )

        return record

    @classmethod
    async def run_advanced_bulk_payroll(cls, req: BulkPayrollRunRequest, user_email: str = "admin") -> Dict[str, Any]:
        """
        Batch executes payroll calculation for selected or all active employees.
        Provides detailed status breakdown, success/failure counts and diagnostic failure reasons.
        """
        emp_col = get_collection("employees")
        query = {"employee_status": "Active"}
        if req.department and req.department.lower() != "all":
            query["department"] = req.department

        employees = await emp_col.find(query).to_list(1000)
        if req.employee_ids:
            employees = [e for e in employees if str(e["_id"]) in req.employee_ids or e.get("employee_code") in req.employee_ids]

        total = len(employees)
        successful = []
        failed = []

        target_status = "APPROVED" if req.auto_approve else "CALCULATED"

        for emp in employees:
            emp_id = str(emp["_id"])
            emp_name = emp.get("full_name", "Unknown")
            emp_code = emp.get("employee_code", "")

            try:
                # Check salary structure
                struct = await cls.get_or_create_salary_structure(emp_id)
                if not struct or struct.get("base_salary", 0) <= 0:
                    raise ValueError("Basic salary is ₹0 or salary structure is incomplete.")

                calc_req = SinglePayrollCalculationRequest(
                    employee_id=emp_id,
                    month=req.month,
                    year=req.year
                )
                rec = await cls.calculate_employee_payroll(
                    req=calc_req,
                    save_record=True,
                    status=target_status,
                    user_email=user_email
                )
                successful.append({
                    "employee_id": emp_id,
                    "employee_code": emp_code,
                    "employee_name": emp_name,
                    "net_salary": rec["net_salary"],
                    "status": rec["status"]
                })
            except Exception as e:
                err_msg = str(e)
                logger.warning(f"Payroll generation failed for {emp_code} - {emp_name}: {err_msg}")
                failed.append({
                    "employee_id": emp_id,
                    "employee_code": emp_code,
                    "employee_name": emp_name,
                    "reason": err_msg
                })

        return {
            "success": True,
            "total_processed": total,
            "successful_count": len(successful),
            "failed_count": len(failed),
            "month": req.month,
            "year": req.year,
            "successful": successful,
            "failed": failed
        }

    # ==========================================
    # 3. EDIT, APPROVE, FINALIZE & LOCK WORKFLOWS
    # ==========================================
    @classmethod
    async def edit_payroll_record(cls, payroll_id: str, edits: PayrollEditRequest, user_email: str = "admin") -> Dict[str, Any]:
        payroll_col = get_collection("payrolls")
        rec = await payroll_col.find_one({"_id": payroll_id})
        if not rec:
            raise ValueError(f"Payroll record {payroll_id} not found.")

        if rec.get("is_locked", False) or rec.get("status") in ["FINALIZED", "PAID"]:
            raise ValueError("This payroll record is FINALIZED and locked. It must be unlocked before editing.")

        # Recompute earnings & deductions
        earnings = dict(rec.get("earnings", {}))
        deductions = dict(rec.get("deductions", {}))

        if edits.basic is not None: earnings["basic"] = float(edits.basic)
        if edits.hra is not None: earnings["hra"] = float(edits.hra)
        if edits.conveyance is not None: earnings["conveyance"] = float(edits.conveyance)
        if edits.medical is not None: earnings["medical"] = float(edits.medical)
        if edits.special_allowance is not None: earnings["special_allowance"] = float(edits.special_allowance)
        if edits.other_allowances is not None: earnings["other_allowances"] = float(edits.other_allowances)
        if edits.overtime_pay is not None: earnings["overtime_pay"] = float(edits.overtime_pay)
        if edits.bonus is not None: earnings["bonus"] = float(edits.bonus)
        if edits.incentive is not None: earnings["incentive"] = float(edits.incentive)
        if edits.other_earnings is not None: earnings["other_earnings"] = float(edits.other_earnings)

        if edits.pf is not None: deductions["pf"] = float(edits.pf)
        if edits.esi is not None: deductions["esi"] = float(edits.esi)
        if edits.professional_tax is not None: deductions["professional_tax"] = float(edits.professional_tax)
        if edits.tds is not None: deductions["tds"] = float(edits.tds)
        if edits.unpaid_leave_deduction is not None: deductions["unpaid_leave_deduction"] = float(edits.unpaid_leave_deduction)
        if edits.late_deduction is not None: deductions["late_deduction"] = float(edits.late_deduction)
        if edits.salary_advance_deduction is not None: deductions["salary_advance_deduction"] = float(edits.salary_advance_deduction)
        if edits.loan_deduction is not None: deductions["loan_deduction"] = float(edits.loan_deduction)
        if edits.other_deductions is not None: deductions["other_deductions"] = float(edits.other_deductions)

        # Manual adjustments if supplied
        if edits.manual_adjustments is not None:
            manual_list = [m.model_dump() for m in edits.manual_adjustments]
            earnings["manual_adjustments"] = sum(m["amount"] for m in manual_list if m["type"] == "earning")
            deductions["manual_adjustments"] = sum(m["amount"] for m in manual_list if m["type"] == "deduction")
            rec["manual_adjustments"] = manual_list

        gross_salary = round(
            earnings.get("basic", 0) +
            earnings.get("hra", 0) +
            earnings.get("conveyance", 0) +
            earnings.get("medical", 0) +
            earnings.get("special_allowance", 0) +
            earnings.get("other_allowances", 0) +
            earnings.get("overtime_pay", 0) +
            earnings.get("bonus", 0) +
            earnings.get("incentive", 0) +
            earnings.get("other_earnings", 0) +
            earnings.get("manual_adjustments", 0),
            2
        )
        earnings["gross_salary"] = gross_salary

        total_deductions = round(
            deductions.get("pf", 0) +
            deductions.get("esi", 0) +
            deductions.get("professional_tax", 0) +
            deductions.get("tds", 0) +
            deductions.get("unpaid_leave_deduction", 0) +
            deductions.get("late_deduction", 0) +
            deductions.get("salary_advance_deduction", 0) +
            deductions.get("loan_deduction", 0) +
            deductions.get("other_deductions", 0) +
            deductions.get("manual_adjustments", 0),
            2
        )
        deductions["total_deductions"] = total_deductions

        net_salary = max(0.0, round(gross_salary - total_deductions, 2))
        words = PDFService._amount_words(net_salary) if hasattr(PDFService, '_amount_words') else CalculationEngine._to_decimal(net_salary)
        from app.utils.number_to_words import amount_to_words
        words = amount_to_words(net_salary)

        now_str = datetime.utcnow().isoformat()
        update_data = {
            "earnings": earnings,
            "deductions": deductions,
            "gross_salary": gross_salary,
            "total_deductions": total_deductions,
            "net_salary": net_salary,
            "net_salary_words": words,
            "status": "UNDER_REVIEW",
            "remarks": edits.remarks or rec.get("remarks", ""),
            "updated_at": now_str
        }
        if "manual_adjustments" in rec:
            update_data["manual_adjustments"] = rec["manual_adjustments"]

        await payroll_col.update_one({"_id": rec["_id"]}, {"$set": update_data})

        await AuditService.log_action(
            user_email=user_email,
            user_role="admin",
            action="Edited Payroll",
            entity_type="payroll",
            entity_id=payroll_id,
            employee_name=rec.get("employee_name"),
            old_value={"net_salary": rec.get("net_salary")},
            new_value={"net_salary": net_salary}
        )

        updated = await payroll_col.find_one({"_id": rec["_id"]})
        return fix_id(updated)

    @classmethod
    async def approve_payroll(cls, payroll_id: str, user_email: str = "admin") -> Dict[str, Any]:
        payroll_col = get_collection("payrolls")
        rec = await payroll_col.find_one({"_id": payroll_id})
        if not rec:
            raise ValueError(f"Payroll record {payroll_id} not found.")
        if rec.get("is_locked") or rec.get("status") in ("FINALIZED", "PAID"):
            raise ValueError(f"This payroll is already {rec.get('status', 'FINALIZED')}; unlock it before re-approving.")

        now_str = datetime.utcnow().isoformat()
        await payroll_col.update_one(
            {"_id": rec["_id"]},
            {"$set": {
                "status": "APPROVED",
                "approved_by": user_email,
                "approved_at": now_str,
                "updated_at": now_str
            }}
        )
        await AuditService.log_action(
            user_email=user_email,
            user_role="admin",
            action="Approved Payroll",
            entity_type="payroll",
            entity_id=payroll_id,
            employee_name=rec.get("employee_name")
        )
        updated = await payroll_col.find_one({"_id": rec["_id"]})
        return fix_id(updated)

    @classmethod
    async def finalize_payroll(cls, payroll_id: str, user_email: str = "superadmin") -> Dict[str, Any]:
        """
        Finalizes and locks the payroll. Commits advance recoveries and loan EMIs to their ledgers.
        Generates and links the official payslip record.
        """
        payroll_col = get_collection("payrolls")
        slip_col = get_collection("salary_slips")

        rec = await payroll_col.find_one({"_id": payroll_id})
        if not rec:
            raise ValueError(f"Payroll record {payroll_id} not found.")

        if rec.get("is_locked", False):
            return fix_id(rec)

        now_str = datetime.utcnow().isoformat()
        m = rec.get("month", "September")
        y = int(rec.get("year", 2026))

        # 1. Commit Advance Repayments (at most once per payroll: a re-finalize after an unlock must
        #    not recover the same installment twice)
        advances_deducted = rec.get("advances_deducted") or []
        for adv in advances_deducted:
            adv_db_id = adv.get("advance_db_id")
            amt = adv.get("deducted_amount", 0.0)
            if adv_db_id and amt > 0 and not await AdvanceLoanService.is_committed("advance_transactions", "advance_db_id", adv_db_id, payroll_id):
                await AdvanceLoanService.record_advance_repayment(
                    advance_db_id=adv_db_id,
                    deducted_amount=amt,
                    payroll_id=payroll_id,
                    month=m,
                    year=y
                )

        # 2. Commit Loan EMI Repayments
        loans_deducted = rec.get("loans_deducted") or []
        for loan in loans_deducted:
            loan_db_id = loan.get("loan_db_id")
            amt = loan.get("deducted_amount", 0.0)
            if loan_db_id and amt > 0 and not await AdvanceLoanService.is_committed("loan_transactions", "loan_db_id", loan_db_id, payroll_id):
                await AdvanceLoanService.record_loan_repayment(
                    loan_db_id=loan_db_id,
                    deducted_amount=amt,
                    payroll_id=payroll_id,
                    month=m,
                    year=y
                )

        # 3. Create or Update Official Payslip
        slip_doc = {
            "slip_number": rec.get("payslip_number") or f"REX-PAY-{y}{m[:3].upper()}-{rec.get('employee_code', 'EMP')}",
            "payroll_id": str(rec["_id"]),
            "employee_id": rec.get("employee_id"),
            "employee_code": rec.get("employee_code"),
            "employee_name": rec.get("employee_name"),
            "department": rec.get("department"),
            "designation": rec.get("designation"),
            "bank_name": rec.get("bank_name"),
            "account_no": rec.get("account_no"),
            "ifsc_code": rec.get("ifsc_code"),
            "pan_number": rec.get("pan_number"),
            "month": m,
            "year": y,
            "attendance": rec.get("attendance", {}),
            "earnings": rec.get("earnings", {}),
            "deductions": rec.get("deductions", {}),
            "gross_salary": rec.get("gross_salary", 0.0),
            "total_deductions": rec.get("total_deductions", 0.0),
            "net_salary": rec.get("net_salary", 0.0),
            "net_salary_words": rec.get("net_salary_words", ""),
            "payment_status": "Pending",
            "created_at": now_str
        }

        # Check existing slip
        existing_slip = await slip_col.find_one({"payroll_id": str(rec["_id"])})
        if existing_slip:
            await slip_col.update_one({"_id": existing_slip["_id"]}, {"$set": slip_doc})
            slip_id = str(existing_slip["_id"])
        else:
            slip_res = await slip_col.insert_one(slip_doc)
            slip_id = str(slip_res.inserted_id)

        # 4. Lock Payroll
        await payroll_col.update_one(
            {"_id": rec["_id"]},
            {"$set": {
                "status": "FINALIZED",
                "is_locked": True,
                "locked_by": user_email,
                "locked_at": now_str,
                "payslip_generated": True,
                "payslip_id": slip_id,
                "updated_at": now_str
            }}
        )

        await AuditService.log_action(
            user_email=user_email,
            user_role="superadmin",
            action="Finalized & Locked Payroll",
            entity_type="payroll",
            entity_id=payroll_id,
            employee_name=rec.get("employee_name")
        )

        updated = await payroll_col.find_one({"_id": rec["_id"]})
        return fix_id(updated)

    @classmethod
    async def unlock_payroll(cls, payroll_id: str, reason: str, user_email: str = "superadmin") -> Dict[str, Any]:
        """
        Unlocks a finalized payroll record for administrative corrections. Records audit trail and creates revision entry.
        """
        payroll_col = get_collection("payrolls")
        rev_col = get_collection("payroll_revisions")

        rec = await payroll_col.find_one({"_id": payroll_id})
        if not rec:
            raise ValueError(f"Payroll record {payroll_id} not found.")
        if not (rec.get("is_locked") or rec.get("status") in ("FINALIZED", "PAID")):
            raise ValueError("Only a finalized payroll can be unlocked.")

        now_str = datetime.utcnow().isoformat()
        current_rev = rec.get("revision_number", 1)

        # Give back the advance/loan recoveries this payroll committed; re-finalizing commits
        # whatever the corrected record deducts.
        await AdvanceLoanService.reverse_payroll_recoveries(payroll_id)

        # Archive current state as Revision
        rev_doc = dict(rec)
        rev_doc.pop("_id", None)
        rev_doc["original_payroll_id"] = str(rec["_id"])
        rev_doc["unlocked_by"] = user_email
        rev_doc["unlock_reason"] = reason
        rev_doc["unlocked_at"] = now_str
        await rev_col.insert_one(rev_doc)

        # Unlock and set to UNDER_REVIEW with incremented revision number
        await payroll_col.update_one(
            {"_id": rec["_id"]},
            {"$set": {
                "status": "UNDER_REVIEW",
                "is_locked": False,
                "locked_by": None,
                "locked_at": None,
                "revision_number": current_rev + 1,
                "updated_at": now_str
            }}
        )

        await AuditService.log_action(
            user_email=user_email,
            user_role="superadmin",
            action="Unlocked Payroll",
            entity_type="payroll",
            entity_id=payroll_id,
            employee_name=rec.get("employee_name"),
            old_value={"revision": current_rev},
            new_value={"reason": reason, "new_revision": current_rev + 1}
        )

        updated = await payroll_col.find_one({"_id": rec["_id"]})
        return fix_id(updated)

    @classmethod
    async def mark_payroll_paid(cls, payroll_id: str, payment_ref: Optional[str] = None, user_email: str = "admin") -> Dict[str, Any]:
        payroll_col = get_collection("payrolls")
        slip_col = get_collection("salary_slips")

        rec = await payroll_col.find_one({"_id": payroll_id})
        if not rec:
            raise ValueError(f"Payroll record {payroll_id} not found.")
        if rec.get("status") == "PAID":
            return fix_id(rec)
        if not rec.get("is_locked"):
            # Paying an unfinalized payroll used to skip advance/loan recovery and the payslip.
            rec = await cls.finalize_payroll(payroll_id, user_email=user_email)
            rec["_id"] = rec["id"]

        now_str = datetime.utcnow().isoformat()
        ref = payment_ref or f"NEFT-REX-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

        await payroll_col.update_one(
            {"_id": rec["_id"]},
            {"$set": {
                "status": "PAID",
                "payment_status": "Paid",
                "payment_date": now_str,
                "payment_reference": ref,
                "updated_at": now_str
            }}
        )

        if rec.get("payslip_id"):
            await slip_col.update_one(
                {"_id": rec["payslip_id"]},
                {"$set": {"payment_status": "Paid", "payment_date": now_str, "payment_reference": ref}}
            )

        await AuditService.log_action(
            user_email=user_email,
            user_role="admin",
            action="Marked Payroll as Paid",
            entity_type="payroll",
            entity_id=payroll_id,
            employee_name=rec.get("employee_name"),
            new_value={"payment_ref": ref}
        )

        updated = await payroll_col.find_one({"_id": rec["_id"]})
        return fix_id(updated)

    # ==========================================
    # 4. QUERIES, REPORTS & BANK EXPORTS
    # ==========================================
    @classmethod
    async def get_payrolls(
        cls,
        month: Optional[str] = None,
        year: Optional[int] = None,
        department: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        payroll_col = get_collection("payrolls")
        query: Dict[str, Any] = {}
        if month and month.lower() != "all":
            query["month"] = month
        if year:
            query["year"] = int(year)
        if department and department.lower() != "all":
            query["department"] = department
        if status and status.lower() != "all":
            query["status"] = status
        if search and search.strip():
            pattern = search_pattern(search)
            query["$or"] = [
                {"employee_name": {"$regex": pattern, "$options": "i"}},
                {"employee_code": {"$regex": pattern, "$options": "i"}},
                {"payroll_id": {"$regex": pattern, "$options": "i"}},
                {"department": {"$regex": pattern, "$options": "i"}}
            ]

        docs = await payroll_col.find(query).sort("created_at", -1).to_list(1000)
        return fix_ids(docs)

    @classmethod
    async def get_payroll_by_id(cls, payroll_id: str) -> Optional[Dict[str, Any]]:
        payroll_col = get_collection("payrolls")
        doc = await payroll_col.find_one({"_id": payroll_id})
        return fix_id(doc)

    @classmethod
    async def get_dashboard_metrics(cls, month: str = "September", year: int = 2026) -> Dict[str, Any]:
        emp_col = get_collection("employees")
        payroll_col = get_collection("payrolls")
        adv_col = get_collection("salary_advances")

        total_employees = await emp_col.count_documents({"employee_status": "Active"})
        payrolls = await cls.get_payrolls(month=month, year=year)

        processed_count = len(payrolls)
        pending_count = max(0, total_employees - processed_count)

        total_gross = sum(p.get("gross_salary", 0.0) for p in payrolls)
        total_deductions = sum(p.get("total_deductions", 0.0) for p in payrolls)
        total_net = sum(p.get("net_salary", 0.0) for p in payrolls)
        
        # Advances
        all_advances = await adv_col.find({"status": {"$ne": "Cancelled"}}).to_list(500)
        total_advances_disbursed = sum(float(a.get("advance_amount", 0.0)) for a in all_advances)
        outstanding_advances = sum(float(a.get("remaining_balance", 0.0)) for a in all_advances)

        # Bonuses and Overtime
        total_overtime = sum(p.get("earnings", {}).get("overtime_pay", 0.0) for p in payrolls)
        total_bonuses = sum(p.get("earnings", {}).get("bonus", 0.0) + p.get("earnings", {}).get("incentive", 0.0) for p in payrolls)

        # Status counts
        status_counts = {"DRAFT": 0, "CALCULATED": 0, "UNDER_REVIEW": 0, "APPROVED": 0, "FINALIZED": 0, "PAID": 0}
        for p in payrolls:
            st = p.get("status", "CALCULATED")
            status_counts[st] = status_counts.get(st, 0) + 1

        # Department Breakdown
        dept_map = {}
        for p in payrolls:
            d = p.get("department", "General")
            if d not in dept_map:
                dept_map[d] = {"count": 0, "gross": 0.0, "net": 0.0}
            dept_map[d]["count"] += 1
            dept_map[d]["gross"] += p.get("gross_salary", 0.0)
            dept_map[d]["net"] += p.get("net_salary", 0.0)

        return {
            "month": month,
            "year": year,
            "total_employees": total_employees,
            "processed_count": processed_count,
            "pending_count": pending_count,
            "total_gross_payroll": round(total_gross, 2),
            "total_deductions": round(total_deductions, 2),
            "total_net_payroll": round(total_net, 2),
            "total_advances_disbursed": round(total_advances_disbursed, 2),
            "outstanding_advances": round(outstanding_advances, 2),
            "total_overtime_pay": round(total_overtime, 2),
            "total_bonuses": round(total_bonuses, 2),
            "status_counts": status_counts,
            "department_breakdown": dept_map
        }

    @classmethod
    async def get_bank_payment_export(cls, month: str = "September", year: int = 2026, employee_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        payrolls = await cls.get_payrolls(month=month, year=year)
        # A payout file must only contain salaries that were signed off, never drafts under review.
        payrolls = [p for p in payrolls if p.get("status") in ("APPROVED", "FINALIZED", "PAID")]
        if employee_ids:
            payrolls = [p for p in payrolls if p["id"] in employee_ids or p.get("employee_id") in employee_ids]

        export_rows = []
        for p in payrolls:
            acc_raw = str(p.get("account_no", ""))
            acc_masked = f"••••{acc_raw[-4:]}" if len(acc_raw) >= 4 else (acc_raw or "N/A")
            export_rows.append({
                "employee_code": p.get("employee_code", ""),
                "employee_name": p.get("employee_name", ""),
                "department": p.get("department", ""),
                "bank_name": p.get("bank_name", "N/A"),
                "account_no": acc_raw,
                "account_no_masked": acc_masked,
                "ifsc_code": p.get("ifsc_code", "N/A"),
                "net_salary": p.get("net_salary", 0.0),
                "payment_reference": p.get("payment_reference") or f"SAL-{year}{month[:3].upper()}-{p.get('employee_code')}",
                "payment_status": p.get("payment_status", "Pending")
            })
        return export_rows

    @classmethod
    async def get_annual_salary_statement(cls, employee_id: str, year: int = 2026) -> Dict[str, Any]:
        emp_col = get_collection("employees")
        payroll_col = get_collection("payrolls")

        emp = await emp_col.find_one({"_id": employee_id})
        if not emp:
            raise ValueError(f"Employee {employee_id} not found.")

        payrolls = await payroll_col.find({"employee_id": employee_id, "year": int(year)}).to_list(12)

        months_order = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        payrolls_sorted = sorted(payrolls, key=lambda x: months_order.index(x["month"]) if x.get("month") in months_order else 99)

        statement_months = []
        tot_gross = 0.0
        tot_ded = 0.0
        tot_net = 0.0
        tot_adv = 0.0
        tot_loan = 0.0
        tot_bonus = 0.0
        tot_ot = 0.0

        for p in payrolls_sorted:
            g = p.get("gross_salary", 0.0)
            d = p.get("total_deductions", 0.0)
            n = p.get("net_salary", 0.0)
            adv = p.get("deductions", {}).get("salary_advance_deduction", 0.0)
            loan = p.get("deductions", {}).get("loan_deduction", 0.0)
            bon = p.get("earnings", {}).get("bonus", 0.0) + p.get("earnings", {}).get("incentive", 0.0)
            ot = p.get("earnings", {}).get("overtime_pay", 0.0)

            tot_gross += g
            tot_ded += d
            tot_net += n
            tot_adv += adv
            tot_loan += loan
            tot_bonus += bon
            tot_ot += ot

            statement_months.append({
                "month": p.get("month"),
                "gross_salary": g,
                "deductions": d,
                "advance_deduction": adv,
                "loan_deduction": loan,
                "net_salary": n,
                "status": p.get("status")
            })

        return {
            "employee_id": employee_id,
            "employee_code": emp.get("employee_code", ""),
            "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""),
            "designation": emp.get("designation", ""),
            "year": year,
            "months": statement_months,
            "totals": {
                "annual_gross": round(tot_gross, 2),
                "annual_deductions": round(tot_ded, 2),
                "annual_net_salary": round(tot_net, 2),
                "total_advance_deducted": round(tot_adv, 2),
                "total_loan_deducted": round(tot_loan, 2),
                "total_bonuses": round(tot_bonus, 2),
                "total_overtime": round(tot_ot, 2)
            }
        }

    @classmethod
    async def adjust_employee_salary(
        cls,
        employee_id: str,
        field: str,
        adjustment_type: str,
        amount: float,
        reason: str,
    ) -> Dict[str, Any]:
        """
        Increment or decrement a specific salary field for an employee.
        Returns a dict with old_value, new_value, employee_name, and recalculated totals.
        """
        VALID_FIELDS = [
            "base_salary", "hra", "conveyance_allowance",
            "special_allowance", "professional_tax",
        ]
        if field not in VALID_FIELDS:
            raise ValueError(f"Invalid field '{field}'. Must be one of: {', '.join(VALID_FIELDS)}")

        if adjustment_type not in ("increment", "decrement"):
            raise ValueError("adjustment_type must be 'increment' or 'decrement'.")

        emp_col = get_collection("employees")
        emp = await emp_col.find_one({"_id": employee_id})
        if not emp:
            raise ValueError(f"Employee with ID {employee_id} not found.")

        old_value = float(emp.get(field, 0.0))

        if adjustment_type == "increment":
            new_value = round(old_value + amount, 2)
        else:
            new_value = round(old_value - amount, 2)
            if new_value < 0:
                raise ValueError(
                    f"Cannot decrement {field} by ₹{amount}. Current value is ₹{old_value}. Result would be negative."
                )

        # Update the field
        now = datetime.utcnow().isoformat()
        update_set = {field: new_value, "updated_at": now}

        # Recalculate gross and net using the updated field
        base = new_value if field == "base_salary" else float(emp.get("base_salary", 0.0))
        hra = new_value if field == "hra" else float(emp.get("hra", 0.0))
        conv = new_value if field == "conveyance_allowance" else float(emp.get("conveyance_allowance", 0.0))
        special = new_value if field == "special_allowance" else float(emp.get("special_allowance", 0.0))
        pf_opted = emp.get("pf_opted", True)
        pt = new_value if field == "professional_tax" else float(emp.get("professional_tax", 200.0))

        gross = round(base + hra + conv + special, 2)
        pf = round(base * 0.12, 2) if pf_opted else 0.0
        net = max(0.0, round(gross - (pf + pt), 2))

        update_set["gross_salary"] = gross
        update_set["estimated_net_salary"] = net

        await emp_col.update_one({"_id": employee_id}, {"$set": update_set})
        from app.services.employee_service import EmployeeService
        await EmployeeService.sync_salary_structure(employee_id)

        return {
            "employee_name": emp.get("full_name", ""),
            "old_value": old_value,
            "new_value": new_value,
            "new_gross_salary": gross,
            "new_estimated_net_salary": net,
            "timestamp": now,
        }
