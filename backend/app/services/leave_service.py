import logging
import re
from datetime import datetime, timedelta, date
from typing import Dict, Any, List, Optional, Tuple

from app.database import get_collection, fix_id, fix_ids
from app.services.rbac_service import normalize_role
from app.schemas.leave import (
    LeaveRequest,
    LeaveBalance,
    LeaveTypeEnum,
    LeaveStatus,
    LeaveDurationType,
    LeaveApplicationRequest,
    LeaveDecisionRequest,
    DepartmentConflictInfo,
)

logger = logging.getLogger("rexera.leave")

# Who approves whose leave: staff and sales -> HR; HR -> Admin; Admin -> Super Admin.
# A higher role may always decide a lower level's request.
LEVEL_BY_APPLICANT_ROLE = {"hr": "ADMIN", "admin": "SUPERADMIN", "superadmin": "SUPERADMIN"}
DECIDERS = {"HR": {"hr", "admin", "superadmin"}, "ADMIN": {"admin", "superadmin"}, "SUPERADMIN": {"superadmin"}}
LEVEL_LABEL = {"HR": "HR", "ADMIN": "Admin", "SUPERADMIN": "Super Admin"}


def can_decide(leave_doc: Dict[str, Any], role: Optional[str]) -> bool:
    return normalize_role(role) in DECIDERS.get(leave_doc.get("approval_level") or "HR", DECIDERS["HR"])


