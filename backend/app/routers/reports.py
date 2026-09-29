import logging
import os
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, status
from fastapi.responses import FileResponse
from typing import Dict, Any, Optional, Tuple

from app.schemas.analytics_reports import (
    DateRangePreset,
    ReportScope,
    IndividualPerformanceReport,
    CompanyWidePerformanceReport,
    ReportGenerationJob,
    ReportExportRequest,
)
from app.services.performance_analytics_engine import PerformanceAnalyticsEngine
from app.services.report_export_service import ReportExportService, OUTPUT_DIR, MEDIA_TYPES
from app.services.report_background_worker import ReportBackgroundWorker
from app.services.auth_service import get_current_user
from app.database import get_collection, fix_id

logger = logging.getLogger("rexera.router.reports")
router = APIRouter(prefix="/api/reports", tags=["Performance & Progress Reports"])


def _date_range(preset: DateRangePreset, start_date: Optional[str], end_date: Optional[str]) -> Tuple[str, str, str, str, str]:
    try:
        return PerformanceAnalyticsEngine.resolve_date_range(preset, start_date, end_date)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(ve))


@router.get("/preview/individual/{employee_id}", response_model=IndividualPerformanceReport)
async def get_individual_report_preview(
    employee_id: str,
    preset: DateRangePreset = DateRangePreset.THIS_MONTH,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    s_date, e_date, p_s, p_e, label = _date_range(preset, start_date, end_date)
    try:
        return await PerformanceAnalyticsEngine.generate_individual_report(
            employee_id=employee_id,
            start_date=s_date,
            end_date=e_date,
            p_start=p_s,
            p_end=p_e,
            date_label=label
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))


@router.get("/preview/company", response_model=CompanyWidePerformanceReport)
async def get_company_report_preview(
    preset: DateRangePreset = DateRangePreset.THIS_MONTH,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    s_date, e_date, p_s, p_e, label = _date_range(preset, start_date, end_date)
    return await PerformanceAnalyticsEngine.generate_company_report(
        start_date=s_date,
        end_date=e_date,
        p_start=p_s,
        p_end=p_e,
        date_label=label
    )


@router.post("/export-async", status_code=status.HTTP_202_ACCEPTED)
async def trigger_async_report_export(
    payload: ReportExportRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    s_date, e_date, p_s, p_e, label = _date_range(payload.preset, payload.start_date, payload.end_date)
    if payload.scope == ReportScope.INDIVIDUAL:
        # Fail now with a clear 404 rather than leaving a job that can never finish.
        try:
            await PerformanceAnalyticsEngine.generate_individual_report(payload.employee_id, s_date, e_date, p_s, p_e, label)
        except ValueError as ve:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))

    job_id = str(uuid.uuid4())
    job_col = get_collection("report_jobs")
    user_email = current_user.get("email", "hr@rexera.co.in")

    job_entry = ReportGenerationJob(
        job_id=job_id,
        scope=payload.scope,
        format=payload.export_format,
        employee_id=payload.employee_id,
        requested_by=user_email,
    )
    await job_col.insert_one(job_entry.model_dump(by_alias=True, exclude={"id"}))

    async def _process_export():
        try:
            if payload.scope == ReportScope.INDIVIDUAL:
                rep = await PerformanceAnalyticsEngine.generate_individual_report(
                    payload.employee_id, s_date, e_date, p_s, p_e, label
                )
            else:
                rep = await PerformanceAnalyticsEngine.generate_company_report(s_date, e_date, p_s, p_e, label)
            file_name = ReportExportService.export(rep, payload.scope, payload.export_format, job_id)
        except Exception as e:
            logger.exception(f"Report export {job_id} failed")
            await job_col.update_one({"job_id": job_id}, {"$set": {
                "status": "FAILED", "error": str(e)[:300], "completed_at": datetime.utcnow()}})
            return

        download_url = f"/api/reports/download/{job_id}"
        await job_col.update_one(
            {"job_id": job_id},
            {"$set": {"status": "COMPLETED", "file_name": file_name, "download_url": download_url,
                      "completed_at": datetime.utcnow()}}
        )
        await ReportBackgroundWorker.send_report_ready_email(
            recipient_email=user_email,
            report_title=label,
            download_url=download_url,
            scope=payload.scope.value
        )

    background_tasks.add_task(_process_export)

    return {
        "success": True,
        "job_id": job_id,
        "message": "Report generation has started in the background. You will receive an email once it is ready.",
        "status_url": f"/api/reports/jobs/{job_id}"
    }


@router.get("/jobs/{job_id}")
async def get_report_job(job_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    job = await get_collection("report_jobs").find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report job not found.")
    job = fix_id(job)
    job.pop("file_name", None)
    return job


@router.get("/download/{job_id}")
async def download_generated_report(
    job_id: str,
    ext: Optional[str] = None,  # accepted for older clients; the job record decides the file
    emp: Optional[str] = None,
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    job = await get_collection("report_jobs").find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report job not found.")
    if job.get("status") == "FAILED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Report generation failed: {job.get('error') or 'unknown error'}")
    file_name = job.get("file_name")
    if job.get("status") != "COMPLETED" or not file_name:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The report is still being generated.")

    file_path = os.path.join(OUTPUT_DIR, os.path.basename(file_name))
    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report file not found or expired.")
    extension = file_name.rsplit(".", 1)[-1]
    return FileResponse(file_path, filename=file_name, media_type=MEDIA_TYPES.get(extension, "application/octet-stream"))
