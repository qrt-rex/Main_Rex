import asyncio
import html
import logging
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.attendance.alerts")


class AttendanceAlertWorker:
    @staticmethod
    async def send_late_login_warning(
        employee_name: str,
        employee_email: str,
        punch_time_local: str,
        late_minutes: int,
        is_third_late: bool = False,
        penalty_details: str = None
    ):
        """
        Dispatches firm but polite warning email to tardy employees.
        """
        try:
            subject = f"Attendance Notice: Late Arrival Logged ({punch_time_local})"
            employee_name = html.escape(str(employee_name or ""))
            penalty_details = html.escape(penalty_details) if penalty_details else None

            penalty_banner = ""
            if is_third_late:
                penalty_banner = f"""
                <div style="background:#fff3cd; border-left:4px solid #ffc107; padding:12px; margin:15px 0; color:#856404; font-size:14px;">
                    <strong>Policy Alert:</strong> You have accumulated 3 late arrivals this month. 
                    <br>{penalty_details or 'A deduction has been scheduled per company attendance policy.'}
                </div>
                """

            html_content = f"""
            <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">
                <div style="background:#2b3a4a; color:#ffffff; padding:20px; text-align:center;">
                    <h2 style="margin:0; font-size:20px; letter-spacing:0.5px;">Rexera Attendance Alert</h2>
                </div>
                <div style="padding:24px; color:#333333; line-height:1.6;">
                    <p>Dear <strong>{employee_name}</strong>,</p>
                    <p>This is an automated notification to inform you that your login today was recorded at <strong>{punch_time_local}</strong>, which is <strong>{late_minutes} minutes</strong> after the shift start and past the grace period.</p>
                    
                    {penalty_banner}
                    
                    <p>Please ensure adherence to standard office timings. Consistent punctuality ensures seamless team collaboration and operational excellence.</p>
                    
                    <p style="margin-top:20px; font-size:12px; color:#777777;">
                        If you believe this was logged in error or you had prior approval for delayed arrival, please submit a regularisation request via the HR portal.
                    </p>
                </div>
                <div style="background:#f8f9fa; padding:12px; text-align:center; font-size:12px; color:#888888; border-top:1px solid #eeeeee;">
                    Rexera HRMS &bull; Automated Attendance Engine
                </div>
            </div>
            """
            
            await EmailService.send_custom_email(
                recipient_email=employee_email,
                subject=subject,
                html_body=html_content
            )
            logger.info(f"Late warning successfully delivered to {employee_email}")
        except Exception as e:
            logger.error(f"Failed to dispatch late warning email to {employee_email}: {e}")

    @staticmethod
    async def send_half_day_breach_alert(
        employee_name: str,
        employee_email: str,
        employee_id: str,
        department: str,
        event_time_local: str,
        reason: str,
        hr_recipient: str = "hr@rexera.co.in"
    ):
        """
        Dispatches dual notifications:
        1. HR Alert notifying of rule breach.
        2. Employee notice notifying of Half-Day deduction.
        """
        try:
            hr_subject = f"Attendance Exception: Half-Day Marked for {employee_name} ({employee_id})"
            emp_subject = f"Important: Half-Day Deduction Applied ({reason})"
            employee_name, employee_id, department, event_time_local, reason = (
                html.escape(str(v or "")) for v in (employee_name, employee_id, department, event_time_local, reason)
            )
            hr_body = f"""
            <div style="font-family:'Segoe UI', sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; padding:20px;">
                <h3 style="color:#d9534f; margin-top:0;">Attendance Policy Breach: Half-Day Incurred</h3>
                <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:12px;">
                    <tr><td style="padding:6px; color:#666;">Employee:</td><td style="font-weight:bold;">{employee_name} ({employee_id})</td></tr>
                    <tr><td style="padding:6px; color:#666;">Department:</td><td>{department}</td></tr>
                    <tr><td style="padding:6px; color:#666;">Event Time:</td><td>{event_time_local}</td></tr>
                    <tr><td style="padding:6px; color:#666;">Reason:</td><td style="color:#c9302c; font-weight:bold;">{reason}</td></tr>
                </table>
            </div>
            """
            
            emp_body = f"""
            <div style="font-family:'Segoe UI', sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; padding:20px;">
                <h3 style="color:#c9302c; margin-top:0;">Attendance Notice: Half-Day Deduction</h3>
                <p>Dear <strong>{employee_name}</strong>,</p>
                <p>Your attendance for today has been recorded as <strong>HALF-DAY</strong> due to the following policy condition:</p>
                <div style="background:#fde8e8; border-left:4px solid #e53e3e; padding:10px; margin:12px 0; color:#9b1c1c; font-weight:bold;">
                    {reason}
                </div>
                <p style="font-size:13px; color:#555;">This deduction will automatically reflect in the monthly payroll cycle.</p>
            </div>
            """

            await asyncio.gather(
                EmailService.send_custom_email(hr_recipient, hr_subject, hr_body),
                EmailService.send_custom_email(employee_email, emp_subject, emp_body),
                return_exceptions=True
            )
            logger.info(f"Half-day dual alerts dispatched for employee {employee_id}")
        except Exception as e:
            logger.error(f"Error sending half day breach alerts: {e}")