class LeaveService:
    @staticmethod
    async def applicant_login(email: str) -> Optional[Dict[str, Any]]:
        """The login account behind an employee record (matched by email), which decides who approves their leave."""
        if not email:
            return None
        pattern = {"$regex": f"^{re.escape(email.strip())}$", "$options": "i"}
        accounts = await get_collection("admins").find({"email": pattern}).to_list(5)
        return next((a for a in accounts if a.get("is_active", True)), None)

    @staticmethod
    def calculate_requested_days(start_str: str, end_str: str, duration_type: LeaveDurationType) -> float:
        if duration_type in [LeaveDurationType.FIRST_HALF, LeaveDurationType.SECOND_HALF]:
            return 0.5
        
        start = datetime.strptime(start_str, "%Y-%m-%d").date()
        end = datetime.strptime(end_str, "%Y-%m-%d").date()
        return float((end - start).days + 1)

    @staticmethod
    def split_paid_and_lop(balances: LeaveBalance, leave_type: str, total_days: float) -> Tuple[float, float]:
        """Paid days come out of the matching balance; anything beyond it is Loss of Pay."""
        leave_type = LeaveTypeEnum(leave_type)
        if leave_type == LeaveTypeEnum.LOSS_OF_PAY:
            return 0.0, total_days
        available = {
            LeaveTypeEnum.CASUAL: balances.casual_leave_available,
            LeaveTypeEnum.SICK: balances.sick_leave_available,
            LeaveTypeEnum.EARNED: balances.earned_leave_available,
        }.get(leave_type)
        if available is None or available >= total_days:  # ML / PL / COMP_OFF are not balance-tracked
            return total_days, 0.0
        paid = max(0.0, available)
        return paid, total_days - paid

    @classmethod
    async def resolve_employee(cls, employee_ref: str) -> Optional[Dict[str, Any]]:
        emp_col = get_collection("employees")
        for key in ("employee_id", "employee_code", "_id"):
            emp = await emp_col.find_one({key: employee_ref})
            if emp:
                return emp
        return None

    @classmethod
    async def get_or_create_balance(cls, employee_id: str, year: Optional[int] = None) -> LeaveBalance:
        col = get_collection("leave_balances")
        current_year = year or datetime.utcnow().year
        doc = await col.find_one({"employee_id": employee_id, "year": current_year})
        if doc:
            return LeaveBalance(**doc)
        
        new_balance = LeaveBalance(employee_id=employee_id, year=current_year)
        await col.insert_one(new_balance.dict())
        return new_balance

    @classmethod
    async def check_department_overlap(
        cls,
        department: str,
        applicant_id: str,
        start_date: str,
        end_date: str
    ) -> DepartmentConflictInfo:
        """
        Detects if other colleagues from the same department are on approved leave
        during the requested dates.
        """
        leave_col = get_collection("leave_requests")
        
        cursor = leave_col.find({
            "department": department,
            "employee_id": {"$ne": applicant_id},
            "status": LeaveStatus.APPROVED.value,
            "start_date": {"$lte": end_date},
            "end_date": {"$gte": start_date}
        })
        
        overlapping_docs = await cursor.to_list(100)
        if not overlapping_docs:
            return DepartmentConflictInfo(has_conflict=False, conflict_count=0)

        conflicts = [
            {
                "employee_name": d.get("employee_name", "Unknown"),
                "employee_id": d.get("employee_id"),
                "start_date": d.get("start_date"),
                "end_date": d.get("end_date"),
                "leave_type": d.get("leave_type")
            }
            for d in overlapping_docs
        ]

        count = len(conflicts)
        risk = "HIGH" if count >= 3 else ("MEDIUM" if count >= 1 else "LOW")

        return DepartmentConflictInfo(
            has_conflict=True,
            conflict_count=count,
            conflicting_colleagues=conflicts,
            understaffing_risk_level=risk
        )

    @classmethod
    async def apply_leave(cls, payload: LeaveApplicationRequest) -> Dict[str, Any]:
        leave_col = get_collection("leave_requests")

        emp = await cls.resolve_employee(payload.employee_id)
        if not emp:
            raise ValueError(f"Employee {payload.employee_id} not found.")
        if not emp.get("email"):
            raise ValueError("This employee has no email address on file; add one before applying for leave.")

        emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))

        # Prevent Overlapping Self-Requests
        existing_conflict = await leave_col.find_one({
            "employee_id": emp_id,
            "status": {"$in": [LeaveStatus.PENDING.value, LeaveStatus.APPROVED.value]},
            "start_date": {"$lte": payload.end_date},
            "end_date": {"$gte": payload.start_date}
        })
        if existing_conflict:
            raise ValueError(
                f"You already have an active leave application ({existing_conflict.get('status')}) "
                f"from {existing_conflict.get('start_date')} to {existing_conflict.get('end_date')}."
            )

        total_days = cls.calculate_requested_days(payload.start_date, payload.end_date, payload.duration_type)

        if payload.leave_type == LeaveTypeEnum.SICK and total_days > 2.0:
            if not payload.medical_certificate_url:
                raise ValueError("A medical certificate upload is mandatory for Sick Leave exceeding 2 consecutive days.")

        # The balance of the leave's own year (not the year it was applied in).
        balances = await cls.get_or_create_balance(emp_id, year=int(payload.start_date[:4]))
        paid_days, lop_days = cls.split_paid_and_lop(balances, payload.leave_type, total_days)
        is_lop = lop_days > 0

        department = emp.get("department", "General")
        account = await cls.applicant_login(emp.get("email"))
        applicant_role = normalize_role((account or {}).get("role"))
        approval_level = LEVEL_BY_APPLICANT_ROLE.get(applicant_role, "HR")

        leave_record = LeaveRequest(
            employee_id=emp_id,
            employee_name=emp.get("full_name", "Unknown"),
            employee_email=emp.get("email"),
            department=department,
            manager_email=emp.get("manager_email") or "hr@rexera.co.in",
            leave_type=payload.leave_type,
            start_date=payload.start_date,
            end_date=payload.end_date,
            duration_type=payload.duration_type,
            total_days=total_days,
            reason=payload.reason,
            medical_certificate_url=payload.medical_certificate_url,
            is_loss_of_pay=is_lop,
            lop_days=lop_days,
            paid_leave_days=paid_days,
            applicant_role=applicant_role,
            approval_level=approval_level,
            status=LeaveStatus.PENDING
        )

        doc = leave_record.dict(by_alias=True)
        res = await leave_col.insert_one(doc)
        doc["_id"] = str(res.inserted_id)

        conflict_info = await cls.check_department_overlap(
            department, emp_id, payload.start_date, payload.end_date
        )

        return {
            "leave_request": fix_id(doc),
            "conflict_info": conflict_info.dict(),
            "employee": emp
        }

    @classmethod
    async def process_leave_decision(
        cls,
        payload: LeaveDecisionRequest,
        admin_user: Dict[str, Any]
    ) -> Dict[str, Any]:
        leave_col = get_collection("leave_requests")
        bal_col = get_collection("leave_balances")
        att_col = get_collection("attendance")

        leave_doc = await leave_col.find_one({"_id": payload.leave_request_id})
        if not leave_doc:
            raise ValueError(f"Leave request ID {payload.leave_request_id} not found.")

        if leave_doc.get("status") != LeaveStatus.PENDING.value:
            raise ValueError(f"Cannot alter request with status '{leave_doc.get('status')}'.")

        decider_role = normalize_role(admin_user.get("role"))
        level = leave_doc.get("approval_level") or "HR"
        if not can_decide(leave_doc, decider_role):
            raise ValueError(f"This leave request needs approval from {LEVEL_LABEL.get(level, level)}.")
        own = str(admin_user.get("email") or "").strip().lower()
        if own and own == str(leave_doc.get("employee_email") or "").strip().lower() and decider_role != "superadmin":
            raise ValueError("You cannot decide your own leave request.")

        now_utc = datetime.utcnow()
        new_status = LeaveStatus.APPROVED.value if payload.action == "APPROVE" else LeaveStatus.REJECTED.value

        extra_fields: Dict[str, Any] = {}
        if payload.action == "APPROVE":
            emp_id = leave_doc["employee_id"]
            leave_type = leave_doc["leave_type"]
            leave_year = int(str(leave_doc["start_date"])[:4])
            # Re-split against the balance *now*: other requests may have been approved since this
            # one was filed, and charging the stale split would push "used" past the allocation.
            balances = await cls.get_or_create_balance(emp_id, year=leave_year)
            total_days = float(leave_doc.get("total_days", 0.0))
            paid_days, lop_days = cls.split_paid_and_lop(balances, leave_type, total_days)
            extra_fields = {"paid_leave_days": paid_days, "lop_days": lop_days, "is_loss_of_pay": lop_days > 0}

            update_inc = {}
            if leave_type == LeaveTypeEnum.CASUAL.value:
                update_inc["casual_leave_used"] = paid_days
            elif leave_type == LeaveTypeEnum.SICK.value:
                update_inc["sick_leave_used"] = paid_days
            elif leave_type == LeaveTypeEnum.EARNED.value:
                update_inc["earned_leave_used"] = paid_days
            
            if lop_days > 0:
                update_inc["loss_of_pay_days"] = lop_days

            if update_inc:
                await bal_col.update_one(
                    {"employee_id": emp_id, "year": leave_year},
                    {"$inc": update_inc, "$set": {"updated_at": now_utc}},
                    upsert=True
                )

            # Pre-populate Attendance entries for each day in range with status "ON_LEAVE"
            start = datetime.strptime(leave_doc["start_date"], "%Y-%m-%d").date()
            end = datetime.strptime(leave_doc["end_date"], "%Y-%m-%d").date()
            curr = start
            while curr <= end:
                curr_str = curr.strftime("%Y-%m-%d")
                await att_col.update_one(
                    {"employee_id": emp_id, "attendance_date": curr_str},
                    {
                        "$set": {
                            "employee_id": emp_id,
                            "employee_name": leave_doc["employee_name"],
                            "employee_email": leave_doc["employee_email"],
                            "department": leave_doc["department"],
                            "attendance_date": curr_str,
                            "status": "ON_LEAVE",
                            "is_late": False,
                            "is_half_day": False if leave_doc.get("duration_type") == LeaveDurationType.FULL_DAY.value else True,
                            "remarks": f"Approved {leave_type} Leave ({leave_doc.get('duration_type')})",
                            "updated_at": now_utc
                        }
                    },
                    upsert=True
                )
                curr += timedelta(days=1)

        update_fields = {
            **extra_fields,
            "status": new_status,
            "action_by_id": str(admin_user.get("_id", admin_user.get("id"))),
            "action_by_name": admin_user.get("username") or admin_user.get("name") or "HR Admin",
            "action_timestamp": now_utc,
            "rejection_reason": payload.remarks if payload.action == "REJECT" else None,
            "updated_at": now_utc
        }

        await leave_col.update_one({"_id": leave_doc["_id"]}, {"$set": update_fields})
        updated_leave = await leave_col.find_one({"_id": leave_doc["_id"]})

        return {
            "leave_request": fix_id(updated_leave),
            "action": payload.action
        }

    @classmethod
    async def get_hr_pending_leaves_dashboard(cls, viewer_role: Optional[str] = None, viewer_email: str = "") -> List[Dict[str, Any]]:
        """Pending requests this viewer is allowed to decide (their own never appear here)."""
        leave_col = get_collection("leave_requests")
        cursor = leave_col.find({"status": LeaveStatus.PENDING.value}).sort("created_at", -1)
        me = viewer_email.strip().lower()
        pending_docs = [d for d in await cursor.to_list(200)
                        if can_decide(d, viewer_role) and not (me and me == str(d.get("employee_email") or "").strip().lower() and normalize_role(viewer_role) != "superadmin")]

        enriched_list = []
        for doc in pending_docs:
            emp_id = doc["employee_id"]
            year = str(doc.get("start_date", ""))[:4]
            balances = await cls.get_or_create_balance(emp_id, year=int(year) if year.isdigit() else None)
            conflict_info = await cls.check_department_overlap(
                department=doc["department"],
                applicant_id=emp_id,
                start_date=doc["start_date"],
                end_date=doc["end_date"]
            )

            item = fix_id(doc)
            item["balances"] = {
                "casual_leave_available": balances.casual_leave_available,
                "sick_leave_available": balances.sick_leave_available,
                "earned_leave_available": balances.earned_leave_available,
                "loss_of_pay_days_ytd": balances.loss_of_pay_days
            }
            item["conflict_warning"] = conflict_info.dict()
            enriched_list.append(item)

        return enriched_list
