import logging
import re
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from app.database import get_collection, fix_id, fix_ids
from app.schemas.candidate import CandidateCreateRequest, CandidateUpdateRequest
from app.utils.validators import search_pattern

logger = logging.getLogger("rexera.candidates")

class CandidateService:
    @classmethod
    async def find_duplicate(cls, email: str, position: str) -> Optional[Dict[str, Any]]:
        """An existing application from this email for the same position (case-insensitive)."""
        col = get_collection("candidates")
        return await col.find_one({
            "email": {"$regex": f"^{re.escape(email.strip())}$", "$options": "i"},
            "position_applied": {"$regex": f"^{re.escape(position.strip())}$", "$options": "i"},
        })

    @classmethod
    async def create_candidate(cls, req: CandidateCreateRequest, assigned_hr: str = "") -> Dict[str, Any]:
        col = get_collection("candidates")
        now = datetime.utcnow().isoformat()

        doc = req.model_dump()
        doc["email"] = str(doc["email"]).strip().lower()
        doc["status"] = "Applied"
        doc["has_joining_token"] = False
        doc["joining_token"] = None
        doc["assigned_hr"] = assigned_hr
        doc["created_at"] = now
        doc["updated_at"] = now
        
        res = await col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        doc["_id"] = str(res.inserted_id)
        return doc

    @classmethod
    async def get_candidates(
        cls,
        search: Optional[str] = None,
        status: Optional[str] = None,
        position: Optional[str] = None,
        page: int = 1,
        limit: int = 20,
        sort_by: str = "created_at",
        sort_desc: bool = True
    ) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection("candidates")
        query: Dict[str, Any] = {}
        
        if status and status.lower() != "all":
            query["status"] = status
        
        if position and position.lower() != "all":
            query["position_applied"] = position
            
        if search and search.strip():
            pattern = search_pattern(search)
            query["$or"] = [
                {"candidate_name": {"$regex": pattern, "$options": "i"}},
                {"email": {"$regex": pattern, "$options": "i"}},
                {"contact_number": {"$regex": pattern, "$options": "i"}},
                {"position_applied": {"$regex": pattern, "$options": "i"}}
            ]

        total = await col.count_documents(query)
        
        direction = -1 if sort_desc else 1
        skip = (page - 1) * limit
        
        cursor = col.find(query).sort(sort_by, direction).skip(skip).limit(limit)
        docs = await cursor.to_list(limit)
        
        # Check for active joining tokens
        tokens_col = get_collection("joining_tokens")
        for doc in docs:
            token_record = await tokens_col.find_one({"candidate_id": str(doc["_id"])})
            if token_record:
                doc["has_joining_token"] = True
                doc["joining_token"] = token_record.get("token")
            else:
                doc["has_joining_token"] = False
                doc["joining_token"] = None
                
        return fix_ids(docs), total

    @classmethod
    async def get_candidate_by_id(cls, candidate_id: str) -> Optional[Dict[str, Any]]:
        col = get_collection("candidates")
        doc = await col.find_one({"_id": candidate_id})
        if not doc:
            return None
        
        tokens_col = get_collection("joining_tokens")
        token_record = await tokens_col.find_one({"candidate_id": str(doc["_id"])})
        if token_record:
            doc["has_joining_token"] = True
            doc["joining_token"] = token_record.get("token")
        else:
            doc["has_joining_token"] = False
            doc["joining_token"] = None
            
        return fix_id(doc)

    @classmethod
    async def update_candidate(cls, candidate_id: str, req: CandidateUpdateRequest) -> Optional[Dict[str, Any]]:
        col = get_collection("candidates")
        update_data = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
        if not update_data:
            return await cls.get_candidate_by_id(candidate_id)

        update_data["updated_at"] = datetime.utcnow().isoformat()
        await col.update_one({"_id": candidate_id}, {"$set": update_data})
        return await cls.get_candidate_by_id(candidate_id)

    @classmethod
    async def update_candidate_status(cls, candidate_id: str, status: str, notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
        col = get_collection("candidates")
        update_data: Dict[str, Any] = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat()
        }
        if notes:
            update_data["interview_notes"] = notes

        await col.update_one({"_id": candidate_id}, {"$set": update_data})
        return await cls.get_candidate_by_id(candidate_id)

    @classmethod
    async def delete_candidate(cls, candidate_id: str) -> bool:
        col = get_collection("candidates")
        res = await col.delete_one({"_id": candidate_id})
        return res.deleted_count > 0
