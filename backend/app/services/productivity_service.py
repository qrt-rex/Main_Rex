import logging
from datetime import datetime
from typing import Dict, Any

from app.database import get_collection, fix_id
from app.schemas.productivity import TimesheetEntry, TaskStatus, LogTimesheetRequest, FlagBlockerRequest

logger = logging.getLogger("rexera.productivity")


class ProductivityService:
    @classmethod
    async def validate_attendance_for_logging(cls, employee_id: str, work_date: str):
        """
        STRICT ATTENDANCE & LEAVE VALIDATION GATE:
        Prevents logging hours on approved-leave days or days marked Absent/Week-off/Holiday.
        """
        att_col = get_collection("attendance")
        leave_col = get_collection("leave_requests")
        emp_col = get_collection("employees")

        emp = await emp_col.find_one({"$or": [{"employee_code": employee_id}, {"employee_id": employee_id}, {"_id": employee_id}]})
        emp_identifiers = [employee_id]
        if emp:
            for k in ["employee_code", "employee_id", "_id"]:
                if emp.get(k) and str(emp[k]) not in emp_identifiers:
                    emp_identifiers.append(str(emp[k]))

        on_leave = await leave_col.find_one({
            "employee_id": {"$in": emp_identifiers},
            "status": "APPROVED",
            "start_date": {"$lte": work_date},
            "end_date": {"$gte": work_date}
        })
        if on_leave:
            raise ValueError(
                f"Cannot log timesheet: You are on an approved {on_leave.get('leave_type')} Leave on {work_date}."
            )

        att = await att_col.find_one({
            "employee_id": {"$in": emp_identifiers},
            "attendance_date": work_date
        })
        if att and att.get("status") in ["ABSENT", "WEEK_OFF", "HOLIDAY"]:
            raise ValueError(
                f"Cannot log timesheet: Attendance for {work_date} is marked as '{att.get('status')}'."
            )

    @classmethod
    async def log_task_timesheet(cls, payload: LogTimesheetRequest) -> Dict[str, Any]:
        task_col = get_collection("project_tasks")
        timesheet_col = get_collection("timesheets")
        emp_col = get_collection("employees")
        project_col = get_collection("projects")

        task = await task_col.find_one({"_id": payload.task_id})
        if not task:
            raise ValueError(f"Task ID {payload.task_id} does not exist.")

        emp = await emp_col.find_one({"$or": [{"employee_code": payload.employee_id}, {"employee_id": payload.employee_id}, {"_id": payload.employee_id}]})
        if not emp:
            raise ValueError(f"Employee {payload.employee_id} not found.")

        emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))

        # 1. Enforce Attendance Gate
        await cls.validate_attendance_for_logging(emp_id, payload.work_date)

        # 2. Daily Over-Logging Protection (Max 24 hrs/day)
        existing_logs = await timesheet_col.find({
            "employee_id": emp_id,
            "work_date": payload.work_date
        }).to_list(100)

        current_day_total = sum(float(l.get("hours_spent", 0.0)) for l in existing_logs)
        if current_day_total + payload.hours_spent > 24.0:
            raise ValueError(
                f"Over-logging limit exceeded: You have already logged {current_day_total:.2f} hrs on {payload.work_date}. "
                f"Adding {payload.hours_spent:.2f} hrs exceeds the 24.0-hour maximum."
            )

        # 3. Create Timesheet Entry
        entry = TimesheetEntry(
            employee_id=emp_id,
            employee_name=emp.get("full_name", "Unknown"),
            department=emp.get("department", "General"),
            task_id=payload.task_id,
            task_title=task.get("task_title", "Untitled Task"),
            project_id=task.get("project_id", "PROJ-DEFAULT"),
            project_name=task.get("project_name", "General Project"),
            client_id=task.get("client_id", "GENERAL"),
            client_name=task.get("client_name", "General"),
            work_date=payload.work_date,
            hours_spent=payload.hours_spent,
            work_description=payload.work_description
        )

        doc = entry.dict(by_alias=True)
        res = await timesheet_col.insert_one(doc)
        doc["_id"] = str(res.inserted_id)

        # 4. Atomically update Task and Project logged hours
        now_utc = datetime.utcnow()
        task_update = {
            "$inc": {"actual_hours_logged": payload.hours_spent},
            "$set": {"updated_at": now_utc}
        }
        if payload.task_new_status:
            task_update["$set"]["status"] = payload.task_new_status.value
            if payload.task_new_status != TaskStatus.BLOCKED:
                task_update["$set"]["is_blocked"] = False

        await task_col.update_one({"_id": task["_id"]}, task_update)
        if task.get("project_id"):
            await project_col.update_one(
                {"_id": task["project_id"]},
                {"$inc": {"logged_hours_total": payload.hours_spent}}
            )

        return {"timesheet": fix_id(doc), "task_id": payload.task_id}

    @classmethod
    async def flag_task_blocked(cls, payload: FlagBlockerRequest) -> Dict[str, Any]:
        task_col = get_collection("project_tasks")
        project_col = get_collection("projects")
        emp_col = get_collection("employees")

        task = await task_col.find_one({"_id": payload.task_id})
        if not task:
            raise ValueError(f"Task ID {payload.task_id} not found.")

        emp = await emp_col.find_one({"employee_code": payload.employee_id})
        if not emp:
            emp = await emp_col.find_one({"employee_id": payload.employee_id})
        if not emp:
            emp = await emp_col.find_one({"_id": payload.employee_id})
        emp_name = emp.get("full_name", "Unknown") if emp else "Unknown"

        project = None
        if task.get("project_id"):
            project = await project_col.find_one({"_id": task.get("project_id")})
        pm_email = project.get("project_manager_email", "hr@rexera.co.in") if project else "hr@rexera.co.in"

        now_utc = datetime.utcnow()
        update_data = {
            "status": TaskStatus.BLOCKED.value,
            "is_blocked": True,
            "blocker_category": payload.blocker_category.value,
            "blocker_reason": payload.blocker_reason,
            "blocked_at": now_utc,
            "blocked_by_name": emp_name,
            "updated_at": now_utc
        }

        await task_col.update_one({"_id": task["_id"]}, {"$set": update_data})
        updated_task = await task_col.find_one({"_id": task["_id"]})

        return {
            "task": fix_id(updated_task),
            "project_manager_email": pm_email,
            "employee_name": emp_name,
            "task_title": task.get("task_title"),
            "project_name": task.get("project_name", "Project"),
            "client_name": task.get("client_name", "Client")
        }
