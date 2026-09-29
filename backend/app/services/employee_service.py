import logging
import re
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from fastapi import HTTPException, status
from app.database import get_collection, fix_id, fix_ids
from app.schemas.employee import EmployeeCreateRequest, EmployeeUpdateRequest
from app.utils.validators import mask_account_number, search_pattern

logger = logging.getLogger("rexera.employees")

class EmployeeService:
    @classmethod
    async def generate_next_employee_code(cls) -> str:
        col = get_collection("employees")
        docs = await col.find({}, {"employee_code": 1}).to_list(100000)
        highest = 0
        for d in docs:
            digits = "".join(ch for ch in str(d.get("employee_code", "")) if ch.isdigit())
            if str(d.get("employee_code", "")).startswith("EMP-") and digits:
                highest = max(highest, int(digits))
        return f"EMP-{highest + 1:03d}"

    @classmethod
    async def ensure_unique(cls, email: Optional[str] = None, employee_code: Optional[str] = None,
                            exclude_id: Optional[str] = None) -> None:
        """409 if another employee already uses this email or employee code."""
        col = get_collection("employees")
        checks = []
        if email:
            checks.append(("email", {"email": {"$regex": f"^{re.escape(email.strip())}$", "$options": "i"}},
                           f"An employee with the email {email.strip()} already exists."))
        if employee_code:
            checks.append(("employee_code", {"employee_code": employee_code.strip()},
                           f"Employee code {employee_code.strip()} is already in use."))
        for _, query, message in checks:
            if exclude_id:
                query = {**query, "_id": {"$ne": exclude_id}}
            if await col.find_one(query):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)

    @classmethod
    async def create_employee(cls, req: EmployeeCreateRequest) -> Dict[str, Any]:
        col = get_collection("employees")
        now = datetime.utcnow().isoformat()

        doc = req.model_dump()
        doc["email"] = str(doc["email"]).strip().lower()
        doc["employee_code"] = (doc.get("employee_code") or "").strip()
        await cls.ensure_unique(email=doc["email"], employee_code=doc["employee_code"] or None)
        if not doc.get("employee_code"):
            doc["employee_code"] = await cls.generate_next_employee_code()
            
        doc["gross_salary"] = (
            doc.get("base_salary", 0.0) +
            doc.get("hra", 0.0) +
            doc.get("conveyance_allowance", 0.0) +
            doc.get("special_allowance", 0.0)
        )
        
        # Estimate net salary with standard PF (12% basic) + PT (200)
        pf = (doc["base_salary"] * 0.12) if doc.get("pf_opted", True) else 0.0
        pt = doc.get("professional_tax", 200.0)
        doc["estimated_net_salary"] = max(0.0, doc["gross_salary"] - (pf + pt))
        
        doc["created_at"] = now
        doc["updated_at"] = now
        
        res = await col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        doc["_id"] = str(res.inserted_id)
        return doc

    @classmethod
    async def get_employees(
        cls,
        search: Optional[str] = None,
        department: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
        mask_banking: bool = True
    ) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection("employees")
        query: Dict[str, Any] = {}
        
        if department and department.lower() != "all":
            query["department"] = department
        if status and status.lower() != "all":
            query["employee_status"] = status
            
        if search and search.strip():
            pattern = search_pattern(search)
            query["$or"] = [
                {"full_name": {"$regex": pattern, "$options": "i"}},
                {"employee_code": {"$regex": pattern, "$options": "i"}},
                {"email": {"$regex": pattern, "$options": "i"}},
                {"designation": {"$regex": pattern, "$options": "i"}},
                {"department": {"$regex": pattern, "$options": "i"}}
            ]

        total = await col.count_documents(query)
        skip = (page - 1) * limit
        cursor = col.find(query).sort("created_at", -1).skip(skip).limit(limit)
        docs = await cursor.to_list(limit)
        
        processed = []
        for d in docs:
            doc = dict(d)
            if mask_banking and "account_no" in doc:
                doc["account_no"] = mask_account_number(doc["account_no"])
            processed.append(doc)
            
        return fix_ids(processed), total

    @classmethod
    async def get_employee_by_id(cls, emp_id: str, mask_banking: bool = False) -> Optional[Dict[str, Any]]:
        col = get_collection("employees")
        doc = await col.find_one({"_id": emp_id})
        if not doc:
            return None
        res = dict(doc)
        if mask_banking and "account_no" in res:
            res["account_no"] = mask_account_number(res["account_no"])
        return fix_id(res)

    @classmethod
    async def update_employee(cls, emp_id: str, req: EmployeeUpdateRequest) -> Optional[Dict[str, Any]]:
        col = get_collection("employees")
        update_data = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
        current = await col.find_one({"_id": emp_id})
        if not current:
            return None
        if not update_data:
            return await cls.get_employee_by_id(emp_id)
        if "email" in update_data:
            update_data["email"] = str(update_data["email"]).strip().lower()
            await cls.ensure_unique(email=update_data["email"], exclude_id=emp_id)
        # A masked number (from a list view) must never overwrite the real one.
        if "•" in str(update_data.get("account_no", "")):
            update_data.pop("account_no")

        # Recalculate salary if salary fields updated
        if current:
            base = update_data.get("base_salary", current.get("base_salary", 0.0))
            hra = update_data.get("hra", current.get("hra", 0.0))
            conveyance = update_data.get("conveyance_allowance", current.get("conveyance_allowance", 0.0))
            special = update_data.get("special_allowance", current.get("special_allowance", 0.0))
            pf_opt = update_data.get("pf_opted", current.get("pf_opted", True))
            pt = update_data.get("professional_tax", current.get("professional_tax", 200.0))
            
            gross = base + hra + conveyance + special
            pf = (base * 0.12) if pf_opt else 0.0
            net = max(0.0, gross - (pf + pt))
            
            update_data["gross_salary"] = gross
            update_data["estimated_net_salary"] = net

        update_data["updated_at"] = datetime.utcnow().isoformat()
        await col.update_one({"_id": emp_id}, {"$set": update_data})
        if any(k in update_data for k in cls.SALARY_FIELDS + ("full_name", "department", "designation")):
            await cls.sync_salary_structure(emp_id)
        return await cls.get_employee_by_id(emp_id)

    SALARY_FIELDS = ("base_salary", "hra", "conveyance_allowance", "special_allowance", "pf_opted", "professional_tax")

    @classmethod
    async def sync_salary_structure(cls, emp_id: str) -> None:
        """Payroll reads the salary structure, not the employee record: copy salary changes across."""
        emp = await get_collection("employees").find_one({"_id": emp_id})
        struct_col = get_collection("salary_structures")
        struct = await struct_col.find_one({"employee_id": emp_id, "is_active": True})
        if not emp or not struct:
            return  # no structure yet: payroll builds it from the employee record on first run
        changes: Dict[str, Any] = {
            "base_salary": float(emp.get("base_salary") or 0),
            "conveyance_allowance": float(emp.get("conveyance_allowance") or 0),
            "special_allowance": float(emp.get("special_allowance") or 0),
            "pf_opted": bool(emp.get("pf_opted", True)),
            "professional_tax": float(emp.get("professional_tax") if emp.get("professional_tax") is not None else 200.0),
            "employee_name": emp.get("full_name", struct.get("employee_name", "")),
            "department": emp.get("department", struct.get("department", "")),
            "designation": emp.get("designation", struct.get("designation", "")),
            "updated_at": datetime.utcnow().isoformat(),
        }
        if struct.get("hra_type", "fixed") == "fixed":  # a percentage HRA follows the basic by itself
            changes["hra_value"] = float(emp.get("hra") or 0)
        await struct_col.update_one({"_id": struct["_id"]}, {"$set": changes})

    @classmethod
    async def delete_employee(cls, emp_id: str) -> bool:
        col = get_collection("employees")
        res = await col.delete_one({"_id": emp_id})
        return res.deleted_count > 0
