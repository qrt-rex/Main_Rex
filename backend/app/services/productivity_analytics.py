from datetime import datetime
from typing import Dict, Any
from app.database import get_collection
from app.schemas.productivity import UtilizationHealthStatus


class ProductivityAnalyticsEngine:
    @classmethod
    async def get_birds_eye_dashboard(cls, target_date: str) -> Dict[str, Any]:
        """
        Comprehensive HR Dashboard Aggregator:
        Combines Timesheets, Attendance, Projects, and Red Zone Blockers.
        """
        att_col = get_collection("attendance")
        timesheet_col = get_collection("timesheets")
        task_col = get_collection("project_tasks")
        project_col = get_collection("projects")
        emp_col = get_collection("employees")

        active_employees = await emp_col.find({"employee_status": "Active"}).to_list(1000)
        employee_metrics = []

        for emp in active_employees:
            emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))

            att_doc = await att_col.find_one({"employee_id": emp_id, "attendance_date": target_date})
            present_hours = float(att_doc.get("total_work_hours", 0.0)) if att_doc else 0.0
            # No attendance record is not the same as absent (punching was removed from the UI).
            attendance_status = att_doc.get("status", "NOT_RECORDED") if att_doc else "NOT_RECORDED"

            logs = await timesheet_col.find({"employee_id": emp_id, "work_date": target_date}).to_list(100)
            logged_hours = sum(float(l.get("hours_spent", 0.0)) for l in logs)

            if present_hours > 0:
                efficiency_pct = round(min(100.0, (logged_hours / present_hours) * 100.0), 1)
            else:
                efficiency_pct = 0.0

            health = UtilizationHealthStatus.OPTIMAL
            if attendance_status in ["PRESENT", "LATE", "HALF_DAY"] or (attendance_status == "NOT_RECORDED" and logged_hours > 0):
                if logged_hours < 4.0:
                    health = UtilizationHealthStatus.UNDERUTILIZED
                elif logged_hours >= 10.0:
                    health = UtilizationHealthStatus.BURNOUT_RISK
                elif logged_hours > 8.5:
                    health = UtilizationHealthStatus.OVERLOADED
            elif attendance_status == "ON_LEAVE":
                health = "ON_LEAVE"
            elif attendance_status == "NOT_RECORDED":
                health = "NO_DATA"
            else:
                health = "ABSENT"

            employee_metrics.append({
                "employee_id": emp_id,
                "employee_name": emp.get("full_name"),
                "department": emp.get("department", "General"),
                "attendance_status": attendance_status,
                "present_hours": present_hours,
                "logged_hours": round(logged_hours, 2),
                "efficiency_pct": efficiency_pct,
                "health_status": health,
                "tasks_count": len(logs)
            })

        projects = await project_col.find({"status": "ACTIVE"}).to_list(200)
        project_cards = []
        
        for p in projects:
            p_id = str(p.get("_id"))
            tasks = await task_col.find({"project_id": p_id}).to_list(500)
            total_tasks = len(tasks)
            completed_tasks = sum(1 for t in tasks if t.get("status") == "COMPLETED")
            blocked_tasks = sum(1 for t in tasks if t.get("is_blocked") is True)

            completion_pct = round((completed_tasks / total_tasks * 100.0), 1) if total_tasks > 0 else 0.0

            project_cards.append({
                "project_id": p_id,
                "project_name": p.get("project_name"),
                "client_name": p.get("client_name"),
                "project_manager": p.get("project_manager_name"),
                "total_tasks": total_tasks,
                "completed_tasks": completed_tasks,
                "blocked_tasks": blocked_tasks,
                "completion_percentage": completion_pct,
                "logged_hours_total": p.get("logged_hours_total", 0.0),
                "budget_hours": p.get("budget_hours", 0.0)
            })

        now_utc = datetime.utcnow()
        raw_blocked = await task_col.find({"is_blocked": True}).to_list(100)
        
        red_zone = []
        for b in raw_blocked:
            blocked_time = b.get("blocked_at")
            if isinstance(blocked_time, str):
                try:
                    blocked_time = datetime.fromisoformat(blocked_time)
                except Exception:
                    blocked_time = now_utc
            
            stuck_hours = 0.0
            if blocked_time:
                stuck_hours = round((now_utc - blocked_time).total_seconds() / 3600.0, 1)

            red_zone.append({
                "task_id": str(b.get("_id")),
                "task_title": b.get("task_title"),
                "project_name": b.get("project_name"),
                "client_name": b.get("client_name"),
                "assigned_to": b.get("assigned_to_name"),
                "blocker_category": b.get("blocker_category"),
                "blocker_reason": b.get("blocker_reason"),
                "blocked_at": blocked_time.isoformat() if blocked_time else None,
                "stuck_duration_hours": stuck_hours,
                "urgency_level": "CRITICAL" if stuck_hours > 24.0 else "WARNING"
            })

        return {
            "date": target_date,
            "summary_metrics": {
                "total_active_employees": len(active_employees),
                "underutilized_count": sum(1 for e in employee_metrics if e["health_status"] == UtilizationHealthStatus.UNDERUTILIZED),
                "burnout_risk_count": sum(1 for e in employee_metrics if e["health_status"] == UtilizationHealthStatus.BURNOUT_RISK),
                "total_red_zone_blockers": len(red_zone),
                "active_projects_count": len(project_cards)
            },
            "employee_efficiency": employee_metrics,
            "active_projects": project_cards,
            "red_zone_bottlenecks": red_zone
        }
