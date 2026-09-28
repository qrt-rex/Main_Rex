from typing import Any, Dict

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.services.auth_service import get_current_admin
from app.services.log_service import LogService
from app.services import rbac_service as rbac

router = APIRouter(prefix="/api/rbac", tags=["Roles & Permissions"])


class PermissionToggle(BaseModel):
    permission: str
    granted: bool


@router.get("/me")
async def my_access(admin: Dict[str, Any] = Depends(get_current_admin)):
    """Profile + effective permissions for the signed-in account (what the CRM renders from)."""
    role = rbac.normalize_role(admin.get("role"))
    label = next((r["label"] for r in rbac.ROLES if r["id"] == role), role or "Unknown")
    return {
        "id": admin["id"],
        "username": admin.get("username", ""),
        "email": admin.get("email", ""),
        "role": role,
        "role_label": label,
        "last_login": admin.get("last_login"),
        "permissions": sorted(await rbac.get_role_permissions(role)),
    }


@router.get("/catalog")
async def catalog():
    return rbac.catalog_payload()


@router.get("/roles")
async def role_matrix():
    return await rbac.get_role_matrix()


@router.patch("/roles/{role}")
async def toggle_role_permission(role: str, body: PermissionToggle, request: Request,
                                 admin: Dict[str, Any] = Depends(get_current_admin)):
    permissions = await rbac.set_role_permission(role, body.permission, body.granted, admin.get("email", ""))
    await LogService.create_log(
        action="PERMISSION_GRANT" if body.granted else "PERMISSION_REVOKE",
        performed_by=admin.get("email", ""),
        performed_by_role=admin.get("role", ""),
        target=f"{role} → {body.permission}",
        details={"message": f"{'Granted' if body.granted else 'Revoked'} {body.permission} for role {role}"},
        ip_address=request.client.host if request.client else "",
    )
    return {"role": rbac.normalize_role(role), "permissions": permissions}
