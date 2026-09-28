import asyncio
import html
import logging
from typing import List, Dict, Any
from app.services.email_service import EmailService
from app.database import get_collection

logger = logging.getLogger("rexera.broadcast.worker")


class BroadcastBatchEmailWorker:
    BATCH_SIZE = 50
    INTER_BATCH_DELAY = 2

    @classmethod
    def _build_branded_broadcast_email(
        cls,
        title: str,
        rich_html_content: str,
        priority: str,
        recipient_name: str,
        requires_ack: bool
    ) -> str:
        priority_colors = {
            "INFO": "#007bff",
            "IMPORTANT": "#ffc107",
            "POLICY_UPDATE": "#6f42c1",
            "CRITICAL_EMERGENCY": "#dc3545"
        }
        theme_color = priority_colors.get(priority, "#007bff")
        # rich_html_content is sanitised when the broadcast is created; the rest is plain text.
        title = html.escape(title)
        recipient_name = html.escape(recipient_name or "Colleague")
        priority = html.escape(priority)

        ack_banner = ""
        if requires_ack:
            # (This used to link to a hard-coded http://127.0.0.1:8080 address.)
            ack_banner = f"""
            <div style="background:#fff3cd; border-left:4px solid #ffc107; padding:14px; margin:20px 0; border-radius:4px;">
                <strong style="color:#856404;">Action Required:</strong>
                Please sign in to the Rexera HR portal to read and acknowledge this notice.
            </div>
            """

        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; }}
                .container {{ max-width: 620px; margin: auto; background: #ffffff; border-radius: 8px; border: 1px solid #e1e4e8; overflow: hidden; }}
                .header {{ background-color: {theme_color}; color: #ffffff; padding: 22px 25px; }}
                .badge {{ display: inline-block; background: rgba(255,255,255,0.25); padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 8px; }}
                .content {{ padding: 30px 25px; color: #333333; line-height: 1.6; font-size: 15px; }}
                .footer {{ background: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #888888; border-top: 1px solid #eeeeee; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="badge">{priority.replace('_', ' ')}</div>
                    <h2 style="margin:0; font-size:20px; color:#ffffff;">{title}</h2>
                </div>
                <div class="content">
                    <p style="margin-top:0;">Dear <strong>{recipient_name}</strong>,</p>
                    
                    <div style="margin: 20px 0;">
                        {rich_html_content}
                    </div>

                    {ack_banner}
                </div>
                <div class="footer">
                    Rexera HRMS &bull; Official Company Announcement System<br>
                    This is an official communication from HR Operations.
                </div>
            </div>
        </body>
        </html>
        """

    @classmethod
    async def dispatch_broadcast_in_batches(
        cls,
        broadcast_id: str,
        title: str,
        rich_html_content: str,
        priority: str,
        requires_ack: bool,
        recipients_list: List[Dict[str, str]]
    ):
        total = len(recipients_list)
        logger.info(f"Starting mass email broadcast {broadcast_id} to {total} recipients.")

        broadcast_col = get_collection("broadcasts")
        dispatched_total = 0

        for i in range(0, total, cls.BATCH_SIZE):
            chunk = recipients_list[i : i + cls.BATCH_SIZE]
            
            tasks = []
            for recipient in chunk:
                html_email = cls._build_branded_broadcast_email(
                    title=title,
                    rich_html_content=rich_html_content,
                    priority=priority,
                    recipient_name=recipient.get("name") or "Colleague",
                    requires_ack=requires_ack
                )
                tasks.append(
                    EmailService.send_custom_email(
                        recipient_email=recipient["email"],
                        subject=f"[{priority.replace('_', ' ')}] {title}",
                        html_body=html_email
                    )
                )

            results = await asyncio.gather(*tasks, return_exceptions=True)
            success_in_batch = sum(1 for r in results if r is True)
            dispatched_total += success_in_batch

            await broadcast_col.update_one(
                {"broadcast_id": broadcast_id},
                {"$inc": {"emails_dispatched_count": success_in_batch}}
            )

            logger.info(f"Batch {i // cls.BATCH_SIZE + 1} processed ({dispatched_total}/{total} sent).")

            if i + cls.BATCH_SIZE < total:
                await asyncio.sleep(cls.INTER_BATCH_DELAY)

        logger.info(f"Mass email broadcast {broadcast_id} completed. Total Sent: {dispatched_total}/{total}.")
