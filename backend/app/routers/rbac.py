from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.database import get_collection
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
    extra = [r for r in rbac.user_roles(admin) if r != role]
    return {
        "id": admin["id"],
        "username": admin.get("username", ""),
        "email": admin.get("email", ""),
        "role": role,
        "role_label": label,
        "extra_roles": extra,
        "last_login": admin.get("last_login"),
        "permissions": sorted(await rbac.get_user_permissions(admin)),
    }


@router.get("/catalog")
async def catalog():
    return rbac.catalog_payload()


@router.get("/roles")
async def role_matrix():
    return await rbac.get_role_matrix()


class AccessUpdate(BaseModel):
    extra_roles: List[str] = []
    grants: List[str] = []   # permissions allowed for this user on top of their roles
    denies: List[str] = []   # permissions removed from this user even if a role grants them


def _access_view(user: Dict[str, Any]) -> Dict[str, Any]:
    return {"user": {"id": str(user["_id"]), "username": user.get("username", ""), "email": user.get("email", ""),
                     "role": rbac.normalize_role(user.get("role"))},
            "extra_roles": [r for r in rbac.user_roles(user) if r != rbac.normalize_role(user.get("role"))],
            "grants": user.get("grants") or [], "denies": user.get("denies") or []}


@router.get("/users/{user_id}/access")
async def get_user_access(user_id: str):
    user = await get_collection("admins").find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    view = _access_view(user)
    view["effective"] = sorted(await rbac.get_user_permissions(user))
    return view


@router.put("/users/{user_id}/access")
async def set_user_access(user_id: str, body: AccessUpdate, request: Request, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Give one person extra roles and per-feature allow / deny overrides on top of their own role."""
    col = get_collection("admins")
    user = await col.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if rbac.normalize_role(user.get("role")) == rbac.SUPERADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Super Admin always has full access.")
    if str(user["_id"]) == str(admin.get("id")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't change your own access.")

    primary = rbac.normalize_role(user.get("role"))
    extra: List[str] = []
    for r in body.extra_roles:
        r = rbac.normalize_role(r)
        if r not in rbac.ROLE_IDS:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown role: {r}.")
        if r == rbac.SUPERADMIN:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Super Admin can't be added as an extra role.")
        if r != primary and r not in extra:
            extra.append(r)
    unknown = [p for p in [*body.grants, *body.denies] if p not in rbac.ALL_PERMISSIONS]
    if unknown:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown permission: {unknown[0]}.")
    blocked = [p for p in body.grants if rbac.reserved_blocked(p, [primary, *extra])]
    if blocked:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"{blocked[0]} is reserved for {', '.join(sorted(rbac.ROLE_RESERVED_PERMISSIONS[blocked[0]]))}; give the person one of those roles instead.")
    if set(body.grants) & set(body.denies):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A permission can't be both allowed and denied.")
    grants = [p for p in rbac.ALL_PERMISSIONS if p in set(body.grants)]
    denies = [p for p in rbac.ALL_PERMISSIONS if p in set(body.denies)]

    # Nobody can hand out more than they hold themselves (Super Admin excepted).
    if not rbac.has_role(admin, rbac.SUPERADMIN):
        mine = await rbac.get_user_permissions(admin)
        giving = set(grants)
        for r in extra:
            giving |= await rbac.get_role_permissions(r)
        if not giving <= mine:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only give access you have yourself.")

    await col.update_one({"_id": user_id}, {"$set": {"extra_roles": extra, "grants": grants, "denies": denies}})
    await LogService.create_log(
        action="USER_ACCESS_UPDATE", performed_by=admin.get("email", ""), performed_by_role=admin.get("role", ""),
        target=user.get("email", ""),
        details={"message": f"Access for {user.get('email', '')}: extra roles {extra or 'none'}, allow {len(grants)}, deny {len(denies)}"},
        ip_address=request.client.host if request.client else "",
    )
    return await get_user_access(user_id)


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
