from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field

from app.services.automation_service import BY_ID, AutomationService

router = APIRouter(prefix="/api/automations", tags=["Automations"])


class AutomationUpdate(BaseModel):
    enabled: bool
    schedule: Dict[str, Any] = Field(default_factory=dict)
    options: Dict[str, Any] = Field(default_factory=dict)


class AutomationGlobalSettings(BaseModel):
    hr_email: EmailStr
    accounts_email: EmailStr


def _known(automation_id: str) -> None:
    if automation_id not in BY_ID:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown automation.")


def _check_schedule(automation_id: str, schedule: Dict[str, Any]) -> None:
    kind = BY_ID[automation_id]["schedule"]["type"]
    if "time" in schedule:
        parts = str(schedule["time"]).split(":")
        if len(parts) != 2 or not all(p.isdigit() for p in parts) or not (0 <= int(parts[0]) < 24 and 0 <= int(parts[1]) < 60):
            raise HTTPException(status_code=422, detail="Time must be HH:MM (24-hour).")
    if kind == "monthly" and "day" in schedule and not (str(schedule["day"]).isdigit() and 1 <= int(schedule["day"]) <= 28):
        raise HTTPException(status_code=422, detail="Day of month must be between 1 and 28.")
    if kind == "interval" and "minutes" in schedule and not (str(schedule["minutes"]).isdigit() and 5 <= int(schedule["minutes"]) <= 1440):
        raise HTTPException(status_code=422, detail="Interval must be between 5 and 1440 minutes.")


@router.get("")
async def list_automations():
    return {"settings": await AutomationService.global_settings(), "automations": await AutomationService.list_all()}


@router.put("/settings")
async def save_settings(req: AutomationGlobalSettings):
    return await AutomationService.save_global_settings(str(req.hr_email).lower(), str(req.accounts_email).lower())


@router.get("/runs")
async def list_runs(limit: int = Query(100, ge=1, le=500)):
    return {"runs": await AutomationService.runs(limit)}


@router.put("/{automation_id}")
async def update_automation(automation_id: str, req: AutomationUpdate):
    _known(automation_id)
    _check_schedule(automation_id, req.schedule)
    for opt in BY_ID[automation_id].get("options", []):
        value = req.options.get(opt["key"])
        if opt["type"] == "number" and value not in (None, "") and not (str(value).isdigit() and 0 <= int(value) <= 365):
            raise HTTPException(status_code=422, detail=f"{opt['label']} must be a whole number from 0 to 365.")
    return await AutomationService.update(automation_id, req.enabled, req.schedule, req.options)


@router.post("/{automation_id}/run")
async def run_automation(automation_id: str):
    _known(automation_id)
    try:
        return await AutomationService.run(automation_id, trigger="manual")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
