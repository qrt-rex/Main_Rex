from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.database import get_collection, fix_id
from app.services.auth_service import get_current_admin
from app.services.log_service import LogService
from app.services import rbac_service as rbac
from app.utils.security import hash_password

router = APIRouter(prefix="/api/users", tags=["User Management"])


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    email: EmailStr
    role: str
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, min_length=2, max_length=80)
    role: Optional[str] = None
    is_active: Optional[bool] = None


def _public(doc: Dict[str, Any]) -> Dict[str, Any]:
    d = fix_id(doc)
    return {
        "id": d["id"],
        "username": d.get("username", ""),
        "email": d.get("email", ""),
        "role": rbac.normalize_role(d.get("role")),
        "extra_roles": d.get("extra_roles") or [],
        "grants": d.get("grants") or [],
        "denies": d.get("denies") or [],
        "is_active": d.get("is_active", True),
        "last_login": d.get("last_login"),
        "created_at": d.get("created_at"),
    }


def _require_superadmin_for(actor: Dict[str, Any], *roles: Optional[str]) -> None:
    if rbac.SUPERADMIN in [rbac.normalize_role(r) for r in roles] and rbac.normalize_role(actor.get("role")) != rbac.SUPERADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can manage Super Admin accounts.")


async def _log(request: Request, actor: Dict[str, Any], action: str, target: str, message: str) -> None:
    await LogService.create_log(
        action=action, performed_by=actor.get("email", ""), performed_by_role=actor.get("role", ""),
        target=target, details={"message": message},
        ip_address=request.client.host if request.client else "",
    )


@router.get("")
async def list_users():
    docs = await get_collection("admins").find({}).sort("created_at", 1).to_list(1000)
    return [_public(d) for d in docs]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, request: Request, actor: Dict[str, Any] = Depends(get_current_admin)):
    role = rbac.normalize_role(body.role)
    if role not in rbac.ROLE_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role.")
    _require_superadmin_for(actor, role)

    col = get_collection("admins")
    email = body.email.strip().lower()
    if await col.find_one({"email": email}):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")

    now = datetime.utcnow().isoformat()
    doc = {
        "username": body.username.strip(), "email": email, "role": role,
        "password_hash": hash_password(body.password), "is_active": True,
        "created_at": now, "updated_at": now, "last_login": None,
    }
    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    await _log(request, actor, "USER_CREATE", email, f"Created {role} account for {email}")
    return _public(doc)


@router.patch("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, request: Request, actor: Dict[str, Any] = Depends(get_current_admin)):
    col = get_collection("admins")
    target = await col.find_one({"_id": user_id})
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    changes: Dict[str, Any] = {}
    if body.username is not None:
        changes["username"] = body.username.strip()
    if body.role is not None:
        role = rbac.normalize_role(body.role)
        if role not in rbac.ROLE_IDS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role.")
        changes["role"] = role
    if body.is_active is not None:
        changes["is_active"] = body.is_active

    is_self = str(target["_id"]) == actor["id"]
    if is_self and ("role" in changes or changes.get("is_active") is False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't change your own role or deactivate yourself.")
    _require_superadmin_for(actor, target.get("role"), changes.get("role"))

    # Never leave the system without an active Super Admin.
    was_active_super = rbac.normalize_role(target.get("role")) == rbac.SUPERADMIN and target.get("is_active", True)
    stays_active_super = changes.get("role", rbac.SUPERADMIN) == rbac.SUPERADMIN and changes.get("is_active", True)
    if was_active_super and not stays_active_super:
        others = await col.count_documents({"role": rbac.SUPERADMIN, "is_active": True, "_id": {"$ne": user_id}})
        if others == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one active Super Admin is required.")

    if changes:
        changes["updated_at"] = datetime.utcnow().isoformat()
        await col.update_one({"_id": user_id}, {"$set": changes})
        summary = ", ".join(f"{k}={v}" for k, v in changes.items() if k != "updated_at")
        await _log(request, actor, "USER_UPDATE", target.get("email", ""), f"Updated {target.get('email', '')}: {summary}")
    return _public(await col.find_one({"_id": user_id}))
