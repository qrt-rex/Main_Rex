import html
import smtplib
import asyncio
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime
from app.config import settings
from app.database import get_collection, fix_ids

logger = logging.getLogger("rexera.email")

class EmailService:
    @classmethod
    async def get_effective_smtp_config(cls, allow_saved: bool = True) -> Dict[str, Any]:
        """Fetch custom SMTP settings from DB if configured, else fallback to settings.

        allow_saved=False forces the deployment's own transport. Security codes use it: anyone who
        can edit the saved SMTP server could otherwise route login/reset codes through their server.
        """
        env_cfg = {
            "smtp_host": settings.SMTP_HOST,
            "smtp_port": settings.SMTP_PORT,
            "smtp_user": settings.SMTP_USER,
            "smtp_password": settings.SMTP_PASSWORD,
            "smtp_encryption": "TLS",
            "from_name": settings.SMTP_FROM_NAME,
            "from_email": settings.SMTP_FROM_EMAIL,
            "email_dev_mode": settings.EMAIL_DEV_MODE
        }
        # The deployment environment decides how mail is delivered. A saved settings record must never
        # switch on simulation or replace the verified sender / API delivery.
        if settings.BREVO_API_KEY or not allow_saved:
            return env_cfg

        settings_col = get_collection("payroll_settings")
        doc = await settings_col.find_one({"type": "company_settings"})
        saved = (doc or {}).get("smtp") or {}
        if saved.get("smtp_user") and saved.get("smtp_password"):
            return {**saved, "email_dev_mode": settings.EMAIL_DEV_MODE}

        return env_cfg

    @classmethod
    async def get_effective_template(cls) -> Dict[str, Any]:
        """Fetch custom email template from DB if configured."""
        settings_col = get_collection("payroll_settings")
        doc = await settings_col.find_one({"type": "company_settings"})
        if doc and "email_template" in doc:
            return doc["email_template"]
        
        return {
            "subject_template": "Salary Payslip - {{month}} {{year}} - {{employee_code}}",
            "body_template": """Dear {{employee_name}},

Please find attached your official salary payslip for {{month}} {{year}}.

Summary of Details:
- Employee ID: {{employee_code}}
- Department: {{department}}
- Net Payable Salary: ₹{{net_salary}}
- Payslip Number: {{payslip_number}}

If you have any questions regarding your salary components, deductions, or attendance details, please contact the HR & Payroll team.

Best Regards,
{{company_name}} HR & Payroll Team"""
        }

    @classmethod
    def render_template(cls, template_str: str, context: Dict[str, Any]) -> str:
        res = template_str
        for k, v in context.items():
            res = res.replace(f"{{{{{k}}}}}", str(v if v is not None else ""))
        return res

    @classmethod
    async def send_email(
        cls,
        to_email: str,
        subject: str,
        html_content: str,
        attachment_bytes: Optional[bytes] = None,
        attachment_filename: Optional[str] = None,
        allow_saved_smtp: bool = True,
    ) -> Tuple[bool, Optional[str]]:
        """Send email via configured SMTP server or log to development console."""
        smtp_cfg = await cls.get_effective_smtp_config(allow_saved=allow_saved_smtp)
        dev_mode = smtp_cfg.get("email_dev_mode", True)
        smtp_user = smtp_cfg.get("smtp_user", "")
        smtp_pass = smtp_cfg.get("smtp_password", "")
        smtp_host = smtp_cfg.get("smtp_host", "smtp.hostinger.com")
        smtp_port = int(smtp_cfg.get("smtp_port", 587))
        from_name = smtp_cfg.get("from_name", "Rexera HR & Payroll")
        from_email = smtp_cfg.get("from_email", "no-reply@hr.rexera.in")

        logger.info(f"Dispatching email to {to_email} | Subject: {subject}")

        # Development Simulation Mode
        use_api = bool(settings.BREVO_API_KEY) and not dev_mode

        if not dev_mode and not use_api and (not smtp_user or not smtp_pass):
            logger.error("SMTP credentials are not configured; cannot send email.")
            return False, "SMTP credentials are not configured."

        if dev_mode:
            logger.info(f"[EMAIL SIMULATION] Sent to: {to_email} | Subject: {subject.encode('ascii', 'replace').decode('ascii')}")
            print(f"\n=======================================================")
            print(f"[EMAIL SIMULATION - SUCCESS]")
            print(f"To: {to_email}")
            print(f"From: {from_name} <{from_email}>")
            print(f"Subject: {subject.encode('ascii', 'replace').decode('ascii')}")
            if attachment_filename:
                print(f"Attachment: {attachment_filename} ({len(attachment_bytes or b'')} bytes)")
            print(f"=======================================================\n")
            return True, None

        if use_api:
            def _send_api():
                import base64, json, urllib.request, urllib.error
                payload = {
                    "sender": {"name": from_name, "email": from_email},
                    "to": [{"email": to_email}],
                    "subject": subject,
                    "htmlContent": html_content,
                }
                if attachment_bytes and attachment_filename:
                    payload["attachment"] = [{
                        "name": attachment_filename,
                        "content": base64.b64encode(attachment_bytes).decode("ascii"),
                    }]
                req = urllib.request.Request(
                    "https://api.brevo.com/v3/smtp/email",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"api-key": settings.BREVO_API_KEY, "content-type": "application/json", "accept": "application/json"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=20):
                        return True, None
                except urllib.error.HTTPError as e:
                    err_msg = f"Brevo API {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"
                except Exception as e:
                    err_msg = str(e)
                logger.error(f"Failed sending email to {to_email} via Brevo API as {from_email}: {err_msg}")
                return False, err_msg

            return await asyncio.get_event_loop().run_in_executor(None, _send_api)

        def _send_sync():
            try:
                msg = MIMEMultipart()
                msg["Subject"] = subject
                msg["From"] = f"{from_name} <{from_email}>"
                msg["To"] = to_email

                msg.attach(MIMEText(html_content, "html"))

                if attachment_bytes and attachment_filename:
                    part = MIMEApplication(attachment_bytes, Name=attachment_filename)
                    part['Content-Disposition'] = f'attachment; filename="{attachment_filename}"'
                    msg.attach(part)

                if smtp_port == 465:
                    server_ctx = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20)
                else:
                    server_ctx = smtplib.SMTP(smtp_host, smtp_port, timeout=20)
                with server_ctx as server:
                    if smtp_port != 465 and smtp_cfg.get("smtp_encryption", "TLS") == "TLS":
                        server.starttls()
                    server.login(smtp_user, smtp_pass)
                    server.sendmail(from_email, to_email, msg.as_string())
                return True, None
            except Exception as e:
                err_msg = str(e)
                logger.error(f"Failed sending email to {to_email} via {smtp_host}:{smtp_port} as {smtp_user}: {err_msg}")
                return False, err_msg

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _send_sync)

    @classmethod
    async def send_payslip_email(
        cls,
        employee_id: str,
        payroll_record: Dict[str, Any],
        payslip_html: str
    ) -> Dict[str, Any]:
        """
        Sends an individualized official payslip email with the attached PDF/HTML payslip.
        Logs the outcome to `email_logs`.
        """
        emp_col = get_collection("employees")
        logs_col = get_collection("email_logs")

        emp = await emp_col.find_one({"_id": employee_id})
        recipient_email = (emp.get("email") if emp else None) or payroll_record.get("email")
        if not recipient_email:
            # Log failure
            fail_log = {
                "employee_id": employee_id,
                "employee_code": payroll_record.get("employee_code", ""),
                "employee_name": payroll_record.get("employee_name", ""),
                "email": "Missing",
                "payslip_number": payroll_record.get("payslip_number") or "N/A",
                "month": payroll_record.get("month", ""),
                "year": payroll_record.get("year", 2026),
                "sent_at": datetime.utcnow().isoformat(),
                "status": "Failed",
                "error_message": "Employee email address is missing.",
                "retry_count": 0
            }
            await logs_col.insert_one(fail_log)
            return {"success": False, "message": "Employee email is missing.", "status": "Failed"}

        tpl_data = await cls.get_effective_template()
        context = {
            "employee_name": payroll_record.get("employee_name", ""),
            "employee_code": payroll_record.get("employee_code", ""),
            "employee_id": payroll_record.get("employee_code", ""),
            "department": payroll_record.get("department", ""),
            "designation": payroll_record.get("designation", ""),
            "month": payroll_record.get("month", ""),
            "year": payroll_record.get("year", 2026),
            "net_salary": f"{payroll_record.get('net_salary', 0):,.2f}",
            "company_name": settings.COMPANY_NAME,
            "payslip_number": payroll_record.get("payslip_number") or f"REX-PAY-{payroll_record.get('month')[:3].upper()}"
        }

        subject = cls.render_template(tpl_data.get("subject_template", "Salary Payslip"), context)
        # The template is written by an admin; the values come from employee records, so escape them.
        html_context = {k: html.escape(str(v)) for k, v in context.items()}
        raw_body = cls.render_template(tpl_data.get("body_template", "Please find your payslip attached."), html_context)
        recipient_name = html.escape(str(payroll_record.get("employee_name") or ""))

        # Wrap body in styled HTML
        html_body = f"""<!DOCTYPE html>
<html>
<head>
<style>
body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; padding: 20px; }}
.card {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; }}
.hdr {{ background: linear-gradient(135deg, #09234b 0%, #0f3d7a 100%); color: #fff; padding: 25px; text-align: center; }}
.content {{ padding: 25px; white-space: pre-line; line-height: 1.6; font-size: 14px; }}
.footer {{ background: #f1f5f9; padding: 15px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }}
</style>
</head>
<body>
<div class="card">
    <div class="hdr">
        <h2 style="margin:0;">REXERA HR & PAYROLL</h2>
        <p style="margin:4px 0 0 0; font-size:12px; opacity:0.8;">Official Employee Payslip Notification</p>
    </div>
    <div class="content">
{raw_body}
    </div>
    <div class="footer">
        <p><strong>{settings.COMPANY_NAME}</strong> • {settings.COMPANY_ADDRESS}</p>
        <p>This is a confidential communication intended exclusively for {recipient_name}.</p>
    </div>
</div>
</body>
</html>"""

        attachment_filename = f"Payslip_{payroll_record.get('employee_code')}_{payroll_record.get('month')}_{payroll_record.get('year')}.html"
        attachment_bytes = payslip_html.encode("utf-8")

        ok, err = await cls.send_email(
            to_email=recipient_email,
            subject=subject,
            html_content=html_body,
            attachment_bytes=attachment_bytes,
            attachment_filename=attachment_filename
        )

        log_doc = {
            "employee_id": employee_id,
            "employee_code": payroll_record.get("employee_code", ""),
            "employee_name": payroll_record.get("employee_name", ""),
            "email": recipient_email,
            "payslip_number": context["payslip_number"],
            "month": payroll_record.get("month", ""),
            "year": payroll_record.get("year", 2026),
            "sent_at": datetime.utcnow().isoformat(),
            "status": "Sent" if ok else "Failed",
            "error_message": err,
            "retry_count": 0
        }
        await logs_col.insert_one(log_doc)

        return {
            "success": ok,
            "email": recipient_email,
            "status": "Sent" if ok else "Failed",
            "error": err
        }

    @classmethod
    async def get_email_logs(cls, limit: int = 200) -> List[Dict[str, Any]]:
        logs_col = get_collection("email_logs")
        docs = await logs_col.find({}).sort("sent_at", -1).to_list(limit)
        return fix_ids(docs)

    @classmethod
    async def send_otp_email(cls, to_email: str, otp: str, purpose: str = "Admin Login 2FA") -> bool:
        subject = f"Your Rexera Verification Code: {otp}"
        body = f"""
        <div style="padding: 20px; font-family: sans-serif;">
            <h2 style="color: #09234b; margin-top: 0;">One-Time Verification Code</h2>
            <p>You requested a verification code for <strong>{purpose}</strong> on the Rexera HR Portal.</p>
            <p>Use the following 6-digit code to complete your authentication:</p>
            <div style="background: #f8fafc; border: 2px dashed #09234b; border-radius: 8px; padding: 18px; text-align: center; margin: 20px 0;">
                <div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #09234b; font-family: monospace;">{otp}</div>
                <p style="margin: 8px 0 0 0; font-size: 13px; color: #64748b;">Code expires in {settings.OTP_EXPIRE_MINUTES} minutes</p>
            </div>
            <p style="color: #64748b; font-size: 12px;">If you did not initiate this request, please notify Rexera Security immediately.</p>
        </div>
        """
        ok, err = await cls.send_email(to_email, subject, body, allow_saved_smtp=False)
        return ok

    @classmethod
    async def send_joining_token_email(cls, to_email: str, candidate_name: str, token: str, position: str = "") -> bool:
        subject = f"Welcome to Rexera - Your Onboarding Joining Token: {token}"
        candidate_name, position, token = html.escape(candidate_name or ""), html.escape(position or ""), html.escape(token)
        portal_url = f"{settings.COMPANY_WEBSITE}/joining-login.html"
        body = f"""
        <div style="padding: 20px; font-family: sans-serif;">
            <h2 style="color: #09234b; margin-top: 0;">Welcome to Rexera Technologies!</h2>
            <p>Dear <strong>{candidate_name}</strong>,</p>
            <p>Congratulations on your selection for the position of <strong>{position}</strong> at Rexera.</p>
            <p>Please use your secure joining token below to access the Candidate Onboarding Portal and complete your statutory details and HR policy agreement:</p>
            <div style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 8px; padding: 18px; text-align: center; margin: 20px 0;">
                <div style="font-size: 28px; font-weight: 800; letter-spacing: 4px; color: #065f46; font-family: monospace;">{token}</div>
                <p style="margin: 8px 0 0 0; font-size: 13px; color: #047857;">Valid for single-use onboarding completion</p>
            </div>
            <p><a href="{portal_url}" style="background:#09234b; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px; font-weight:bold; display:inline-block;">Access Onboarding Portal ↗</a></p>
        </div>
        """
        ok, err = await cls.send_email(to_email, subject, body)
        return ok

    @classmethod
    async def send_custom_email(cls, recipient_email: str, subject: str, html_body: str) -> bool:
        ok, err = await cls.send_email(
            to_email=recipient_email,
            subject=subject,
            html_content=html_body
        )
        return ok

