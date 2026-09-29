import logging
from datetime import timedelta, date
from typing import List, Tuple, Optional
import calendar

from app.database import get_collection
from app.utils.validators import parse_iso_date
from app.schemas.analytics_reports import (
    DateRangePreset,
    TrendIndicator,
    PerformanceScoreBreakdown,
    IndividualPerformanceReport,
    CompanyWidePerformanceReport,
    DepartmentEfficiencyMetric,
    ChartDataPayload,
    ChartDataset
)

logger = logging.getLogger("rexera.performance.engine")


class PerformanceAnalyticsEngine:
    @staticmethod
    def resolve_date_range(
        preset: DateRangePreset,
        custom_start: Optional[str] = None,
        custom_end: Optional[str] = None
    ) -> Tuple[str, str, str, str, str]:
        today = date.today()
        
        if preset == DateRangePreset.THIS_MONTH:
            start = date(today.year, today.month, 1)
            _, last_day = calendar.monthrange(today.year, today.month)
            end = date(today.year, today.month, last_day)
            
            first_prior = (start - timedelta(days=1)).replace(day=1)
            _, last_prior_day = calendar.monthrange(first_prior.year, first_prior.month)
            p_start = first_prior
            p_end = date(first_prior.year, first_prior.month, last_prior_day)
            label = today.strftime("%B %Y")

        elif preset == DateRangePreset.LAST_MONTH:
            first = (date(today.year, today.month, 1) - timedelta(days=1)).replace(day=1)
            _, last_d = calendar.monthrange(first.year, first.month)
            start = first
            end = date(first.year, first.month, last_d)
            
            p_first = (start - timedelta(days=1)).replace(day=1)
            _, p_last_d = calendar.monthrange(p_first.year, p_first.month)
            p_start = p_first
            p_end = date(p_first.year, p_first.month, p_last_d)
            label = start.strftime("%B %Y")

        elif preset == DateRangePreset.YEAR_TO_DATE:
            start = date(today.year, 1, 1)
            end = today
            p_start = date(today.year - 1, 1, 1)
            # 29 Feb has no counterpart last year; clamp to the 28th instead of crashing.
            p_end = date(today.year - 1, today.month, min(today.day, calendar.monthrange(today.year - 1, today.month)[1]))
            label = f"YTD {today.year}"

        elif preset == DateRangePreset.THIS_QUARTER:
            q_first_month = 3 * ((today.month - 1) // 3) + 1
            start = date(today.year, q_first_month, 1)
            q_last_month = q_first_month + 2
            end = date(today.year, q_last_month, calendar.monthrange(today.year, q_last_month)[1])
            p_end = start - timedelta(days=1)
            p_first_month = 3 * ((p_end.month - 1) // 3) + 1
            p_start = date(p_end.year, p_first_month, 1)
            label = f"Q{(q_first_month - 1) // 3 + 1} {today.year}"

        else:
            if not custom_start or not custom_end:
                raise ValueError("A custom range needs both a start date and an end date.")
            start = parse_iso_date(custom_start, "Start date")
            end = parse_iso_date(custom_end, "End date")
            if end < start:
                raise ValueError("The end date cannot be earlier than the start date.")
            c_start, c_end = start.isoformat(), end.isoformat()
            delta_days = (end - start).days + 1
            p_end = start - timedelta(days=1)
            p_start = p_end - timedelta(days=max(1, delta_days - 1))
            label = f"{c_start} to {c_end}"

        return (
            start.strftime("%Y-%m-%d"),
            end.strftime("%Y-%m-%d"),
            p_start.strftime("%Y-%m-%d"),
            p_end.strftime("%Y-%m-%d"),
            label
        )

    @classmethod
    def calculate_composite_score(
        cls,
        present_days: int,
        late_days: int,
        absent_days: int,
        logged_hours: float,
        target_hours: float,
        completed_tasks: int,
        total_tasks: int,
        blocked_tasks: int
    ) -> PerformanceScoreBreakdown:
        total_sched_days = max(1, present_days + late_days + absent_days)
        
        on_time_days = max(0, present_days)
        att_rate = ((on_time_days * 1.0 + late_days * 0.7) / total_sched_days)
        att_score = round(min(30.0, max(0.0, att_rate * 30.0)), 1)

        prod_ratio = (logged_hours / target_hours) if target_hours > 0 else 1.0
        prod_score = round(min(30.0, max(0.0, prod_ratio * 30.0)), 1)

        if total_tasks > 0:
            task_ratio = (completed_tasks / total_tasks)
            task_score = round(min(30.0, max(0.0, task_ratio * 30.0)), 1)
        else:
            task_score = 25.0

        blocker_penalty = min(10.0, blocked_tasks * 2.5)
        blocker_score = round(max(0.0, 10.0 - blocker_penalty), 1)

        total = round(att_score + prod_score + task_score + blocker_score, 1)

        if total >= 90.0:
            grade = "A+ (Elite)"
        elif total >= 80.0:
            grade = "A (High)"
        elif total >= 65.0:
            grade = "B (Standard)"
        else:
            grade = "C (Needs Improvement)"

        return PerformanceScoreBreakdown(
            overall_score=total,
            grade=grade,
            attendance_score=att_score,
            productivity_hours_score=prod_score,
            task_completion_score=task_score,
            blocker_mitigation_score=blocker_score
        )

    @classmethod
    def calculate_trend(cls, metric_name: str, current: float, previous: float, higher_is_better: bool = True) -> TrendIndicator:
        if previous > 0:
            delta = round(((current - previous) / previous) * 100.0, 1)
        else:
            delta = 0.0

        direction = "FLAT"
        if delta > 0.5:
            direction = "UP"
        elif delta < -0.5:
            direction = "DOWN"

        is_pos = (direction == "UP" and higher_is_better) or (direction == "DOWN" and not higher_is_better) or (direction == "FLAT")

        return TrendIndicator(
            metric_name=metric_name,
            current_value=round(current, 2),
            previous_value=round(previous, 2),
            delta_percentage=delta,
            direction=direction,
            is_positive_trend=is_pos
        )

    @classmethod
    async def generate_individual_report(
        cls,
        employee_id: str,
        start_date: str,
        end_date: str,
        p_start: str,
        p_end: str,
        date_label: str
    ) -> IndividualPerformanceReport:
        emp_col = get_collection("employees")
        att_col = get_collection("attendance")
        ts_col = get_collection("timesheets")
        task_col = get_collection("project_tasks")

        emp = await emp_col.find_one({"employee_id": employee_id})
        if not emp:
            emp = await emp_col.find_one({"employee_code": employee_id})
        if not emp:
            emp = await emp_col.find_one({"_id": employee_id})
        if not emp:
            raise ValueError(f"Employee {employee_id} not found.")

        emp_id = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))

        att_docs = await att_col.find({
            "employee_id": emp_id,
            "attendance_date": {"$gte": start_date, "$lte": end_date}
        }).to_list(100)

        present_cnt = sum(1 for a in att_docs if a.get("status") == "PRESENT")
        late_cnt = sum(1 for a in att_docs if a.get("status") == "LATE" or a.get("is_late") is True)
        absent_cnt = sum(1 for a in att_docs if a.get("status") == "ABSENT")
        leave_cnt = sum(1 for a in att_docs if a.get("status") == "ON_LEAVE")

        ts_docs = await ts_col.find({
            "employee_id": emp_id,
            "work_date": {"$gte": start_date, "$lte": end_date}
        }).to_list(500)

        logged_hours = sum(float(t.get("hours_spent", 0.0)) for t in ts_docs)
        working_days_count = max(1, present_cnt + late_cnt)
        avg_daily = round(logged_hours / working_days_count, 2)

        prior_ts = await ts_col.find({
            "employee_id": emp_id,
            "work_date": {"$gte": p_start, "$lte": p_end}
        }).to_list(500)
        p_logged_hours = sum(float(t.get("hours_spent", 0.0)) for t in prior_ts)

        prior_att = await att_col.find({
            "employee_id": emp_id,
            "attendance_date": {"$gte": p_start, "$lte": p_end}
        }).to_list(100)
        p_present = sum(1 for a in prior_att if a.get("status") in ["PRESENT", "LATE"])

        prod_trend = cls.calculate_trend("Client Logged Hours", logged_hours, p_logged_hours, True)
        att_trend = cls.calculate_trend("Active Working Days", present_cnt + late_cnt, p_present, True)

        # Tasks created from the UI store the employee's record id, older ones the code.
        assignee_keys = [k for k in {emp_id, str(emp.get("_id")), emp.get("employee_id")} if k]
        tasks = await task_col.find({"assigned_to_id": {"$in": assignee_keys}}).to_list(2000)
        total_t = len(tasks)
        completed_t = sum(1 for t in tasks if t.get("status") == "COMPLETED")
        in_prog_t = sum(1 for t in tasks if t.get("status") in ["IN_PROGRESS", "UNDER_REVIEW"])
        blocked_t = sum(1 for t in tasks if t.get("status") == "BLOCKED" or t.get("is_blocked") is True)
        comp_rate = round((completed_t / total_t * 100.0), 1) if total_t > 0 else 100.0

        target_hrs = working_days_count * 8.0
        score_card = cls.calculate_composite_score(
            present_cnt, late_cnt, absent_cnt, logged_hours, target_hrs, completed_t, total_t, blocked_t
        )

        date_hours_map = {}
        for t in ts_docs:
            d_str = t.get("work_date")
            date_hours_map[d_str] = date_hours_map.get(d_str, 0.0) + float(t.get("hours_spent", 0.0))

        sorted_dates = sorted(date_hours_map.keys()) if date_hours_map else [start_date, end_date]
        daily_chart = ChartDataPayload(
            labels=sorted_dates,
            datasets=[
                ChartDataset(
                    label="Daily Client Hours",
                    data=[date_hours_map.get(d, 0.0) for d in sorted_dates],
                    borderColor="#007bff",
                    fill=True
                )
            ]
        )

        task_chart = ChartDataPayload(
            labels=["Completed", "In Progress", "Blocked"],
            datasets=[
                ChartDataset(
                    label="Task Distribution",
                    data=[float(completed_t), float(in_prog_t), float(blocked_t)],
                    backgroundColor=["#28a745", "#ffc107", "#dc3545"]
                )
            ]
        )

        return IndividualPerformanceReport(
            employee_id=emp_id,
            employee_name=emp.get("full_name", "Unknown"),
            department=emp.get("department", "General"),
            designation=emp.get("designation", "Staff"),
            date_range_label=date_label,
            start_date=start_date,
            end_date=end_date,
            score_card=score_card,
            total_present_days=present_cnt,
            total_late_days=late_cnt,
            total_absent_days=absent_cnt,
            total_leave_days=float(leave_cnt),
            total_client_hours_logged=round(logged_hours, 2),
            average_daily_hours=avg_daily,
            productivity_trend=prod_trend,
            attendance_trend=att_trend,
            tasks_total=total_t,
            tasks_completed=completed_t,
            tasks_in_progress=in_prog_t,
            tasks_blocked=blocked_t,
            task_completion_rate=comp_rate,
            daily_hours_chart=daily_chart,
            task_distribution_chart=task_chart
        )

    @classmethod
    async def generate_company_report(
        cls,
        start_date: str,
        end_date: str,
        p_start: str,
        p_end: str,
        date_label: str
    ) -> CompanyWidePerformanceReport:
        emp_col = get_collection("employees")
        ts_col = get_collection("timesheets")
        task_col = get_collection("project_tasks")

        employees = await emp_col.find({"employee_status": "Active"}).to_list(1000)
        timesheets = await ts_col.find({"work_date": {"$gte": start_date, "$lte": end_date}}).to_list(5000)
        prior_ts = await ts_col.find({"work_date": {"$gte": p_start, "$lte": p_end}}).to_list(5000)

        total_hours = sum(float(t.get("hours_spent", 0.0)) for t in timesheets)
        p_total_hours = sum(float(t.get("hours_spent", 0.0)) for t in prior_ts)
        hours_trend = cls.calculate_trend("Company Total Billed Hours", total_hours, p_total_hours, True)

        # Department and company figures are rolled up from each employee's real scorecard
        # (they used to be hard-coded: every department scored 85, efficiency was always 92.4%).
        dept_map = {}
        total_target_hours = 0.0
        for emp in employees:
            dept = emp.get("department", "General")
            if dept not in dept_map:
                dept_map[dept] = {"headcount": 0, "hours": 0.0, "scores": [], "completed": 0, "blocked": 0}
            dept_map[dept]["headcount"] += 1
            code = emp.get("employee_code") or emp.get("employee_id") or str(emp.get("_id"))
            try:
                rep = await cls.generate_individual_report(code, start_date, end_date, p_start, p_end, date_label)
            except ValueError:
                continue
            dept_map[dept]["scores"].append(rep.score_card.overall_score)
            dept_map[dept]["completed"] += rep.tasks_completed
            dept_map[dept]["blocked"] += rep.tasks_blocked
            total_target_hours += max(1, rep.total_present_days + rep.total_late_days) * 8.0

        for ts in timesheets:
            d = ts.get("department", "General")
            if d in dept_map:
                dept_map[d]["hours"] += float(ts.get("hours_spent", 0.0))

        tasks = await task_col.find({}).to_list(5000)
        blocker_cats = {}
        critical_blockers = []

        for t in tasks:
            if t.get("is_blocked"):
                cat = t.get("blocker_category", "OTHER")
                blocker_cats[cat] = blocker_cats.get(cat, 0) + 1
                critical_blockers.append({
                    "task_title": t.get("task_title"),
                    "project_name": t.get("project_name"),
                    "client_name": t.get("client_name"),
                    "assigned_to": t.get("assigned_to_name"),
                    "reason": t.get("blocker_reason"),
                    "blocked_at": str(t.get("blocked_at"))
                })

        dept_metrics = []
        all_scores: List[float] = []
        for d_name, d_val in dept_map.items():
            hc = d_val["headcount"]
            h_tot = round(d_val["hours"], 2)
            avg_h = round(h_tot / hc, 2) if hc > 0 else 0.0
            scores = d_val["scores"]
            all_scores += scores
            dept_metrics.append(DepartmentEfficiencyMetric(
                department=d_name,
                headcount=hc,
                total_hours_logged=h_tot,
                avg_hours_per_employee=avg_h,
                average_performance_score=round(sum(scores) / len(scores), 1) if scores else 0.0,
                tasks_completed_count=d_val["completed"],
                active_blockers_count=d_val["blocked"],
            ))

        client_hours = {}
        for ts in timesheets:
            c = ts.get("client_name", "General")
            client_hours[c] = client_hours.get(c, 0.0) + float(ts.get("hours_spent", 0.0))
        # No placeholder data: an empty period shows empty charts, never invented clients or blockers.

        client_chart = ChartDataPayload(
            labels=list(client_hours.keys()),
            datasets=[
                ChartDataset(
                    label="Client Hours",
                    data=[round(v, 2) for v in client_hours.values()],
                    backgroundColor=["#4e73df", "#1cc88a", "#36b9cc", "#f6c23e", "#e74a3b"]
                )
            ]
        )

        blocker_chart = ChartDataPayload(
            labels=list(blocker_cats.keys()),
            datasets=[
                ChartDataset(
                    label="Bottlenecks by Category",
                    data=[float(v) for v in blocker_cats.values()],
                    backgroundColor=["#e74a3b", "#f6c23e", "#858796", "#5a5c69"]
                )
            ]
        )

        return CompanyWidePerformanceReport(
            date_range_label=date_label,
            start_date=start_date,
            end_date=end_date,
            total_active_employees=len(employees),
            total_hours_billed_clients=round(total_hours, 2),
            # Logged client hours against 8 hours per working day of every active employee.
            company_wide_efficiency_rate=round(min(100.0, total_hours / total_target_hours * 100.0), 1) if total_target_hours else 0.0,
            company_avg_performance_score=round(sum(all_scores) / len(all_scores), 1) if all_scores else 0.0,
            overall_hours_trend=hours_trend,
            department_metrics=dept_metrics,
            client_billing_chart=client_chart,
            blocker_categories_chart=blocker_chart,
            top_critical_bottlenecks=critical_blockers[:5]
        )
