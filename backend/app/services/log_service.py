import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from app.database import get_collection, fix_id, fix_ids
from app.utils.validators import search_pattern

logger = logging.getLogger("rexera.logs")


class LogService:
    COLLECTION = "activity_logs"

    @classmethod
    async def create_log(
        cls,
        action: str,
        performed_by: str,
        performed_by_role: str = "admin",
        target: str = "",
        target_id: str = "",
        details: Optional[Dict[str, Any]] = None,
        ip_address: str = "",
    ) -> Dict[str, Any]:
        """Insert a new activity log entry."""
        col = get_collection(cls.COLLECTION)
        now = datetime.utcnow().isoformat()

        doc = {
            "action": action,
            "performed_by": performed_by,
            "performed_by_role": performed_by_role,
            "target": target,
            "target_id": target_id,
            "details": details or {},
            "ip_address": ip_address,
            "timestamp": now,
        }

        res = await col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
        doc["_id"] = str(res.inserted_id)
        logger.info(f"LOG [{action}] by {performed_by} -> {target or 'N/A'}")
        return doc

    @classmethod
    async def get_logs(
        cls,
        page: int = 1,
        limit: int = 50,
        action_filter: Optional[str] = None,
        search: Optional[str] = None,
        performed_by: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Retrieve paginated activity logs with optional filters."""
        col = get_collection(cls.COLLECTION)
        query: Dict[str, Any] = {}

        if action_filter and action_filter.upper() != "ALL":
            query["action"] = action_filter.upper()

        if performed_by:
            query["performed_by"] = performed_by

        if search and search.strip():
            pattern = search_pattern(search)
            query["$or"] = [
                {"performed_by": {"$regex": pattern, "$options": "i"}},
                {"target": {"$regex": pattern, "$options": "i"}},
                {"action": {"$regex": pattern, "$options": "i"}},
            ]

        if date_from:
            query.setdefault("$and", []).append({"timestamp": {"$gte": date_from}})
        if date_to:
            # A bare date means "through the end of that day": '2026-09-25T10:00' > '2026-09-25'.
            end = f"{date_to}T23:59:59.999999" if len(date_to) == 10 else date_to
            query.setdefault("$and", []).append({"timestamp": {"$lte": end}})

        total = await col.count_documents(query)
        skip = (page - 1) * limit
        cursor = col.find(query).sort("timestamp", -1).skip(skip).limit(limit)
        docs = await cursor.to_list(limit)

        return fix_ids(docs), total

    @classmethod
    async def log_login(cls, admin_email: str, admin_name: str, role: str, ip: str = ""):
        return await cls.create_log(
            action="LOGIN",
            performed_by=admin_email,
            performed_by_role=role,
            target=admin_name,
            details={"message": f"{admin_name} logged in successfully"},
            ip_address=ip,
        )

    @classmethod
    async def log_logout(cls, admin_email: str, admin_name: str, role: str, ip: str = ""):
        return await cls.create_log(
            action="LOGOUT",
            performed_by=admin_email,
            performed_by_role=role,
            target=admin_name,
            details={"message": f"{admin_name} logged out manually"},
            ip_address=ip,
        )

    @classmethod
    async def log_session_timeout(cls, admin_email: str, admin_name: str, role: str, ip: str = ""):
        return await cls.create_log(
            action="SESSION_TIMEOUT",
            performed_by=admin_email,
            performed_by_role=role,
            target=admin_name,
            details={"message": f"{admin_name} was auto-logged out due to 1 hour of inactivity"},
            ip_address=ip,
        )

    @classmethod
    async def log_candidate_status_change(
        cls,
        admin_email: str,
        admin_role: str,
        candidate_name: str,
        candidate_id: str,
        old_status: str,
        new_status: str,
        notes: str = "",
    ):
        return await cls.create_log(
            action="CANDIDATE_STATUS_CHANGE",
            performed_by=admin_email,
            performed_by_role=admin_role,
            target=candidate_name,
            target_id=candidate_id,
            details={
                "old_status": old_status,
                "new_status": new_status,
                "notes": notes,
                "message": f"{candidate_name}'s status changed from {old_status} to {new_status}",
            },
        )

    @classmethod
    async def log_onboarding_completed(cls, employee_name: str, employee_code: str, candidate_id: str = ""):
        return await cls.create_log(
            action="ONBOARDING_COMPLETED",
            performed_by="system",
            performed_by_role="system",
            target=employee_name,
            target_id=candidate_id,
            details={
                "employee_code": employee_code,
                "message": f"{employee_name} completed onboarding (bank details & HR policy agreement) and was assigned Employee ID {employee_code}",
            },
        )

    @classmethod
    async def get_notifications(cls, performed_by: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
        """Recent candidate-status-change and onboarding-completion events for the dashboard feed."""
        col = get_collection(cls.COLLECTION)
        notif_actions = ["CANDIDATE_STATUS_CHANGE", "ONBOARDING_COMPLETED"]

        if performed_by:
            # Non-superadmin: see their own status changes, plus all onboarding completions
            query: Dict[str, Any] = {
                "$or": [
                    {"action": "CANDIDATE_STATUS_CHANGE", "performed_by": performed_by},
                    {"action": "ONBOARDING_COMPLETED"},
                ]
            }
        else:
            query = {"action": {"$in": notif_actions}}

        cursor = col.find(query).sort("timestamp", -1).limit(limit)
        docs = await cursor.to_list(limit)
        return fix_ids(docs)

    @classmethod
    async def log_payroll_adjustment(
        cls,
        admin_email: str,
        admin_role: str,
        employee_name: str,
        employee_id: str,
        adjustment_type: str,
        field: str,
        old_value: float,
        new_value: float,
        amount: float,
        reason: str,
    ):
        return await cls.create_log(
            action=f"PAYROLL_{adjustment_type.upper()}",
            performed_by=admin_email,
            performed_by_role=admin_role,
            target=employee_name,
            target_id=employee_id,
            details={
                "field": field,
                "adjustment_type": adjustment_type,
                "old_value": old_value,
                "new_value": new_value,
                "amount": amount,
                "reason": reason,
            },
        )
