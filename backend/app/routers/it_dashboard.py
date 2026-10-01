"""
IT Command Center API routes.

Every route is RBAC-gated via the same Depends(enforce) guard used by the rest of the app
(see main.py, rbac_service.ROUTE_RULES).  High-risk operations (emergency access, rollback,
dangerous DB operations) require additional confirmation.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.services.auth_service import get_current_admin
from app.services.it_service import (
    AlertService,
    ActivityStreamService,
    BackupService,
    CRMMonitorService,
    DatabaseMonitorService,
    DeploymentService,
    EmergencyAccessService,
    HealthCheckService,
    ITAuditService,
    ITDashboardService,
    ITSearchService,
    ITTaskService,
    IncidentService,
    SecurityCenterService,
    SessionService,
    UserActivityService,
)

logger = logging.getLogger("rexera.router.it")
router = APIRouter(prefix="/api/it", tags=["IT Command Center"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else ""


def _ua(request: Request) -> Dict[str, str]:
    ua = request.headers.get("user-agent", "")
    return {"device": ua[:120], "browser": "", "os": ""}


# ---------------------------------------------------------------------------
# Dashboard Home
# ---------------------------------------------------------------------------
@router.get("/dashboard")
async def it_dashboard(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await ITDashboardService.dashboard_metrics()


@router.get("/health")
async def system_health(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await HealthCheckService.full_health()


# ---------------------------------------------------------------------------
# Activity Stream
# ---------------------------------------------------------------------------
@router.get("/activity-stream")
async def activity_stream(
    limit: int = 50,
    module: Optional[str] = None,
    user_email: Optional[str] = None,
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    return await ActivityStreamService.stream(limit=min(limit, 100), module=module, user_email=user_email)


# ---------------------------------------------------------------------------
# Audit Logs
# ---------------------------------------------------------------------------
@router.get("/audit-logs")
async def get_audit_logs(
    page: int = 1,
    limit: int = 50,
    action: Optional[str] = None,
    module: Optional[str] = None,
    user_email: Optional[str] = None,
    risk_level: Optional[str] = None,
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    from app.database import get_collection, fix_ids
    col = get_collection("audit_logs")
    query: Dict[str, Any] = {}
    if action and action.upper() != "ALL":
        query["action"] = action
    if module:
        query["module"] = module
    if user_email:
        query["user_email"] = user_email
    if risk_level and risk_level.lower() != "all":
        query["risk_level"] = risk_level.lower()
    total = await col.count_documents(query)
    docs = await col.find(query).sort("timestamp", -1).skip((page - 1) * limit).to_list(min(limit, 100))
    return {"items": fix_ids(docs), "total": total, "page": page, "limit": limit}


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------
@router.get("/incidents")
async def list_incidents(
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 25,
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    items, total = await IncidentService.list_incidents(status, page, limit)
    return {"items": items, "total": total, "page": page}


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    incident = await IncidentService.get(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.post("/incidents")
async def create_incident(request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Title is required")
    incident = await IncidentService.create(body, admin)
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="INCIDENT_CREATED",
        resource_type="incident", resource_id=incident.get("incident_id", ""),
        resource_name=body["title"], ip_address=_ip(request), risk_level="medium",
    )
    return incident


@router.patch("/incidents/{incident_id}")
async def update_incident(incident_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    new_status = body.get("status")
    if not new_status:
        raise HTTPException(status_code=400, detail="Status is required")
    result = await IncidentService.update_status(
        incident_id, new_status, admin,
        note=body.get("note", ""), resolution=body.get("resolution", ""), root_cause=body.get("root_cause", ""),
    )
    if not result:
        raise HTTPException(status_code=404, detail="Incident not found")
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="INCIDENT_STATUS_CHANGED",
        resource_type="incident", resource_id=incident_id,
        new_value=new_status, ip_address=_ip(request), risk_level="medium",
    )
    return result


# ---------------------------------------------------------------------------
# IT Tasks
# ---------------------------------------------------------------------------
@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    task_type: Optional[str] = None,
    page: int = 1,
    limit: int = 25,
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    items, total = await ITTaskService.list_tasks(status, assigned_to, task_type, page, limit)
    return {"items": items, "total": total, "page": page}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    task = await ITTaskService.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/tasks")
async def create_task(request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    if not body.get("title"):
        raise HTTPException(status_code=400, detail="Title is required")
    task = await ITTaskService.create(body, admin)
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="IT_TASK_CREATED",
        resource_type="it_task", resource_id=task.get("task_id", ""),
        resource_name=body["title"], ip_address=_ip(request), risk_level="low",
    )
    return task


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    result = await ITTaskService.update(task_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="IT_TASK_UPDATED",
        resource_type="it_task", resource_id=task_id,
        ip_address=_ip(request), risk_level="low",
    )
    return result


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------
@router.get("/alerts")
async def list_alerts(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    page: int = 1,
    limit: int = 25,
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    items, total = await AlertService.list_alerts(status, severity, page, limit)
    return {"items": items, "total": total, "page": page}


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    result = await AlertService.acknowledge(alert_id, admin)
    if not result:
        raise HTTPException(status_code=404, detail="Alert not found")
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="ALERT_ACKNOWLEDGED",
        resource_type="alert", resource_id=alert_id,
        ip_address=_ip(request), risk_level="low",
    )
    return result


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    result = await AlertService.resolve(alert_id, admin)
    if not result:
        raise HTTPException(status_code=404, detail="Alert not found")
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="ALERT_RESOLVED",
        resource_type="alert", resource_id=alert_id,
        ip_address=_ip(request), risk_level="low",
    )
    return result


# ---------------------------------------------------------------------------
# Security Center
# ---------------------------------------------------------------------------
@router.get("/security")
async def security_overview(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await SecurityCenterService.overview()


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
@router.get("/sessions")
async def active_sessions(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await SessionService.active_sessions()


@router.post("/sessions/{user_id}/revoke")
async def revoke_session(user_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    ok = await SessionService.revoke_user_session(user_id)
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="SESSION_REVOKED",
        resource_type="session", resource_id=user_id,
        ip_address=_ip(request), risk_level="high",
    )
    return {"success": ok}


# ---------------------------------------------------------------------------
# Deployments
# ---------------------------------------------------------------------------
@router.get("/deployments")
async def list_deployments(page: int = 1, limit: int = 10, admin: Dict[str, Any] = Depends(get_current_admin)):
    items, total = await DeploymentService.list_deployments(page, limit)
    return {"items": items, "total": total, "page": page}


@router.post("/deployments")
async def record_deployment(request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    result = await DeploymentService.record_deployment(body, admin)
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="DEPLOYMENT_RECORDED",
        resource_type="deployment", resource_id=result.get("deployment_id", ""),
        ip_address=_ip(request), risk_level="high",
    )
    return result


# ---------------------------------------------------------------------------
# Backups
# ---------------------------------------------------------------------------
@router.get("/backups")
async def list_backups(page: int = 1, limit: int = 10, admin: Dict[str, Any] = Depends(get_current_admin)):
    items, total = await BackupService.list_backups(page, limit)
    return {"items": items, "total": total, "page": page}


@router.post("/backups")
async def create_backup(request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    result = await BackupService.create_backup(body, admin)
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="BACKUP_CREATED",
        resource_type="backup", resource_id=result.get("backup_id", ""),
        ip_address=_ip(request), risk_level="medium",
    )
    return result


# ---------------------------------------------------------------------------
# Database Monitoring
# ---------------------------------------------------------------------------
@router.get("/database")
async def database_status(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await DatabaseMonitorService.status()


# ---------------------------------------------------------------------------
# CRM Monitoring
# ---------------------------------------------------------------------------
@router.get("/crm")
async def crm_overview(admin: Dict[str, Any] = Depends(get_current_admin)):
    return await CRMMonitorService.overview()


# ---------------------------------------------------------------------------
# Emergency Access
# ---------------------------------------------------------------------------
@router.post("/emergency-access/request")
async def request_emergency_access(request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    body = await request.json()
    if not body.get("reason"):
        raise HTTPException(status_code=400, detail="Reason is required for emergency access")
    result = await EmergencyAccessService.request_access(body, admin)
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="EMERGENCY_ACCESS_REQUESTED",
        resource_type="emergency_access", resource_id=result.get("access_id", ""),
        reason=body["reason"], ip_address=_ip(request), risk_level="critical",
    )
    return result


@router.post("/emergency-access/{access_id}/approve")
async def approve_emergency_access(access_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    result = await EmergencyAccessService.approve(access_id, admin)
    if not result:
        raise HTTPException(status_code=404, detail="Emergency access request not found or already processed")
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="EMERGENCY_ACCESS_APPROVED",
        resource_type="emergency_access", resource_id=access_id,
        ip_address=_ip(request), risk_level="critical",
    )
    return result


@router.post("/emergency-access/{access_id}/revoke")
async def revoke_emergency_access(access_id: str, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    result = await EmergencyAccessService.revoke(access_id, admin)
    if not result:
        raise HTTPException(status_code=404, detail="Emergency access request not found")
    await ITAuditService.log_event(
        user_email=admin.get("email", ""), user_name=admin.get("username", ""),
        user_role=admin.get("role", ""), action="EMERGENCY_ACCESS_REVOKED",
        resource_type="emergency_access", resource_id=access_id,
        ip_address=_ip(request), risk_level="critical",
    )
    return result


@router.get("/emergency-access")
async def list_emergency_access(page: int = 1, limit: int = 25, admin: Dict[str, Any] = Depends(get_current_admin)):
    items, total = await EmergencyAccessService.list_access(page, limit)
    return {"items": items, "total": total, "page": page}


# ---------------------------------------------------------------------------
# User Activity Profile
# ---------------------------------------------------------------------------
@router.get("/users/{user_id}/activity")
async def user_activity(user_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    profile = await UserActivityService.user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return profile


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------
@router.get("/search")
async def it_search(q: str = "", limit: int = 20, admin: Dict[str, Any] = Depends(get_current_admin)):
    return await ITSearchService.search(q, min(limit, 50))
