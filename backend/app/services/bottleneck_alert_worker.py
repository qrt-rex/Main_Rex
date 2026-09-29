import html
import logging
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.bottlenecks")


class BottleneckAlertWorker:
    @staticmethod
    async def send_bottleneck_escalation_alert(
        task_title: str,
        project_name: str,
        client_name: str,
        employee_name: str,
        blocker_category: str,
        blocker_reason: str,
        pm_email: str,
        hr_email: str = "hr@rexera.co.in"
    ):
        try:
            subject = f"🚨 RED ZONE BOTTLENECK ALERT: [{client_name}] {task_title} is BLOCKED"
            # Everything below is typed by users; escape it for the HTML body.
            client_name, project_name, task_title, employee_name, blocker_category, blocker_reason = (
                html.escape(str(v or "")) for v in
                (client_name, project_name, task_title, employee_name, blocker_category, blocker_reason)
            )

            body = f"""
            <div style="font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width:600px; margin:auto; border:2px solid #dc3545; border-radius:8px; overflow:hidden;">
                <div style="background:#dc3545; color:#ffffff; padding:16px; text-align:center;">
                    <h2 style="margin:0; font-size:18px; letter-spacing:0.5px;">TASK BOTTLENECK ESCALATION</h2>
                </div>
                <div style="padding:20px; color:#333333; line-height:1.6;">
                    <p>A client deliverable has been marked as <strong>BLOCKED</strong> and requires immediate management intervention.</p>
                    
                    <table style="width:100%; border-collapse:collapse; font-size:14px; margin:15px 0;">
                        <tr style="background:#f8f9fa;"><td style="padding:8px; font-weight:bold;">Client:</td><td>{client_name}</td></tr>
                        <tr><td style="padding:8px; font-weight:bold;">Project:</td><td>{project_name}</td></tr>
                        <tr style="background:#f8f9fa;"><td style="padding:8px; font-weight:bold;">Task:</td><td><strong>{task_title}</strong></td></tr>
                        <tr><td style="padding:8px; font-weight:bold;">Assignee:</td><td>{employee_name}</td></tr>
                        <tr style="background:#fff3cd;"><td style="padding:8px; font-weight:bold; color:#856404;">Blocker Category:</td><td style="color:#856404; font-weight:bold;">{blocker_category}</td></tr>
                    </table>
                    
                    <div style="background:#fde8e8; border-left:4px solid #dc3545; padding:12px; margin:15px 0; color:#721c24;">
                        <strong>Blocker Reason / Impediment:</strong>
                        <p style="margin:6px 0 0 0;">{blocker_reason}</p>
                    </div>
                    
                    <p style="font-size:13px; color:#555;">Please coordinate with the client/team to resolve this blocker and prevent SLA breaches.</p>
                </div>
                <div style="background:#f8f9fa; padding:10px; text-align:center; font-size:12px; color:#888;">
                    Rexera HRMS &bull; Real-Time Productivity & Bottleneck Engine
                </div>
            </div>
            """

            recipients = list(set([pm_email, hr_email]))
            for r in recipients:
                await EmailService.send_custom_email(
                    recipient_email=r,
                    subject=subject,
                    html_body=body
                )
            logger.info(f"Bottleneck escalation email sent to {recipients}")
        except Exception as e:
            logger.error(f"Failed to dispatch bottleneck escalation email: {e}")
