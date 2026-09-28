import logging
import os
import uuid
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, status
from fastapi.responses import FileResponse
from typing import Dict, Any

from app.schemas.bulk_import import (
    ImportTargetEntity,
    ImportPreviewResponse,
    ExecuteImportRequest,
    ImportJobStatus,
    ImportJobSummary,
    TARGET_SCHEMA_REGISTRY
)
from app.services.import_parser_service import ImportParserService, UPLOAD_TEMP_DIR
from app.services.import_execution_engine import ImportExecutionEngine
from app.services.import_alert_worker import ImportAlertWorker
from app.services.auth_service import get_current_user
from app.database import get_collection, fix_id

logger = logging.getLogger("rexera.router.bulk_import")
router = APIRouter(prefix="/api/bulk-import", tags=["Smart Bulk Import & Mapping"])

# ponytail: per-process; with several workers an execute can land on a worker that never saw the upload.
PARSED_PREVIEWS_CACHE: Dict[str, Dict[str, Any]] = {}
MAX_CACHED_PREVIEWS = 20
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@router.post("/preview-and-map", response_model=ImportPreviewResponse, status_code=status.HTTP_200_OK)
async def preview_and_auto_map_file(
    file: UploadFile = File(...),
    target_entity: ImportTargetEntity = Form(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    if target_entity not in TARGET_SCHEMA_REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Import target {target_entity.value} is not supported yet."
        )
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"The file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    try:
        headers, rows, total_rows = ImportParserService.parse_uploaded_file(contents, file.filename or "")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"File parsing error: {str(e)}")
    if total_rows == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The file has no data rows.")

    mappings = ImportParserService.auto_map_headers(headers, target_entity, rows[:5])

    file_id = str(uuid.uuid4())
    while len(PARSED_PREVIEWS_CACHE) >= MAX_CACHED_PREVIEWS:  # bound memory: drop the oldest upload
        PARSED_PREVIEWS_CACHE.pop(next(iter(PARSED_PREVIEWS_CACHE)))
    PARSED_PREVIEWS_CACHE[file_id] = {
        "filename": file.filename,
        "rows": rows,
        "total_rows": total_rows,
        "target_entity": target_entity
    }

    db_fields_meta = [
        {"field": k, "label": v["label"], "required": v["required"], "type": v["type"]}
        for k, v in TARGET_SCHEMA_REGISTRY[target_entity]["fields"].items()
    ]

    return ImportPreviewResponse(
        file_id=file_id,
        file_name=file.filename,
        total_rows_detected=total_rows,
        target_entity=target_entity,
        mappings=mappings,
        available_db_fields=db_fields_meta,
        sample_data=rows[:5]
    )


@router.post("/execute", status_code=status.HTTP_202_ACCEPTED)
async def execute_bulk_import(
    payload: ExecuteImportRequest,
    background_tasks: BackgroundTasks,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    cached = PARSED_PREVIEWS_CACHE.get(payload.file_id)
    if not cached:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session expired or file not found. Please upload again.")

    job_id = str(uuid.uuid4())
    job_col = get_collection("import_jobs")

    job_summary = ImportJobSummary(
        job_id=job_id,
        target_entity=payload.target_entity,
        total_rows=cached["total_rows"],
        is_dry_run=payload.dry_run_only,
        initiated_by=current_user.get("email", "hr@rexera.co.in")
    )
    await job_col.insert_one(job_summary.dict(by_alias=True))

    async def _run_job_and_notify():
        try:
            res = await ImportExecutionEngine.execute_upsert_batch(
                job_id=job_id,
                records=cached["rows"],
                mappings=payload.confirmed_mappings,
                target_entity=payload.target_entity,
                unique_key_field=payload.unique_key_field,
                is_dry_run=payload.dry_run_only,
                user_email=current_user.get("email", "hr@rexera.co.in")
            )
        except Exception as e:
            # Without this the job stayed PROCESSING forever and the page polled indefinitely.
            logger.exception(f"Bulk import job {job_id} failed")
            await job_col.update_one({"job_id": job_id}, {"$set": {
                "status": ImportJobStatus.FAILED.value, "error": str(e)[:300], "completed_at": datetime.utcnow()}})
            return
        await ImportAlertWorker.send_import_completion_email(
            recipient_email=current_user.get("email", "hr@rexera.co.in"),
            job_id=job_id,
            target_entity=payload.target_entity.value,
            inserted=res["inserted"],
            updated=res["updated"],
            failed=res["failed"],
            is_dry_run=payload.dry_run_only,
            error_url=res["error_url"]
        )

    background_tasks.add_task(_run_job_and_notify)

    return {
        "success": True,
        "job_id": job_id,
        "message": f"Bulk import job {job_id} queued successfully. Progress is being tracked.",
        "is_dry_run": payload.dry_run_only
    }


@router.get("/jobs/{job_id}", status_code=status.HTTP_200_OK)
async def get_import_job_status(job_id: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    job = await get_collection("import_jobs").find_one({"job_id": job_id})
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return fix_id(job)


@router.get("/error-reports/{job_id}")
async def download_error_report(job_id: str):
    from app.services import import_execution_engine as engine_mod
    file_path = os.path.join(engine_mod.ERROR_REPORT_DIR, f"error_report_{os.path.basename(job_id)}.xlsx")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Error report not found.")
    return FileResponse(file_path, filename=f"Import_Errors_{job_id[:8]}.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
