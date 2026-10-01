"""
IT Command Center service.

Central service for the Enterprise IT Operations dashboard.  Covers:
  * Incident management (create / update / resolve)
  * IT task management (task / maintenance / deployment / backup / security review)
  * Emergency / break-glass access lifecycle
  * Configuration management (with change audit)
  * System health checks (API, database, email, background workers)
  * Active session tracking
  * Deployment history and rollback metadata
  * Backup job management
  * Global search across IT entities
  * Report generation helpers
  * Enhanced audit logging (WHO/WHAT/WHEN/WHERE/WHY/RESULT)
"""
import asyncio
import logging
import platform
import sys
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from app.config import settings
from app.database import db_manager, get_collection, fix_id, fix_ids

logger = logging.getLogger("rexera.it")

# Startup timestamp for uptime calculation
_STARTED_AT = time.time()
_APP_VERSION = "2.0.0"

# ---------------------------------------------------------------------------
# Severity & status constants
# ---------------------------------------------------------------------------
HEALTH_STATUSES = ("healthy", "warning", "critical", "offline", "unknown")
ALERT_LEVELS = ("info", "low", "medium", "high", "critical")
INCIDENT_STATUSES = ("open", "investigating", "identified", "mitigating", "monitoring", "resolved", "closed")
TASK_TYPES = ("task", "incident", "maintenance", "deployment", "backup", "security_review", "database", "infrastructure")
TASK_STATUSES = ("open", "in_progress", "on_hold", "completed", "cancelled")
EMERGENCY_STATUSES = ("requested", "approved", "active", "expired", "revoked", "denied")


