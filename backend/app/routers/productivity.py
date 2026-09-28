from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, status, Query
from typing import Dict, Any, List, Optional
from datetime import datetime

from pydantic import BaseModel, Field
from app.schemas.productivity import (
    LogTimesheetRequest,
    FlagBlockerRequest,
    Client,
    Project,
    ProjectTask
)
from app.services.productivity_service import ProductivityService
from app.services.productivity_analytics import ProductivityAnalyticsEngine
from app.services.bottleneck_alert_worker import BottleneckAlertWorker
from app.services.auth_service import get_current_user
from app.database import get_collection, fix_ids, fix_id

router = APIRouter(prefix="/api/productivity", tags=["Productivity & Project Tracking"])


@router.get("/clients", status_code=status.HTTP_200_OK)
async def list_clients(current_user: Dict[str, Any] = Depends(get_current_user)):
    col = get_collection("clients")
    docs = await col.find({}).sort("client_name", 1).to_list(2000)
    return {"success": True, "data": fix_ids(docs)}


@router.post("/clients", status_code=status.HTTP_201_CREATED)
async def create_client(client: Client, current_user: Dict[str, Any] = Depends(get_current_user)):
    col = get_collection("clients")
    doc = client.dict(by_alias=True)
    res = await col.insert_one(doc)
    doc["_id"] = str(res.inserted_id)
    return {"success": True, "data": fix_id(doc)}


@router.get("/projects", status_code=status.HTTP_200_OK)
async def list_projects(current_user: Dict[str, Any] = Depends(get_current_user)):
    col = get_collection("projects")
    docs = await col.find({}).sort("project_name", 1).to_list(2000)
    return {"success": True, "data": fix_ids(docs)}


@router.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(project: Project, current_user: Dict[str, Any] = Depends(get_current_user)):
    col = get_collection("projects")
    doc = project.dict(by_alias=True)
    res = await col.insert_one(doc)
    doc["_id"] = str(res.inserted_id)
    return {"success": True, "data": fix_id(doc)}


@router.get("/tasks", status_code=status.HTTP_200_OK)
async def list_tasks(
    project_id: Optional[str] = None,
    assigned_to_id: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    col = get_collection("project_tasks")
    filter_q: Dict[str, Any] = {}
    if project_id:
        filter_q["project_id"] = project_id
    if assigned_to_id:
        filter_q["assigned_to_id"] = assigned_to_id
    docs = await col.find(filter_q).sort("created_at", -1).to_list(5000)
    return {"success": True, "data": fix_ids(docs)}


@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(task: ProjectTask, current_user: Dict[str, Any] = Depends(get_current_user)):
    col = get_collection("project_tasks")
    doc = task.dict(by_alias=True)
    res = await col.insert_one(doc)
    doc["_id"] = str(res.inserted_id)
    return {"success": True, "data": fix_id(doc)}


class QuickTaskRequest(BaseModel):
    client_name: str = Field(..., min_length=1, max_length=120)
    project_name: str = Field(..., min_length=1, max_length=160)
    task_title: str = Field(..., min_length=1, max_length=200)
    employee_id: str
    estimated_hours: float = Field(0.0, ge=0.0)


@router.post("/tasks/quick", status_code=status.HTTP_201_CREATED)
async def create_task_quick(req: QuickTaskRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    """Creates a task, get-or-creating its client and project by name."""
    emp = await get_collection("employees").find_one(
        {"$or": [{"employee_code": req.employee_id}, {"_id": req.employee_id}]}
    )
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee {req.employee_id} not found.")

    now = datetime.utcnow().isoformat()
    clients, projects = get_collection("clients"), get_collection("projects")

    client = await clients.find_one({"client_name": req.client_name.strip()})
    if client:
        client_id = str(client["_id"])
    else:
        client_id = str((await clients.insert_one({
            "client_name": req.client_name.strip(), "company_name": req.client_name.strip(),
            "contact_email": "", "is_active": True, "created_at": now,
        })).inserted_id)

    project = await projects.find_one({"project_name": req.project_name.strip(), "client_id": client_id})
    if project:
        project_id = str(project["_id"])
    else:
        project_id = str((await projects.insert_one({
            "project_name": req.project_name.strip(), "client_id": client_id, "client_name": req.client_name.strip(),
            "project_manager_name": current_user.get("username") or "Manager",
            "project_manager_email": current_user.get("email") or "hr@rexera.co.in",
            "status": "ACTIVE", "budget_hours": 0.0, "logged_hours_total": 0.0,
            "start_date": now[:10], "created_at": now,
        })).inserted_id)

    task = {
        "project_id": project_id, "project_name": req.project_name.strip(),
        "client_id": client_id, "client_name": req.client_name.strip(),
        "task_title": req.task_title.strip(),
        "assigned_to_id": str(emp["_id"]), "assigned_to_name": emp.get("full_name", ""),
        "assigned_to_email": emp.get("email"),
        "estimated_hours": req.estimated_hours, "actual_hours_logged": 0.0,
        "status": "TO_DO", "is_blocked": False, "created_at": now, "updated_at": now,
    }
    res = await get_collection("project_tasks").insert_one(task)
    task["_id"] = str(res.inserted_id)
    return {"success": True, "data": fix_id(task)}


@router.post("/timesheet/log", status_code=status.HTTP_201_CREATED)
async def log_timesheet(
    payload: LogTimesheetRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        res = await ProductivityService.log_task_timesheet(payload)
        return {
            "success": True,
            "message": f"Successfully logged {payload.hours_spent} hours.",
            "data": res["timesheet"]
        }
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))


@router.post("/tasks/flag-blocker", status_code=status.HTTP_200_OK)
async def flag_task_blocker(
    payload: FlagBlockerRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        res = await ProductivityService.flag_task_blocked(payload)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

    background_tasks.add_task(
        BottleneckAlertWorker.send_bottleneck_escalation_alert,
        task_title=res["task_title"],
        project_name=res["project_name"],
        client_name=res["client_name"],
        employee_name=res["employee_name"],
        blocker_category=payload.blocker_category.value,
        blocker_reason=payload.blocker_reason,
        pm_email=res["project_manager_email"]
    )

    return {
        "success": True,
        "message": "Task has been moved to BLOCKED status and escalation alerts have been dispatched.",
        "data": res["task"]
    }


@router.get("/dashboard/birds-eye", status_code=status.HTTP_200_OK)
async def get_birds_eye_dashboard(
    date_str: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="Date in YYYY-MM-DD format (defaults to today)"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    target_date = date_str or datetime.utcnow().strftime("%Y-%m-%d")
    analytics = await ProductivityAnalyticsEngine.get_birds_eye_dashboard(target_date)
    return {"success": True, "data": analytics}
