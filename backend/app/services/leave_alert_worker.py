import html
import logging
from typing import Dict, Any, List, Optional
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.leave.alerts")


class LeaveAlertWorker:
    @staticmethod
    async def send_new_leave_application_alert(
        leave_request: Dict[str, Any],
        conflict_info: Dict[str, Any],
        recipients: Optional[List[str]] = None
    ):
        try:
            esc = lambda v: html.escape(str(v if v is not None else ""))
            raw_name = leave_request["employee_name"]
            emp_name = esc(raw_name)
            dept = esc(leave_request["department"])
            leave_type = esc(leave_request["leave_type"])
            start_date = esc(leave_request["start_date"])
            end_date = esc(leave_request["end_date"])
            days = leave_request["total_days"]
            reason = esc(leave_request["reason"])
            manager_email = leave_request.get("manager_email") or "hr@rexera.co.in"

            conflict_banner = ""
            if conflict_info.get("has_conflict"):
                conflict_banner = f"""
                <div style="background:#fff3cd; border-left:4px solid #ffc107; padding:12px; margin:15px 0; color:#856404; font-size:13px;">
                    <strong>Understaffing Warning:</strong> {conflict_info.get('conflict_count')} other employee(s) in <strong>{dept}</strong> are already on leave during this period.
                </div>
                """

            lop_notice = ""
            if leave_request.get("is_loss_of_pay"):
                lop_notice = f"""
                <p style="color:#d9534f; font-weight:bold;">
                    Note: Quota exhausted. Request includes {leave_request.get('lop_days')} day(s) Loss of Pay (LOP).
                </p>
                """

            subject = f"New Leave Request: {raw_name} ({leave_request['leave_type']} - {days} Days)"
            body = f"""
            <div style="font-family:'Segoe UI', sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; padding:20px;">
                <h3 style="color:#2b3a4a; margin-top:0;">New Leave Application Received</h3>
                <table style="width:100%; font-size:14px; border-collapse:collapse; margin-top:10px;">
                    <tr><td style="padding:6px; color:#666;">Employee:</td><td><strong>{emp_name}</strong> ({dept})</td></tr>
                    <tr><td style="padding:6px; color:#666;">Leave Type:</td><td><strong>{leave_type}</strong></td></tr>
                    <tr><td style="padding:6px; color:#666;">Period:</td><td>{start_date} to {end_date} (<strong>{days} days</strong>)</td></tr>
                    <tr><td style="padding:6px; color:#666;">Reason:</td><td>{reason}</td></tr>
                </table>
                {lop_notice}
                {conflict_banner}
                <div style="margin-top:20px; text-align:center;">
                    <p style="font-size:12px; color:#777;">Log in to the HR Portal to review, approve, or reject this application.</p>
                </div>
            </div>
            """

            for to in (recipients or [manager_email]):
                await EmailService.send_custom_email(recipient_email=to, subject=subject, html_body=body)
            logger.info(f"Leave request alert dispatched to: {recipients or [manager_email]}")
        except Exception as e:
            logger.error(f"Error dispatching leave application alert: {e}")

    @staticmethod
    async def send_leave_decision_notification(
        leave_request: Dict[str, Any],
        action: str
    ):
        try:
            esc = lambda v: html.escape(str(v if v is not None else ""))
            emp_email = leave_request["employee_email"]
            emp_name = esc(leave_request["employee_name"])
            raw_type = leave_request["leave_type"]
            leave_type = esc(raw_type)
            start_date = esc(leave_request["start_date"])
            end_date = esc(leave_request["end_date"])
            days = leave_request["total_days"]
            remarks = esc(leave_request.get("rejection_reason") or "Approved by HR")

            is_approved = (action == "APPROVE")
            status_color = "#28a745" if is_approved else "#d9534f"
            status_text = "APPROVED" if is_approved else "REJECTED"

            subject = f"Leave Request Update: {status_text} ({raw_type} - {days} Days)"
            body = f"""
            <div style="font-family:'Segoe UI', sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; padding:20px;">
                <h3 style="color:{status_color}; margin-top:0;">Your Leave Request has been {status_text}</h3>
                <p>Dear <strong>{emp_name}</strong>,</p>
                <p>Your application for <strong>{leave_type}</strong> from <strong>{start_date}</strong> to <strong>{end_date}</strong> ({days} days) has been <strong>{status_text}</strong>.</p>
                <div style="background:#f8f9fa; border-left:4px solid {status_color}; padding:10px; margin:15px 0;">
                    <strong>HR Remarks:</strong> {remarks}
                </div>
                <p style="font-size:12px; color:#777;">Your attendance records and leave balances have been updated automatically.</p>
            </div>
            """

            await EmailService.send_custom_email(
                recipient_email=emp_email,
                subject=subject,
                html_body=body
            )
            logger.info(f"Leave decision ({status_text}) sent to {emp_email}")
        except Exception as e:
            logger.error(f"Error dispatching leave decision email: {e}")
