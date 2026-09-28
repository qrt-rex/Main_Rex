import html
import logging
from typing import Dict, Any, Optional
from app.services.email_service import EmailService

logger = logging.getLogger("rexera.bulk_import.alerts")


class ImportAlertWorker:
    @staticmethod
    async def send_import_completion_email(
        recipient_email: str,
        job_id: str,
        target_entity: str,
        inserted: int,
        updated: int,
        failed: int,
        is_dry_run: bool,
        error_url: Optional[str] = None
    ):
        try:
            mode_tag = "[DRY RUN VALIDATION]" if is_dry_run else "[IMPORT COMPLETED]"
            subject = f"{mode_tag} Bulk Import Summary for {target_entity} (Job #{job_id[:8]})"

            target_entity = html.escape(str(target_entity))
            error_section = ""
            if failed > 0:
                # The error report needs a signed-in session, so point to the portal (this used to be
                # a link to a hard-coded http://127.0.0.1:8080 address).
                error_section = f"""
                <div style="background:#fff3cd; border-left:4px solid #ffc107; padding:12px; margin:15px 0;">
                    <strong style="color:#856404;">⚠️ Partial Failures Detected:</strong> {failed} rows had validation errors.
                    <br>Open <strong>HR &rsaquo; Data import</strong> in the Rexera portal to download the error report
                    (job {html.escape(job_id[:8])}).
                </div>
                """

            body = f"""
            <div style="font-family:'Segoe UI', sans-serif; max-width:550px; margin:auto; border:1px solid #e0e0e0; border-radius:8px; padding:20px;">
                <h3 style="color:#2b3a4a; margin-top:0;">{mode_tag} Bulk Processing Report</h3>
                <p>Your bulk data processing request for <strong>{target_entity}</strong> has finished.</p>
                
                <table style="width:100%; border-collapse:collapse; font-size:14px; margin:15px 0;">
                    <tr style="background:#f8f9fa;"><td style="padding:8px;">New Records Inserted:</td><td><strong style="color:#28a745;">{inserted}</strong></td></tr>
                    <tr><td style="padding:8px;">Existing Records Updated:</td><td><strong style="color:#007bff;">{updated}</strong></td></tr>
                    <tr style="background:#f8f9fa;"><td style="padding:8px;">Invalid / Failed Rows:</td><td><strong style="color:#dc3545;">{failed}</strong></td></tr>
                </table>
                
                {error_section}
                
                <p style="font-size:12px; color:#777; margin-top:20px;">
                    Rexera HRMS &bull; Smart Data Ingestion Engine
                </p>
            </div>
            """

            await EmailService.send_custom_email(
                recipient_email=recipient_email,
                subject=subject,
                html_body=body
            )
            logger.info(f"Bulk import completion email dispatched to {recipient_email}")
        except Exception as e:
            logger.error(f"Error sending import completion email: {e}")
