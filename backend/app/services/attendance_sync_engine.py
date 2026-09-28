import logging
from datetime import datetime, date
from typing import Optional, Dict, Any
from app.database import get_collection

logger = logging.getLogger("rexera.attendance.sync")


class AttendanceLeaveSync:
    """
    Safeguards attendance evaluators and cron jobs from falsely penalizing
    employees on approved leaves.
    """

    @staticmethod
    async def is_employee_on_approved_leave(employee_id: str, check_date_str: str) -> Optional[Dict[str, Any]]:
        """
        Checks if the employee has an approved leave spanning check_date_str.
        Returns the leave record if active, else None.
        """
        leave_col = get_collection("leave_requests")
        active_leave = await leave_col.find_one({
            "employee_id": employee_id,
            "status": "APPROVED",
            "start_date": {"$lte": check_date_str},
            "end_date": {"$gte": check_date_str}
        })
        return active_leave

    @classmethod
    async def run_end_of_day_attendance_cron(cls, target_date_str: Optional[str] = None):
        """
        Scheduled EOD Job:
        Identifies active employees with no punch-in.
        CRITICAL SYNC: Checks for approved leave; if on leave, marks ON_LEAVE instead of ABSENT.
        """
        if not target_date_str:
            target_date_str = datetime.utcnow().strftime("%Y-%m-%d")

        emp_col = get_collection("employees")
        att_col = get_collection("attendance")

        active_employees = await emp_col.find({"employee_status": "Active"}).to_list(1000)

        for emp in active_employees:
            emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
            
            existing_att = await att_col.find_one({
                "employee_id": emp_id,
                "attendance_date": target_date_str
            })

            if existing_att and existing_att.get("punch_in_time"):
                continue

            leave = await cls.is_employee_on_approved_leave(emp_id, target_date_str)
            
            if leave:
                status = "ON_LEAVE"
                remarks = f"Approved {leave.get('leave_type')} Leave"
            else:
                status = "ABSENT"
                remarks = "Auto-marked Absent: No punch-in recorded"

            await att_col.update_one(
                {"employee_id": emp_id, "attendance_date": target_date_str},
                {
                    "$set": {
                        "employee_id": emp_id,
                        "employee_name": emp.get("full_name", "Unknown"),
                        "employee_email": emp.get("email"),
                        "department": emp.get("department", "General"),
                        "attendance_date": target_date_str,
                        "status": status,
                        "is_late": False,
                        "is_half_day": False,
                        "remarks": remarks,
                        "updated_at": datetime.utcnow()
                    }
                },
                upsert=True
            )
