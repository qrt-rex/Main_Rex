import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status, Query
from app.services.auth_service import get_current_admin
from app.services.audit_service import AuditService
from app.services.email_service import EmailService
from app.database import get_collection, fix_id
from app.schemas.advanced_payroll import CompanyPayrollSettings, AuditLogEntry, EmailLogResponse
from app.utils.validators import optional_phone
from datetime import datetime

logger = logging.getLogger("rexera.router.settings")
router = APIRouter(prefix="/api/payroll-settings", tags=["Payroll Settings & Compliance"])

@router.get("", response_model=CompanyPayrollSettings)
async def get_payroll_settings(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Retrieve global company payroll configuration and rules."""
    col = get_collection("payroll_settings")
    doc = await col.find_one({"type": "company_settings"})
    if not doc:
        # Default settings
        default_cfg = CompanyPayrollSettings().model_dump()
        default_cfg["type"] = "company_settings"
        default_cfg["created_at"] = datetime.utcnow().isoformat()
        await col.insert_one(default_cfg)
        return CompanyPayrollSettings(**default_cfg)
    
    # Hide raw password for security
    res = dict(doc)
    if "smtp" in res and "smtp_password" in res["smtp"]:
        pass_len = len(res["smtp"].get("smtp_password", ""))
        res["smtp"]["smtp_password"] = "••••••••" if pass_len > 0 else ""
    return CompanyPayrollSettings(**res)

@router.put("", response_model=CompanyPayrollSettings)
async def update_payroll_settings(
    req: CompanyPayrollSettings,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Update company payroll configuration, compliance settings, and SMTP configuration."""
    col = get_collection("payroll_settings")
    existing = await col.find_one({"type": "company_settings"})
    
    data = req.model_dump()
    try:
        data["company_phone"] = optional_phone(data.get("company_phone"), "Company phone")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    # Preserve existing password if the masked placeholder (or nothing) was submitted
    if data.get("smtp", {}).get("smtp_password") in ("••••••••", None):
        data["smtp"]["smtp_password"] = ((existing or {}).get("smtp") or {}).get("smtp_password", "")

    data["type"] = "company_settings"
    data["updated_at"] = datetime.utcnow().isoformat()

    if existing:
        await col.update_one({"_id": existing["_id"]}, {"$set": data})
    else:
        await col.insert_one(data)

    await AuditService.log_action(
        user_email=admin.get("email", "admin"),
        user_role=admin.get("role", "admin"),
        action="Updated Company Payroll Settings",
        entity_type="settings",
        entity_id="company_settings"
    )

    updated = await col.find_one({"type": "company_settings"})
    res = dict(updated)
    if "smtp" in res and "smtp_password" in res["smtp"]:
        pass_len = len(res["smtp"].get("smtp_password", ""))
        res["smtp"]["smtp_password"] = "••••••••" if pass_len > 0 else ""
    return CompanyPayrollSettings(**res)

@router.post("/test-smtp")
async def test_smtp_connection(
    test_recipient: str = Query("hr@rexera.co.in"),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Test SMTP connection by dispatching a test verification message."""
    subject = "Rexera HR - SMTP Configuration Diagnostic Test"
    body = f"""<p>This is a test diagnostic email from the Rexera HR Payroll system to verify SMTP outbound transport.</p>
<p>Generated at: {datetime.utcnow().isoformat()} UTC</p>"""
    
    ok, err = await EmailService.send_email(
        to_email=test_recipient,
        subject=subject,
        html_content=body
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SMTP Diagnostic Connection Failed: {err}"
        )
    return {"success": True, "message": f"SMTP test email successfully dispatched to {test_recipient}."}

@router.get("/audit-logs", response_model=List[AuditLogEntry])
async def get_audit_logs(
    entity_type: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve system audit logs for payroll, advances, and settings changes."""
    logs = await AuditService.get_audit_logs(entity_type=entity_type)
    return [AuditLogEntry(**fix_id(l)) for l in logs]

@router.get("/email-logs", response_model=List[EmailLogResponse])
async def get_email_logs(
    limit: int = Query(100, ge=1, le=2000),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve delivery history logs for all dispatched payslips."""
    logs = await EmailService.get_email_logs(limit=limit)
    return [EmailLogResponse(**fix_id(l)) for l in logs]
