import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from fastapi import HTTPException, status
from pydantic import ValidationError
from app.database import get_collection, fix_id, fix_ids
from app.schemas.intern import InternCreateRequest, InternUpdateRequest, InternConvertToEmployeeRequest
from app.schemas.employee import EmployeeCreateRequest
from app.services.employee_service import EmployeeService
from app.utils.validators import search_pattern

logger = logging.getLogger("rexera.interns")

class InternService:
    @classmethod
    async def generate_next_intern_code(cls) -> str:
        # Highest existing number + 1 (count + 1 re-issued a code after any deletion).
        col = get_collection("interns")
        current_year = datetime.utcnow().year
        prefix = f"INT-{current_year}-"
        docs = await col.find({}, {"intern_code": 1}).to_list(100000)
        highest = 0
        for d in docs:
            code = str(d.get("intern_code", ""))
            if code.startswith(prefix) and code[len(prefix):].isdigit():
                highest = max(highest, int(code[len(prefix):]))
        return f"{prefix}{highest + 1:03d}"

    @classmethod
    async def create_intern(cls, req: InternCreateRequest) -> Dict[str, Any]:
        col = get_collection("interns")
        now = datetime.utcnow().isoformat()
        
        doc = req.model_dump()
        if not doc.get("intern_code"):
            doc["intern_code"] = await cls.generate_next_intern_code()
            
        doc["status"] = doc.get("status", "Ongoing")
        doc["converted_employee_id"] = None
        doc["created_at"] = now
        doc["updated_at"] = now
        
        res = await col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        doc["_id"] = str(res.inserted_id)
        return doc

    @classmethod
    async def get_interns(
        cls,
        search: Optional[str] = None,
        department: Optional[str] = None,
        status: Optional[str] = None,
        page: int = 1,
        limit: int = 20
    ) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection("interns")
        query: Dict[str, Any] = {}
        
        if department and department.lower() != "all":
            query["department"] = department
        if status and status.lower() != "all":
            query["status"] = status
            
        if search and search.strip():
            pattern = search_pattern(search)
            query["$or"] = [
                {"full_name": {"$regex": pattern, "$options": "i"}},
                {"intern_code": {"$regex": pattern, "$options": "i"}},
                {"email": {"$regex": pattern, "$options": "i"}},
                {"college_university": {"$regex": pattern, "$options": "i"}},
                {"domain_role": {"$regex": pattern, "$options": "i"}},
                {"assigned_mentor": {"$regex": pattern, "$options": "i"}}
            ]

        total = await col.count_documents(query)
        skip = (page - 1) * limit
        cursor = col.find(query).sort("created_at", -1).skip(skip).limit(limit)
        docs = await cursor.to_list(limit)
        return fix_ids(docs), total

    @classmethod
    async def get_intern_by_id(cls, intern_id: str) -> Optional[Dict[str, Any]]:
        col = get_collection("interns")
        doc = await col.find_one({"_id": intern_id})
        return fix_id(doc)

    @classmethod
    async def update_intern(cls, intern_id: str, req: InternUpdateRequest) -> Optional[Dict[str, Any]]:
        col = get_collection("interns")
        update_data = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
        current = await col.find_one({"_id": intern_id})
        if not current:
            return None
        if not update_data:
            return fix_id(current)

        start = update_data.get("start_date", current.get("start_date"))
        end = update_data.get("end_date", current.get("end_date"))
        if start and end and str(end) < str(start):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="End date must be on or after the start date.")
        if "•" in str(update_data.get("account_no", "")):
            update_data.pop("account_no")  # a masked number must never overwrite the real one

        update_data["updated_at"] = datetime.utcnow().isoformat()
        await col.update_one({"_id": intern_id}, {"$set": update_data})
        return await cls.get_intern_by_id(intern_id)

    @classmethod
    async def convert_to_full_time(cls, intern_id: str, conversion_req: InternConvertToEmployeeRequest) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        col = get_collection("interns")
        intern = await col.find_one({"_id": intern_id})
        if not intern:
            return False, "Intern record not found.", None

        if intern.get("status") == "Converted to Full-Time":
            return False, "This intern has already been converted to a full-time employee.", None

        # Build full-time employee creation payload from intern and conversion details
        try:
            emp_payload = cls._conversion_payload(intern, conversion_req)
        except ValidationError as e:
            problems = "; ".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg'].replace('Value error, ', '')}"
                                 for err in e.errors())
            return False, f"The intern record needs fixing before conversion ({problems}).", None

        created_emp = await EmployeeService.create_employee(emp_payload)

        # Mark intern as converted
        now = datetime.utcnow().isoformat()
        await col.update_one(
            {"_id": intern_id},
            {"$set": {
                "status": "Converted to Full-Time",
                "converted_employee_id": created_emp["id"],
                "updated_at": now
            }}
        )

        return True, f"Intern successfully converted to Full-Time Employee ({created_emp['employee_code']}).", created_emp

    @staticmethod
    def _conversion_payload(intern: Dict[str, Any], conversion_req: InternConvertToEmployeeRequest) -> EmployeeCreateRequest:
        return EmployeeCreateRequest(
            employee_code=conversion_req.employee_code or "",
            full_name=intern["full_name"],
            email=intern["email"],
            mobile_number=intern["mobile_number"],
            department=conversion_req.department or intern.get("department", "Engineering"),
            designation=conversion_req.designation,
            reporting_manager=conversion_req.reporting_manager or intern.get("assigned_mentor", ""),
            date_of_joining=conversion_req.date_of_joining,
            base_salary=conversion_req.base_salary,
            hra=conversion_req.hra,
            conveyance_allowance=conversion_req.conveyance_allowance,
            special_allowance=conversion_req.special_allowance,
            professional_tax=conversion_req.professional_tax,
            pf_opted=conversion_req.pf_opted,
            bank_name=intern.get("bank_name", "Primary Bank"),
            account_no=intern.get("account_no", ""),
            ifsc_code=intern.get("ifsc_code", ""),
            employee_status="Active",
            joining_status="Completed"
        )

    @classmethod
    async def delete_intern(cls, intern_id: str) -> bool:
        col = get_collection("interns")
        res = await col.delete_one({"_id": intern_id})
        return res.deleted_count > 0
