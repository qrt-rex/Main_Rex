import html
import logging
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.reports.worker")


class ReportBackgroundWorker:
    @staticmethod
    async def send_report_ready_email(
        recipient_email: str,
        report_title: str,
        download_url: str,
        scope: str
    ):
        try:
            subject = f"📊 Performance Report Ready: {report_title}"
            # The download needs a signed-in session, so the email points to the portal rather than
            # carrying a link (it used to link to a hard-coded http://127.0.0.1:8080 address).
            scope_label = html.escape(scope.replace("_", " ").title())
            body = f"""
            <div style="font-family:'Segoe UI', sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; padding:20px;">
                <h3 style="color:#007bff; margin-top:0;">Your Report Has Been Generated</h3>
                <p>The requested <strong>{scope_label}</strong> report (<strong>{html.escape(report_title)}</strong>) is ready.</p>
                <p>Sign in to the Rexera portal and open <strong>HR &rsaquo; Performance</strong> to download it.</p>
                <p style="font-size:12px; color:#888;">Report reference: {html.escape(download_url.rsplit('/', 1)[-1])}</p>
            </div>
            """

            await EmailService.send_custom_email(
                recipient_email=recipient_email,
                subject=subject,
                html_body=body
            )
            logger.info(f"Report ready email sent to {recipient_email}")
        except Exception as e:
            logger.error(f"Failed to dispatch report ready email: {e}")