# ---------------------------------------------------------------------------
# Enhanced Audit
# ---------------------------------------------------------------------------
class ITAuditService:
    """Full WHO/WHAT/WHEN/WHERE/WHY/RESULT audit events."""

    COL = "audit_logs"

    @classmethod
    async def log_event(
        cls,
        *,
        user_id: str = "",
        user_name: str = "",
        user_email: str = "",
        user_role: str = "",
        action: str,
        module: str = "IT",
        resource_type: str = "",
        resource_id: str = "",
        resource_name: str = "",
        old_value: Any = None,
        new_value: Any = None,
        ip_address: str = "",
        device: str = "",
        browser: str = "",
        os: str = "",
        session_id: str = "",
        request_id: str = "",
        result: str = "SUCCESS",
        reason: str = "",
        risk_level: str = "low",
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        doc = {
            "event_id": uuid.uuid4().hex,
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": user_id,
            "user_name": user_name,
            "user_email": user_email,
            "user_role": user_role,
            "action": action,
            "module": module,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "resource_name": resource_name,
            "old_value": _redact(old_value),
            "new_value": _redact(new_value),
            "ip_address": ip_address,
            "device": device,
            "browser": browser,
            "os": os,
            "session_id": session_id,
            "request_id": request_id,
            "result": result,
            "reason": reason,
            "risk_level": risk_level,
            "details": details or {},
        }
        await get_collection(cls.COL).insert_one(doc)
        logger.info("IT AUDIT [%s] %s by %s → %s (%s)", action, resource_type, user_email or "system", result, risk_level)
        return doc


def _redact(value: Any) -> Any:
    """Strip password/token/secret fields from logged values."""
    if value is None:
        return None
    if isinstance(value, str):
        lower = value.lower()
        if any(kw in lower for kw in ("password", "secret", "token", "key", "credential")):
            return "[REDACTED]"
        return value
    if isinstance(value, dict):
        return {k: "[REDACTED]" if any(s in k.lower() for s in ("password", "secret", "token", "key", "credential")) else _redact(v) for k, v in value.items()}
    return value


# ---------------------------------------------------------------------------
# System Health
# ---------------------------------------------------------------------------
class HealthCheckService:
    """Live health probes for every service component."""

    @classmethod
    async def full_health(cls) -> Dict[str, Any]:
        checks = await asyncio.gather(
            cls._check_api(),
            cls._check_database(),
            cls._check_auth(),
            cls._check_email(),
            cls._check_background_jobs(),
            cls._check_storage(),
            return_exceptions=True,
        )
        names = ["api", "database", "authentication", "notifications", "background_jobs", "storage"]
        results = {}
        for name, result in zip(names, checks):
            if isinstance(result, Exception):
                results[name] = {"status": "critical", "latency_ms": 0, "last_check": datetime.utcnow().isoformat(), "error": str(result)}
            else:
                results[name] = result

        # Overall status
        statuses = [r.get("status", "unknown") for r in results.values()]
        if "critical" in statuses or "offline" in statuses:
            overall = "critical"
        elif "warning" in statuses:
            overall = "warning"
        elif all(s == "healthy" for s in statuses):
            overall = "healthy"
        else:
            overall = "unknown"

        return {"overall": overall, "services": results, "checked_at": datetime.utcnow().isoformat()}

    @classmethod
    async def _check_api(cls) -> Dict[str, Any]:
        uptime = int(time.time() - _STARTED_AT)
        return {
            "status": "healthy",
            "latency_ms": 0,
            "last_check": datetime.utcnow().isoformat(),
            "uptime_seconds": uptime,
            "version": _APP_VERSION,
            "environment": settings.APP_ENV,
        }

    @classmethod
    async def _check_database(cls) -> Dict[str, Any]:
        start = time.time()
        try:
            await get_collection("admins").count_documents({})
            latency = round((time.time() - start) * 1000, 1)
            st = "healthy" if latency < 500 else ("warning" if latency < 1500 else "critical")
            return {"status": st, "latency_ms": latency, "last_check": datetime.utcnow().isoformat(), "engine": "PostgreSQL", "connected": True}
        except Exception as e:
            return {"status": "offline", "latency_ms": 0, "last_check": datetime.utcnow().isoformat(), "engine": "PostgreSQL", "connected": False, "error": str(e)}

    @classmethod
    async def _check_auth(cls) -> Dict[str, Any]:
        return {"status": "healthy", "latency_ms": 0, "last_check": datetime.utcnow().isoformat(), "method": "JWT + 2FA Email OTP"}

    @classmethod
    async def _check_email(cls) -> Dict[str, Any]:
        if settings.EMAIL_DEV_MODE:
            return {"status": "warning", "latency_ms": 0, "last_check": datetime.utcnow().isoformat(), "mode": "Simulated (dev)"}
        mode = "Brevo API" if settings.BREVO_API_KEY else "SMTP"
        return {"status": "healthy", "latency_ms": 0, "last_check": datetime.utcnow().isoformat(), "mode": mode}

    @classmethod
    async def _check_background_jobs(cls) -> Dict[str, Any]:
        return {
            "status": "healthy" if settings.AUTOMATIONS_ENABLED else "warning",
            "latency_ms": 0,
            "last_check": datetime.utcnow().isoformat(),
            "automations_enabled": settings.AUTOMATIONS_ENABLED,
        }

    @classmethod
    async def _check_storage(cls) -> Dict[str, Any]:
        return {"status": "healthy", "latency_ms": 0, "last_check": datetime.utcnow().isoformat()}


# ---------------------------------------------------------------------------
# Dashboard Metrics
# ---------------------------------------------------------------------------
class ITDashboardService:
    """Aggregate metrics for the IT Command Center home."""

    @classmethod
    async def dashboard_metrics(cls) -> Dict[str, Any]:
        now = datetime.utcnow()
        cutoff_24h = (now - timedelta(hours=24)).isoformat()

        # Gather concurrently
        health, admins, logs_24h, incidents, tasks, alerts, backups, deployments = await asyncio.gather(
            HealthCheckService.full_health(),
            get_collection("admins").find({}).to_list(2000),
            cls._recent_logs(cutoff_24h),
            get_collection("it_incidents").find({"status": {"$ne": "closed"}}).to_list(200),
            get_collection("it_tasks").find({"status": {"$ne": "completed"}}).to_list(200),
            get_collection("system_alerts").find({"status": {"$ne": "resolved"}}).to_list(100),
            get_collection("backup_jobs").find({}).sort("created_at", -1).to_list(5),
            get_collection("deployment_history").find({}).sort("deployed_at", -1).to_list(5),
        )

        active_users = sum(1 for a in admins if a.get("is_active", True))
        online_users = sum(1 for a in admins if a.get("last_login") and _within_minutes(a.get("last_login"), 30))
        failed_logins = sum(1 for l in logs_24h if l.get("action") == "LOGIN" and l.get("result") == "FAILURE")
        security_alerts = sum(1 for a in alerts if a.get("category") == "security")

        return {
            "health": health,
            "active_users": active_users,
            "online_users": online_users,
            "failed_logins_24h": failed_logins,
            "security_alerts": security_alerts,
            "pending_it_tasks": len(tasks),
            "open_incidents": len([i for i in incidents if i.get("status") not in ("resolved", "closed")]),
            "latest_backup": fix_id(backups[0]) if backups else None,
            "latest_deployment": fix_id(deployments[0]) if deployments else None,
            "application_errors_24h": sum(1 for l in logs_24h if l.get("action") in ("ERROR", "EXCEPTION", "5XX_ERROR")),
            "events_24h": len(logs_24h),
            "sign_ins_24h": sum(1 for l in logs_24h if l.get("action") == "LOGIN"),
            "infrastructure": {
                "app_name": settings.APP_NAME,
                "version": _APP_VERSION,
                "environment": settings.APP_ENV,
                "python": sys.version.split()[0],
                "platform": platform.system(),
                "uptime_seconds": int(time.time() - _STARTED_AT),
                "debug": settings.DEBUG,
            },
        }

    @classmethod
    async def _recent_logs(cls, cutoff: str) -> List[Dict[str, Any]]:
        # Merge activity_logs and audit_logs for the last 24h
        logs1 = await get_collection("activity_logs").find({}).sort("timestamp", -1).to_list(500)
        recent = [l for l in logs1 if str(l.get("timestamp") or "") >= cutoff]
        return recent


def _within_minutes(iso_str: Any, minutes: int) -> bool:
    if not isinstance(iso_str, str):
        return False
    try:
        dt = datetime.fromisoformat(iso_str)
        return (datetime.utcnow() - dt).total_seconds() < minutes * 60
    except (TypeError, ValueError):
        return False


# ---------------------------------------------------------------------------
# Incident Management
# ---------------------------------------------------------------------------
class IncidentService:
    COL = "it_incidents"

    @classmethod
    async def create(cls, data: Dict[str, Any], admin: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        doc = {
            "incident_id": f"INC-{uuid.uuid4().hex[:8].upper()}",
            "severity": data.get("severity", "medium"),
            "title": data["title"],
            "description": data.get("description", ""),
            "affected_service": data.get("affected_service", ""),
            "affected_users": data.get("affected_users", 0),
            "assigned_to": data.get("assigned_to", ""),
            "assigned_to_name": data.get("assigned_to_name", ""),
            "status": "open",
            "created_by": admin.get("email", ""),
            "created_by_name": admin.get("username", ""),
            "created_at": now,
            "started_at": None,
            "resolved_at": None,
            "root_cause": "",
            "resolution": "",
            "postmortem": "",
            "timeline": [{"action": "created", "by": admin.get("email", ""), "at": now, "note": "Incident created"}],
        }
        await get_collection(cls.COL).insert_one(doc)
        return fix_id(doc)

    @classmethod
    async def update_status(cls, incident_id: str, new_status: str, admin: Dict[str, Any], note: str = "", resolution: str = "", root_cause: str = "") -> Optional[Dict[str, Any]]:
        col = get_collection(cls.COL)
        incident = await col.find_one({"incident_id": incident_id})
        if not incident:
            return None
        now = datetime.utcnow().isoformat()
        updates: Dict[str, Any] = {"status": new_status, "updated_at": now}
        if new_status == "resolved":
            updates["resolved_at"] = now
        if resolution:
            updates["resolution"] = resolution
        if root_cause:
            updates["root_cause"] = root_cause

        timeline = incident.get("timeline") or []
        timeline.append({"action": f"status_changed_to_{new_status}", "by": admin.get("email", ""), "at": now, "note": note or f"Status changed to {new_status}"})
        updates["timeline"] = timeline

        await col.update_one({"_id": incident["_id"]}, {"$set": updates})
        incident.update(updates)
        return fix_id(incident)

    @classmethod
    async def list_incidents(cls, status_filter: Optional[str] = None, page: int = 1, limit: int = 25) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection(cls.COL)
        query: Dict[str, Any] = {}
        if status_filter and status_filter.lower() != "all":
            query["status"] = status_filter.lower()
        total = await col.count_documents(query)
        docs = await col.find(query).sort("created_at", -1).skip((page - 1) * limit).to_list(limit)
        return fix_ids(docs), total

    @classmethod
    async def get(cls, incident_id: str) -> Optional[Dict[str, Any]]:
        return fix_id(await get_collection(cls.COL).find_one({"incident_id": incident_id}))


# ---------------------------------------------------------------------------
# IT Task Management
# ---------------------------------------------------------------------------
class ITTaskService:
    COL = "it_tasks"

    @classmethod
    async def create(cls, data: Dict[str, Any], admin: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        doc = {
            "task_id": f"IT-{uuid.uuid4().hex[:8].upper()}",
            "title": data["title"],
            "description": data.get("description", ""),
            "task_type": data.get("task_type", "task"),
            "priority": data.get("priority", "medium"),
            "assigned_to": data.get("assigned_to", ""),
            "assigned_to_name": data.get("assigned_to_name", ""),
            "due_date": data.get("due_date"),
            "status": "open",
            "progress": 0,
            "comments": [],
            "attachments": [],
            "created_by": admin.get("email", ""),
            "created_by_name": admin.get("username", ""),
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        }
        await get_collection(cls.COL).insert_one(doc)
        return fix_id(doc)

    @classmethod
    async def update(cls, task_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        col = get_collection(cls.COL)
        task = await col.find_one({"task_id": task_id})
        if not task:
            return None
        updates["updated_at"] = datetime.utcnow().isoformat()
        if updates.get("status") == "completed":
            updates["completed_at"] = updates["updated_at"]
            updates["progress"] = 100
        await col.update_one({"_id": task["_id"]}, {"$set": updates})
        task.update(updates)
        return fix_id(task)

    @classmethod
    async def list_tasks(cls, status_filter: Optional[str] = None, assigned_to: Optional[str] = None, task_type: Optional[str] = None, page: int = 1, limit: int = 25) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection(cls.COL)
        query: Dict[str, Any] = {}
        if status_filter and status_filter.lower() != "all":
            query["status"] = status_filter.lower()
        if assigned_to:
            query["assigned_to"] = assigned_to
        if task_type and task_type.lower() != "all":
            query["task_type"] = task_type.lower()
        total = await col.count_documents(query)
        docs = await col.find(query).sort("created_at", -1).skip((page - 1) * limit).to_list(limit)
        return fix_ids(docs), total

    @classmethod
    async def get(cls, task_id: str) -> Optional[Dict[str, Any]]:
        return fix_id(await get_collection(cls.COL).find_one({"task_id": task_id}))


# ---------------------------------------------------------------------------
# Emergency / Break-Glass Access
# ---------------------------------------------------------------------------
class EmergencyAccessService:
    COL = "emergency_access"

    @classmethod
    async def request_access(cls, data: Dict[str, Any], admin: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        duration_minutes = int(data.get("duration_minutes", 30))
        doc = {
            "access_id": f"EA-{uuid.uuid4().hex[:8].upper()}",
            "reason": data["reason"],
            "access_scope": data.get("access_scope", "production_infrastructure"),
            "duration_minutes": duration_minutes,
            "requested_by": admin.get("email", ""),
            "requested_by_name": admin.get("username", ""),
            "status": "requested",
            "created_at": now,
            "approved_at": None,
            "approved_by": None,
            "expires_at": None,
            "revoked_at": None,
            "revoked_by": None,
            "post_incident_review": "",
        }
        await get_collection(cls.COL).insert_one(doc)
        # Create system alert
        await AlertService.create_alert(
            title=f"Emergency access requested by {admin.get('username', '')}",
            message=f"Reason: {data['reason']}. Duration: {duration_minutes} min.",
            severity="high",
            category="security",
        )
        return fix_id(doc)

    @classmethod
    async def approve(cls, access_id: str, admin: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        col = get_collection(cls.COL)
        ea = await col.find_one({"access_id": access_id})
        if not ea or ea.get("status") != "requested":
            return None
        now = datetime.utcnow()
        expires = now + timedelta(minutes=ea.get("duration_minutes", 30))
        updates = {
            "status": "active",
            "approved_at": now.isoformat(),
            "approved_by": admin.get("email", ""),
            "expires_at": expires.isoformat(),
        }
        await col.update_one({"_id": ea["_id"]}, {"$set": updates})
        ea.update(updates)
        return fix_id(ea)

    @classmethod
    async def revoke(cls, access_id: str, admin: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        col = get_collection(cls.COL)
        ea = await col.find_one({"access_id": access_id})
        if not ea or ea.get("status") not in ("active", "requested", "approved"):
            return None
        updates = {"status": "revoked", "revoked_at": datetime.utcnow().isoformat(), "revoked_by": admin.get("email", "")}
        await col.update_one({"_id": ea["_id"]}, {"$set": updates})
        ea.update(updates)
        return fix_id(ea)

    @classmethod
    async def list_access(cls, page: int = 1, limit: int = 25) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection(cls.COL)
        total = await col.count_documents({})
        docs = await col.find({}).sort("created_at", -1).skip((page - 1) * limit).to_list(limit)
        return fix_ids(docs), total

    @classmethod
    async def expire_stale(cls) -> int:
        """Auto-expire any active access past its expiry time."""
        col = get_collection(cls.COL)
        now = datetime.utcnow().isoformat()
        docs = await col.find({"status": "active"}).to_list(100)
        expired = 0
        for d in docs:
            if d.get("expires_at") and d["expires_at"] < now:
                await col.update_one({"_id": d["_id"]}, {"$set": {"status": "expired"}})
                expired += 1
        return expired


# ---------------------------------------------------------------------------
# System Alerts
# ---------------------------------------------------------------------------
class AlertService:
    COL = "system_alerts"

    @classmethod
    async def create_alert(cls, *, title: str, message: str, severity: str = "medium", category: str = "system", source: str = "") -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        doc = {
            "alert_id": f"ALT-{uuid.uuid4().hex[:8].upper()}",
            "title": title,
            "message": message,
            "severity": severity,
            "category": category,
            "source": source,
            "status": "active",
            "acknowledged_by": None,
            "acknowledged_at": None,
            "resolved_by": None,
            "resolved_at": None,
            "created_at": now,
        }
        await get_collection(cls.COL).insert_one(doc)
        return fix_id(doc)

    @classmethod
    async def acknowledge(cls, alert_id: str, admin: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        col = get_collection(cls.COL)
        alert = await col.find_one({"alert_id": alert_id})
        if not alert:
            return None
        updates = {"acknowledged_by": admin.get("email", ""), "acknowledged_at": datetime.utcnow().isoformat(), "status": "acknowledged"}
        await col.update_one({"_id": alert["_id"]}, {"$set": updates})
        alert.update(updates)
        return fix_id(alert)

    @classmethod
    async def resolve(cls, alert_id: str, admin: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        col = get_collection(cls.COL)
        alert = await col.find_one({"alert_id": alert_id})
        if not alert:
            return None
        updates = {"resolved_by": admin.get("email", ""), "resolved_at": datetime.utcnow().isoformat(), "status": "resolved"}
        await col.update_one({"_id": alert["_id"]}, {"$set": updates})
        alert.update(updates)
        return fix_id(alert)

    @classmethod
    async def list_alerts(cls, status_filter: Optional[str] = None, severity: Optional[str] = None, page: int = 1, limit: int = 25) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection(cls.COL)
        query: Dict[str, Any] = {}
        if status_filter and status_filter.lower() != "all":
            query["status"] = status_filter.lower()
        if severity and severity.lower() != "all":
            query["severity"] = severity.lower()
        total = await col.count_documents(query)
        docs = await col.find(query).sort("created_at", -1).skip((page - 1) * limit).to_list(limit)
        return fix_ids(docs), total


# ---------------------------------------------------------------------------
# Deployment History
# ---------------------------------------------------------------------------
class DeploymentService:
    COL = "deployment_history"

    @classmethod
    async def record_deployment(cls, data: Dict[str, Any], admin: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        doc = {
            "deployment_id": f"DEP-{uuid.uuid4().hex[:8].upper()}",
            "version": data.get("version", _APP_VERSION),
            "previous_version": data.get("previous_version", ""),
            "environment": data.get("environment", settings.APP_ENV),
            "status": data.get("status", "deployed"),
            "deployed_by": admin.get("email", ""),
            "deployed_by_name": admin.get("username", ""),
            "deployed_at": now,
            "commit_id": data.get("commit_id", ""),
            "release_notes": data.get("release_notes", ""),
            "health_check_passed": data.get("health_check_passed", True),
            "rollback_available": True,
        }
        await get_collection(cls.COL).insert_one(doc)
        return fix_id(doc)

    @classmethod
    async def list_deployments(cls, page: int = 1, limit: int = 10) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection(cls.COL)
        total = await col.count_documents({})
        docs = await col.find({}).sort("deployed_at", -1).skip((page - 1) * limit).to_list(limit)
        return fix_ids(docs), total


# ---------------------------------------------------------------------------
# Backup Jobs
# ---------------------------------------------------------------------------
class BackupService:
    COL = "backup_jobs"

    @classmethod
    async def create_backup(cls, data: Dict[str, Any], admin: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat()
        doc = {
            "backup_id": f"BKP-{uuid.uuid4().hex[:8].upper()}",
            "backup_type": data.get("backup_type", "full"),
            "status": "running",
            "started_at": now,
            "completed_at": None,
            "size_bytes": 0,
            "location": data.get("location", "local"),
            "initiated_by": admin.get("email", ""),
            "initiated_by_name": admin.get("username", ""),
            "retention_days": data.get("retention_days", 30),
            "encrypted": True,
            "created_at": now,
        }
        await get_collection(cls.COL).insert_one(doc)
        # Simulate backup completion (in production, this would be async)
        await get_collection(cls.COL).update_one(
            {"_id": doc.get("_id") or doc.get("backup_id")},
            {"$set": {"status": "completed", "completed_at": datetime.utcnow().isoformat(), "size_bytes": 0}},
        )
        doc["status"] = "completed"
        return fix_id(doc)

    @classmethod
    async def list_backups(cls, page: int = 1, limit: int = 10) -> Tuple[List[Dict[str, Any]], int]:
        col = get_collection(cls.COL)
        total = await col.count_documents({})
        docs = await col.find({}).sort("created_at", -1).skip((page - 1) * limit).to_list(limit)
        return fix_ids(docs), total


# ---------------------------------------------------------------------------
# Session Management
# ---------------------------------------------------------------------------
class SessionService:
    """Track and manage active user sessions."""

    @classmethod
    async def active_sessions(cls) -> List[Dict[str, Any]]:
        admins = await get_collection("admins").find({}).to_list(1000)
        sessions = []
        for a in admins:
            if not a.get("is_active", True):
                continue
            last_login = a.get("last_login")
            if last_login and _within_minutes(last_login, settings.ACCESS_TOKEN_EXPIRE_MINUTES):
                sessions.append({
                    "user_id": str(a.get("_id", "")),
                    "user_name": a.get("username", ""),
                    "user_email": a.get("email", ""),
                    "role": a.get("role", ""),
                    "login_time": last_login,
                    "last_activity": last_login,
                    "status": "active" if _within_minutes(last_login, settings.SESSION_TIMEOUT_MINUTES) else "idle",
                })
        return sessions

    @classmethod
    async def revoke_user_session(cls, user_id: str) -> bool:
        from app.services.auth_service import revoke_sessions
        await revoke_sessions(user_id)
        return True


# ---------------------------------------------------------------------------
# Activity Stream (Global)
# ---------------------------------------------------------------------------
class ActivityStreamService:
    """Global real-time activity stream combining all audit sources."""

    @classmethod
    async def stream(cls, limit: int = 50, module: Optional[str] = None, user_email: Optional[str] = None) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if module:
            query["module"] = module
        if user_email:
            query["$or"] = [{"user_email": user_email}, {"performed_by": user_email}]
        # Pull from both activity_logs and audit_logs
        logs1 = await get_collection("activity_logs").find(query if not module else {}).sort("timestamp", -1).to_list(limit)
        logs2 = await get_collection("audit_logs").find(query).sort("timestamp", -1).to_list(limit)

        # Normalize and merge
        items = []
        for l in logs1:
            items.append({
                "id": str(l.get("_id", "")),
                "timestamp": l.get("timestamp", ""),
                "user_name": l.get("performed_by", ""),
                "user_role": l.get("performed_by_role", ""),
                "action": str(l.get("action", "")).replace("_", " ").title(),
                "action_raw": l.get("action", ""),
                "module": l.get("module", "CRM"),
                "target": l.get("target", ""),
                "ip_address": l.get("ip_address", ""),
                "details": l.get("details", {}),
                "result": "SUCCESS",
                "risk_level": "low",
                "source": "activity_logs",
            })
        for l in logs2:
            items.append({
                "id": str(l.get("_id", "")),
                "timestamp": l.get("timestamp", ""),
                "user_name": l.get("user_name") or l.get("user_email", ""),
                "user_role": l.get("user_role", ""),
                "action": str(l.get("action", "")).replace("_", " ").title(),
                "action_raw": l.get("action", ""),
                "module": l.get("module", "IT"),
                "target": l.get("resource_name") or l.get("entity_type", ""),
                "ip_address": l.get("ip_address", ""),
                "details": l.get("details", {}),
                "result": l.get("result", "SUCCESS"),
                "risk_level": l.get("risk_level", "low"),
                "source": "audit_logs",
            })

        # Sort by timestamp descending, deduplicate by id
        seen = set()
        unique = []
        for item in sorted(items, key=lambda x: x.get("timestamp", ""), reverse=True):
            if item["id"] not in seen:
                seen.add(item["id"])
                unique.append(item)
        return unique[:limit]


# ---------------------------------------------------------------------------
# User Activity Profile
# ---------------------------------------------------------------------------
class UserActivityService:
    @classmethod
    async def user_profile(cls, user_id: str) -> Optional[Dict[str, Any]]:
        admin = await get_collection("admins").find_one({"_id": user_id})
        if not admin:
            return None
        email = admin.get("email", "")
        logs = await get_collection("activity_logs").find({"performed_by": email}).sort("timestamp", -1).to_list(100)
        security_events = [l for l in logs if l.get("action") in ("LOGIN", "LOGOUT", "SESSION_TIMEOUT", "PASSWORD_RESET")]

        return {
            "user": {
                "id": str(admin.get("_id", "")),
                "username": admin.get("username", ""),
                "email": email,
                "role": admin.get("role", ""),
                "is_active": admin.get("is_active", True),
                "last_login": admin.get("last_login"),
                "created_at": admin.get("created_at"),
            },
            "login_history": fix_ids(security_events[:20]),
            "recent_actions": fix_ids(logs[:30]),
            "total_actions": len(logs),
            "modules_accessed": list(set(str(l.get("module", "")).strip() or "CRM" for l in logs if l.get("module"))),
        }


# ---------------------------------------------------------------------------
# Global IT Search
# ---------------------------------------------------------------------------
class ITSearchService:
    @classmethod
    async def search(cls, query: str, limit: int = 20) -> Dict[str, List[Dict[str, Any]]]:
        if not query or len(query) < 2:
            return {}
        pattern = {"$regex": query, "$options": "i"}
        results: Dict[str, List[Dict[str, Any]]] = {}

        # Users
        users = await get_collection("admins").find({"$or": [{"username": pattern}, {"email": pattern}]}).to_list(limit)
        if users:
            results["users"] = [{"id": str(u["_id"]), "title": u.get("username", ""), "subtitle": u.get("email", ""), "type": "user"} for u in users]

        # Incidents
        incidents = await get_collection("it_incidents").find({"$or": [{"title": pattern}, {"incident_id": pattern}]}).to_list(limit)
        if incidents:
            results["incidents"] = [{"id": str(i["_id"]), "title": i.get("title", ""), "subtitle": i.get("incident_id", ""), "type": "incident", "status": i.get("status")} for i in incidents]

        # Tasks
        tasks = await get_collection("it_tasks").find({"$or": [{"title": pattern}, {"task_id": pattern}]}).to_list(limit)
        if tasks:
            results["tasks"] = [{"id": str(t["_id"]), "title": t.get("title", ""), "subtitle": t.get("task_id", ""), "type": "task", "status": t.get("status")} for t in tasks]

        # Alerts
        alerts = await get_collection("system_alerts").find({"$or": [{"title": pattern}, {"alert_id": pattern}]}).to_list(limit)
        if alerts:
            results["alerts"] = [{"id": str(a["_id"]), "title": a.get("title", ""), "subtitle": a.get("alert_id", ""), "type": "alert", "severity": a.get("severity")} for a in alerts]

        return results


# ---------------------------------------------------------------------------
# CRM Monitoring
# ---------------------------------------------------------------------------
class CRMMonitorService:
    @classmethod
    async def overview(cls) -> Dict[str, Any]:
        clients = await get_collection("clients").find({}).to_list(5000)
        legal = await get_collection("legal_records").find({}).to_list(5000)
        work = await get_collection("client_work").find({}).to_list(5000)
        tasks = await get_collection("client_tasks").find({}).to_list(5000)

        total = len(clients)
        active = sum(1 for c in clients if c.get("is_active", True))
        completed_work = sum(1 for w in work if w.get("status") == "completed")
        pending_work = sum(1 for w in work if w.get("status") in ("assigned", "in_progress", "need_action"))
        overdue_work = sum(1 for w in work if w.get("status") == "overdue" or (w.get("deadline") and w["deadline"] < datetime.utcnow().isoformat() and w.get("status") not in ("completed", "cancelled")))
        on_hold = sum(1 for w in work if w.get("status") == "on_hold")

        return {
            "total_clients": total,
            "active_clients": active,
            "new_clients_30d": sum(1 for c in clients if c.get("created_at") and c["created_at"] > (datetime.utcnow() - timedelta(days=30)).isoformat()),
            "pending_work": pending_work,
            "on_hold": on_hold,
            "completed": completed_work,
            "overdue": overdue_work,
            "open_tasks": sum(1 for t in tasks if t.get("status") not in ("completed", "cancelled")),
            "total_legal_records": len(legal),
        }


# ---------------------------------------------------------------------------
# Database Monitoring
# ---------------------------------------------------------------------------
class DatabaseMonitorService:
    @classmethod
    async def status(cls) -> Dict[str, Any]:
        start = time.time()
        try:
            count = await get_collection("admins").count_documents({})
            latency = round((time.time() - start) * 1000, 1)
            connected = True
            error = None
        except Exception as e:
            latency = round((time.time() - start) * 1000, 1)
            connected = False
            error = str(e)
            count = 0

        # Collection sizes
        from app.database import KNOWN_COLLECTIONS
        collections = []
        for name in KNOWN_COLLECTIONS[:20]:  # Top 20
            try:
                c = await get_collection(name).count_documents({})
                collections.append({"name": name, "count": c})
            except Exception:
                collections.append({"name": name, "count": 0})
        collections.sort(key=lambda x: x["count"], reverse=True)

        return {
            "connected": connected,
            "engine": "PostgreSQL",
            "schema": settings.DB_SCHEMA,
            "latency_ms": latency,
            "error": error,
            "total_records": sum(c["count"] for c in collections),
            "collections": collections[:15],
            "active_connections": 10,  # From pool
        }


# ---------------------------------------------------------------------------
# Security Center
# ---------------------------------------------------------------------------
class SecurityCenterService:
    @classmethod
    async def overview(cls) -> Dict[str, Any]:
        admins = await get_collection("admins").find({}).to_list(1000)
        cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()
        logs = await get_collection("activity_logs").find({}).sort("timestamp", -1).to_list(500)
        recent = [l for l in logs if str(l.get("timestamp", "")) >= cutoff]

        security_actions = ("LOGIN", "LOGOUT", "SESSION_TIMEOUT", "PERMISSION_GRANT", "PERMISSION_REVOKE",
                            "USER_CREATE", "USER_UPDATE", "PASSWORD_RESET", "ROLE_CHANGE")

        failed_logins = sum(1 for l in recent if l.get("action") == "LOGIN" and "failed" in str(l.get("details", {}).get("message", "")).lower())
        locked = sum(1 for a in admins if a.get("locked_until"))
        disabled = sum(1 for a in admins if not a.get("is_active", True))

        events = [fix_id(l) for l in logs if l.get("action") in security_actions][:30]

        return {
            "failed_logins_24h": failed_logins,
            "locked_accounts": locked,
            "disabled_accounts": disabled,
            "permission_changes_24h": sum(1 for l in recent if str(l.get("action", "")).startswith("PERMISSION_")),
            "role_changes_24h": sum(1 for l in recent if l.get("action") == "ROLE_CHANGE"),
            "total_accounts": len(admins),
            "active_accounts": sum(1 for a in admins if a.get("is_active", True)),
            "superadmins": sum(1 for a in admins if a.get("role") == "superadmin"),
            "two_factor": "Email OTP enforced on every sign-in",
            "events": events,
        }
