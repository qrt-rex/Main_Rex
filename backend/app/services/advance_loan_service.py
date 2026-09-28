import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from fastapi import HTTPException, status
from app.database import get_collection, fix_id, fix_ids

logger = logging.getLogger("rexera.advance_loan")

# An advance larger than this many months of gross salary is almost certainly a typo.
MAX_ADVANCE_MONTHS = 12

class AdvanceLoanService:
    # ==========================================
    # SALARY ADVANCES
    # ==========================================
    @classmethod
    async def create_advance(cls, employee_id: str, advance_amount: float, reason: str, monthly_deduction: float, start_month: str, start_year: int) -> Dict[str, Any]:
        emp_col = get_collection("employees")
        adv_col = get_collection("salary_advances")

        emp = await emp_col.find_one({"_id": employee_id})
        if not emp:
            raise ValueError(f"Employee with ID {employee_id} not found.")

        gross = float(emp.get("gross_salary") or 0) or sum(
            float(emp.get(k) or 0) for k in ("base_salary", "hra", "conveyance_allowance", "special_allowance"))
        if gross > 0 and advance_amount > MAX_ADVANCE_MONTHS * gross:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"An advance cannot exceed {MAX_ADVANCE_MONTHS} months of gross salary "
                       f"(₹{MAX_ADVANCE_MONTHS * gross:,.0f} for this employee).",
            )

        count = await adv_col.count_documents({})
        advance_id = f"REX-ADV-{count + 1:04d}"
        now_str = datetime.utcnow().isoformat()

        doc = {
            "advance_id": advance_id,
            "employee_id": str(emp["_id"]),
            "employee_code": emp.get("employee_code", ""),
            "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""),
            "request_date": now_str[:10],
            "advance_amount": float(advance_amount),
            "reason": reason,
            "approval_status": "Approved", # Auto-approved by HR/Admin on creation
            "approved_by": "HR Superadmin",
            "approval_date": now_str[:10],
            "monthly_deduction_amount": float(monthly_deduction),
            "start_month": start_month,
            "start_year": int(start_year),
            "paid_amount": 0.0,
            "remaining_balance": float(advance_amount),
            "status": "Approved",
            "created_at": now_str,
            "updated_at": now_str
        }

        res = await adv_col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        doc["_id"] = str(res.inserted_id)
        return doc

    @classmethod
    async def list_advances(cls, employee_id: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
        adv_col = get_collection("salary_advances")
        query: Dict[str, Any] = {}
        if employee_id:
            query["employee_id"] = employee_id
        if status and status.lower() != "all":
            query["status"] = status
        
        docs = await adv_col.find(query).sort("created_at", -1).to_list(1000)
        return fix_ids(docs)

    @classmethod
    async def get_active_advances_for_employee(cls, employee_id: str) -> List[Dict[str, Any]]:
        adv_col = get_collection("salary_advances")
        # An advance is active if approved and has remaining balance > 0
        docs = await adv_col.find({
            "employee_id": employee_id,
            "status": {"$in": ["Approved", "Partially Paid"]},
            "remaining_balance": {"$gt": 0.0}
        }).to_list(100)
        return fix_ids(docs)

    @classmethod
    async def update_advance_approval(cls, advance_db_id: str, action: str, approved_by: str, remarks: Optional[str] = None) -> Dict[str, Any]:
        adv_col = get_collection("salary_advances")
        adv = await adv_col.find_one({"_id": advance_db_id})
        if not adv:
            raise ValueError(f"Advance record {advance_db_id} not found.")

        now_str = datetime.utcnow().isoformat()
        approving = action.lower() == "approve"
        new_status = "Approved" if approving else "Rejected"
        current = adv.get("status", "Pending")
        if approving and current not in ("Pending", "Rejected"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"This advance is already {current}.")
        if not approving:
            # Rejecting after recovery has started would silently stop collecting the rest.
            if float(adv.get("paid_amount") or 0) > 0 or current not in ("Pending", "Approved"):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                    detail=f"An advance that is {current} (₹{float(adv.get('paid_amount') or 0):,.0f} "
                                           "already recovered) can no longer be rejected.")
        
        await adv_col.update_one(
            {"_id": adv["_id"]},
            {"$set": {
                "approval_status": new_status,
                "status": new_status,
                "approved_by": approved_by,
                "approval_date": now_str[:10],
                "remarks": remarks or "",
                "updated_at": now_str
            }}
        )
        updated = await adv_col.find_one({"_id": adv["_id"]})
        return fix_id(updated)

    @classmethod
    async def record_advance_repayment(cls, advance_db_id: str, deducted_amount: float, payroll_id: str, month: str, year: int):
        adv_col = get_collection("salary_advances")
        txn_col = get_collection("advance_transactions")

        adv = await adv_col.find_one({"_id": advance_db_id})
        if not adv:
            return

        now_str = datetime.utcnow().isoformat()
        current_rem = float(adv.get("remaining_balance", 0.0))
        current_paid = float(adv.get("paid_amount", 0.0))

        actual_deducted = min(current_rem, float(deducted_amount))
        new_rem = max(0.0, round(current_rem - actual_deducted, 2))
        new_paid = round(current_paid + actual_deducted, 2)

        new_status = "Fully Recovered" if new_rem <= 0.0 else "Partially Paid"

        await adv_col.update_one(
            {"_id": adv["_id"]},
            {"$set": {
                "remaining_balance": new_rem,
                "paid_amount": new_paid,
                "status": new_status,
                "updated_at": now_str
            }}
        )

        # Ledger record
        txn_doc = {
            "advance_id": adv.get("advance_id"),
            "advance_db_id": str(adv["_id"]),
            "employee_id": adv.get("employee_id"),
            "payroll_id": payroll_id,
            "deducted_amount": actual_deducted,
            "remaining_balance": new_rem,
            "month": month,
            "year": year,
            "created_at": now_str
        }
        await txn_col.insert_one(txn_doc)

    # ==========================================
    # PAYROLL LEDGER HELPERS
    # ==========================================
    @classmethod
    async def is_committed(cls, txn_collection: str, id_field: str, db_id: str, payroll_id: str) -> bool:
        """True if this payroll already recovered from this advance/loan (and it wasn't reversed)."""
        return bool(await get_collection(txn_collection).find_one(
            {"payroll_id": payroll_id, id_field: db_id, "reversed": {"$ne": True}}
        ))

    @classmethod
    async def reverse_payroll_recoveries(cls, payroll_id: str) -> None:
        """Undo every advance/loan recovery a payroll committed (used when it is unlocked)."""
        now_str = datetime.utcnow().isoformat()
        for txn_name, source_name, id_field, balance_field, active_status in (
            ("advance_transactions", "salary_advances", "advance_db_id", "remaining_balance", None),
            ("loan_transactions", "employee_loans", "loan_db_id", "remaining_amount", "Active"),
        ):
            txn_col, src_col = get_collection(txn_name), get_collection(source_name)
            txns = await txn_col.find({"payroll_id": payroll_id, "reversed": {"$ne": True}}).to_list(1000)
            for txn in txns:
                src = await src_col.find_one({"_id": txn.get(id_field)})
                amt = float(txn.get("deducted_amount") or 0)
                if src and amt > 0:
                    paid = max(0.0, round(float(src.get("paid_amount") or 0) - amt, 2))
                    remaining = round(float(src.get(balance_field) or 0) + amt, 2)
                    new_status = active_status or ("Partially Paid" if paid > 0 else "Approved")
                    await src_col.update_one({"_id": src["_id"]}, {"$set": {
                        "paid_amount": paid, balance_field: remaining, "status": new_status, "updated_at": now_str,
                    }})
                await txn_col.update_one({"_id": txn["_id"]}, {"$set": {"reversed": True, "reversed_at": now_str}})

    # ==========================================
    # EMPLOYEE LOANS
    # ==========================================
    @classmethod
    async def create_loan(cls, employee_id: str, principal: float, interest_rate: float, monthly_emi: float, start_date: str, reason: Optional[str] = None) -> Dict[str, Any]:
        emp_col = get_collection("employees")
        loan_col = get_collection("employee_loans")

        emp = await emp_col.find_one({"_id": employee_id})
        if not emp:
            raise ValueError(f"Employee with ID {employee_id} not found.")

        count = await loan_col.count_documents({})
        loan_id = f"REX-LOAN-{count + 1:04d}"
        now_str = datetime.utcnow().isoformat()

        # Simple interest total payable
        interest_amt = (principal * interest_rate / 100.0)
        total_payable = round(principal + interest_amt, 2)

        doc = {
            "loan_id": loan_id,
            "employee_id": str(emp["_id"]),
            "employee_code": emp.get("employee_code", ""),
            "employee_name": emp.get("full_name", ""),
            "department": emp.get("department", ""),
            "principal_amount": float(principal),
            "interest_rate_percent": float(interest_rate),
            "total_payable": total_payable,
            "monthly_emi": float(monthly_emi),
            "start_date": start_date,
            "paid_amount": 0.0,
            "remaining_amount": total_payable,
            "status": "Active",
            "reason": reason or "Personal Loan Assistance",
            "created_at": now_str,
            "updated_at": now_str
        }

        res = await loan_col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        doc["_id"] = str(res.inserted_id)
        return doc

    @classmethod
    async def list_loans(cls, employee_id: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
        loan_col = get_collection("employee_loans")
        query: Dict[str, Any] = {}
        if employee_id:
            query["employee_id"] = employee_id
        if status and status.lower() != "all":
            query["status"] = status
        
        docs = await loan_col.find(query).sort("created_at", -1).to_list(1000)
        return fix_ids(docs)

    @classmethod
    async def get_active_loans_for_employee(cls, employee_id: str) -> List[Dict[str, Any]]:
        loan_col = get_collection("employee_loans")
        docs = await loan_col.find({
            "employee_id": employee_id,
            "status": "Active",
            "remaining_amount": {"$gt": 0.0}
        }).to_list(100)
        return fix_ids(docs)

    @classmethod
    async def record_loan_repayment(cls, loan_db_id: str, deducted_amount: float, payroll_id: str, month: str, year: int):
        loan_col = get_collection("employee_loans")
        txn_col = get_collection("loan_transactions")

        loan = await loan_col.find_one({"_id": loan_db_id})
        if not loan:
            return

        now_str = datetime.utcnow().isoformat()
        current_rem = float(loan.get("remaining_amount", 0.0))
        current_paid = float(loan.get("paid_amount", 0.0))

        actual_deducted = min(current_rem, float(deducted_amount))
        new_rem = max(0.0, round(current_rem - actual_deducted, 2))
        new_paid = round(current_paid + actual_deducted, 2)

        new_status = "Completed" if new_rem <= 0.0 else "Active"

        await loan_col.update_one(
            {"_id": loan["_id"]},
            {"$set": {
                "remaining_amount": new_rem,
                "paid_amount": new_paid,
                "status": new_status,
                "updated_at": now_str
            }}
        )

        txn_doc = {
            "loan_id": loan.get("loan_id"),
            "loan_db_id": str(loan["_id"]),
            "employee_id": loan.get("employee_id"),
            "payroll_id": payroll_id,
            "deducted_amount": actual_deducted,
            "remaining_amount": new_rem,
            "month": month,
            "year": year,
            "created_at": now_str
        }
        await txn_col.insert_one(txn_doc)
