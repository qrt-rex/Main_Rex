import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from app.database import get_collection, fix_ids

logger = logging.getLogger("rexera.audit")

class AuditService:
    @classmethod
    async def log_action(
        cls,
        user_email: str,
        user_role: str,
        action: str,
        entity_type: str,
        entity_id: Optional[str] = None,
        employee_name: Optional[str] = None,
        old_value: Optional[Any] = None,
        new_value: Optional[Any] = None,
        ip_address: Optional[str] = "127.0.0.1"
    ):
        col = get_collection("audit_logs")
        now_str = datetime.utcnow().isoformat()

        doc = {
            "user_email": user_email,
            "user_role": user_role,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "employee_name": employee_name,
            "old_value": old_value,
            "new_value": new_value,
            "timestamp": now_str,
            "ip_address": ip_address
        }
        await col.insert_one(doc)

    @classmethod
    async def get_audit_logs(cls, entity_type: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        col = get_collection("audit_logs")
        query: Dict[str, Any] = {}
        if entity_type and entity_type.lower() != "all":
            query["entity_type"] = entity_type
        
        docs = await col.find(query).sort("timestamp", -1).to_list(limit)
        return fix_ids(docs)

    @classmethod
    async def create_notification(cls, title: str, message: str, category: str = "payroll", link: Optional[str] = None):
        col = get_collection("notifications")
        now_str = datetime.utcnow().isoformat()
        doc = {
            "title": title,
            "message": message,
            "category": category,
            "link": link,
            "is_read": False,
            "created_at": now_str
        }
        await col.insert_one(doc)

    @classmethod
    async def get_notifications(cls, limit: int = 50) -> List[Dict[str, Any]]:
        col = get_collection("notifications")
        docs = await col.find({}).sort("created_at", -1).to_list(limit)
        return fix_ids(docs)
