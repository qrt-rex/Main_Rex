import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends, status, Query, Response
from fastapi.responses import HTMLResponse
from app.services.payroll_service import PayrollService
from app.services.pdf_service import PDFService
from app.services.email_service import EmailService
from app.services.auth_service import get_current_admin
from app.database import get_collection, fix_id, fix_ids
from app.schemas.advanced_payroll import (
    SalaryStructureUpdate,
    SalaryStructureResponse,
    SinglePayrollCalculationRequest,
    BulkPayrollRunRequest,
    PayrollRecordResponse,
    PayrollEditRequest,
    PayrollUnlockRequest,
    PayrollMarkPaidRequest
)
from app.schemas.payroll import (
    SalaryCalculateRequest,
    SalaryCalculationResult,
    SalarySlipCreateRequest,
    BatchPayrollRunRequest,
    SalarySlipResponse,
    SalarySlipListResponse,
    PayrollSummaryResponse
)
from app.schemas.payroll_adjustment import PayrollAdjustmentRequest, PayrollAdjustmentResponse
from app.services.log_service import LogService

logger = logging.getLogger("rexera.router.payroll")
router = APIRouter(prefix="/api/payroll", tags=["Payroll Operations & Compliance"])

# ==========================================
# 1. SALARY STRUCTURES
# ==========================================
@router.get("/salary-structures/{employee_id}", response_model=SalaryStructureResponse)
async def get_employee_salary_structure(employee_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Get dedicated salary structure for an employee."""
    try:
        struct = await PayrollService.get_or_create_salary_structure(employee_id)
        return SalaryStructureResponse(**struct)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))

@router.put("/salary-structures/{employee_id}", response_model=SalaryStructureResponse)
async def update_employee_salary_structure(
    employee_id: str,
    req: SalaryStructureUpdate,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Update salary structure earnings, allowances, and statutory deduction policies."""
    try:
        struct = await PayrollService.update_salary_structure(
            employee_id=employee_id,
            updates=req.model_dump(),
            user_email=admin.get("email", "admin")
        )
        return SalaryStructureResponse(**struct)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))

# ==========================================
# 2. CALCULATION & BATCH OPERATIONS
# ==========================================
@router.post("/calculate", response_model=PayrollRecordResponse)
async def calculate_single_employee_payroll(
    req: SinglePayrollCalculationRequest,
    save: bool = Query(True, description="Save or preview only"),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """
    Calculate full salary for one employee for a given month and year.
    Incorporates attendance, unpaid leave, overtime, approved bonuses, advances, and loans.
    """
    try:
        rec = await PayrollService.calculate_employee_payroll(
            req=req,
            save_record=save,
            status="CALCULATED",
            user_email=admin.get("email", "admin")
        )
        return PayrollRecordResponse(**rec)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Payroll calculation error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/calculate-bulk")
async def calculate_bulk_payroll(
    req: BulkPayrollRunRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """
    Bulk calculate payroll for selected or all active employees.
    Returns processed count, successful list, and failed list with exact diagnostic reasons.
    """
    try:
        result = await PayrollService.run_advanced_bulk_payroll(
            req=req,
            user_email=admin.get("email", "admin")
        )
        return result
    except Exception as e:
        logger.error(f"Bulk payroll error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

# ==========================================
# 3. PAYROLL RECORDS & WORKFLOW
# ==========================================
@router.get("", response_model=List[PayrollRecordResponse])
async def list_payrolls(
    month: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    department: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve full payroll records with month, year, department, and status filters."""
    payrolls = await PayrollService.get_payrolls(
        month=month,
        year=year,
        department=department,
        status=status,
        search=search
    )
    return [PayrollRecordResponse(**p) for p in payrolls]

@router.get("/record/{payroll_id}", response_model=PayrollRecordResponse)
async def get_payroll_record(payroll_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Get single payroll record by ID."""
    rec = await PayrollService.get_payroll_by_id(payroll_id)
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll record not found.")
    return PayrollRecordResponse(**rec)

@router.put("/record/{payroll_id}", response_model=PayrollRecordResponse)
async def edit_payroll_record(
    payroll_id: str,
    req: PayrollEditRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """
    Edit authorized earnings, allowances, deductions, and manual adjustments before finalization.
    Automatically recalculates Gross, Total Deductions, and Net Salary with non-negative checks.
    """
    try:
        rec = await PayrollService.edit_payroll_record(
            payroll_id=payroll_id,
            edits=req,
            user_email=admin.get("email", "admin")
        )
        return PayrollRecordResponse(**rec)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

@router.post("/record/{payroll_id}/approve", response_model=PayrollRecordResponse)
async def approve_payroll(payroll_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Approve a calculated payroll record."""
    try:
        rec = await PayrollService.approve_payroll(payroll_id, user_email=admin.get("email", "admin"))
        return PayrollRecordResponse(**rec)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

@router.post("/record/{payroll_id}/finalize", response_model=PayrollRecordResponse)
async def finalize_payroll(payroll_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """
    Finalize and lock payroll record.
    Commits advance recovery and loan EMI ledgers, and generates official payslip.
    """
    try:
        rec = await PayrollService.finalize_payroll(payroll_id, user_email=admin.get("email", "admin"))
        return PayrollRecordResponse(**rec)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

@router.post("/record/{payroll_id}/unlock", response_model=PayrollRecordResponse)
async def unlock_payroll(
    payroll_id: str,
    req: PayrollUnlockRequest,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Unlock a finalized payroll record with an audit justification."""
    try:
        rec = await PayrollService.unlock_payroll(payroll_id, reason=req.reason, user_email=admin.get("email", "admin"))
        return PayrollRecordResponse(**rec)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

@router.post("/record/{payroll_id}/mark-paid", response_model=PayrollRecordResponse)
async def mark_payroll_as_paid(
    payroll_id: str,
    req: Optional[PayrollMarkPaidRequest] = None,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Mark payroll and associated payslip as PAID."""
    try:
        ref = req.payment_reference if req else None
        rec = await PayrollService.mark_payroll_paid(payroll_id, payment_ref=ref, user_email=admin.get("email", "admin"))
        return PayrollRecordResponse(**rec)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))

# ==========================================
# 4. EMAIL & PAYSLIP DISPATCH
# ==========================================
@router.post("/record/{payroll_id}/send-email")
async def send_single_payslip_email(payroll_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Dispatch individualized official payslip PDF/HTML email to the employee."""
    payroll = await PayrollService.get_payroll_by_id(payroll_id)
    if not payroll:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll record not found.")

    payslip_html = PDFService.generate_salary_slip_html(payroll)
    result = await EmailService.send_payslip_email(
        employee_id=payroll["employee_id"],
        payroll_record=payroll,
        payslip_html=payslip_html
    )

    if result.get("success"):
        payroll_col = get_collection("payrolls")
        await payroll_col.update_one(
            {"_id": payroll_id},
            {"$set": {"email_sent": True, "email_sent_at": result.get("sent_at")}}
        )
    return result

@router.post("/send-bulk-email")
async def send_bulk_payslip_emails(
    payroll_ids: List[str],
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """
    Dispatches separate, individualized emails with attached payslips to all selected employees.
    Ensures zero cross-contamination and logs every sent/failed action.
    """
    sent = 0
    failed = 0
    failures = []

    for pid in payroll_ids:
        payroll = await PayrollService.get_payroll_by_id(pid)
        if not payroll:
            failed += 1
            failures.append({"payroll_id": pid, "reason": "Payroll record not found"})
            continue

        payslip_html = PDFService.generate_salary_slip_html(payroll)
        res = await EmailService.send_payslip_email(
            employee_id=payroll["employee_id"],
            payroll_record=payroll,
            payslip_html=payslip_html
        )
        if res.get("success"):
            sent += 1
            payroll_col = get_collection("payrolls")
            await payroll_col.update_one({"_id": pid}, {"$set": {"email_sent": True}})
        else:
            failed += 1
            failures.append({
                "employee_code": payroll.get("employee_code"),
                "employee_name": payroll.get("employee_name"),
                "email": res.get("email"),
                "reason": res.get("error") or res.get("message")
            })

    return {
        "success": True,
        "total_requested": len(payroll_ids),
        "sent_count": sent,
        "failed_count": failed,
        "failures": failures
    }

# ==========================================
# 5. REPORTS & EXPORTS
# ==========================================
@router.get("/dashboard-metrics")
async def get_payroll_dashboard_metrics(
    month: str = Query("September"),
    year: int = Query(2026),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Executive KPI metrics, status counts, and department salary distribution."""
    metrics = await PayrollService.get_dashboard_metrics(month=month, year=year)
    return metrics

@router.get("/bank-export")
async def get_bank_payment_export(
    month: str = Query("September"),
    year: int = Query(2026),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Generate bank payment schedule list (CSV/Excel data) with bank details and net salaries."""
    rows = await PayrollService.get_bank_payment_export(month=month, year=year)
    return {"total": len(rows), "month": month, "year": year, "records": rows}

@router.get("/statement/{employee_id}/{year}")
async def get_annual_statement(
    employee_id: str,
    year: int = 2026,
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve complete 12-month annual salary statement for an employee."""
    try:
        statement = await PayrollService.get_annual_salary_statement(employee_id=employee_id, year=year)
        return statement
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))

# ==========================================
# 6. LEGACY & DIRECT PAYSLIP ENDPOINTS
# ==========================================
@router.post("/calculate-salary", response_model=SalaryCalculationResult)
async def legacy_calculate_salary(req: SalaryCalculateRequest):
    return PayrollService.calculate_salary_components(req)

@router.post("/generate-slip", response_model=SalarySlipResponse)
async def legacy_generate_slip(req: SalarySlipCreateRequest, admin: Dict[str, Any] = Depends(get_current_admin)):
    calc_req = SinglePayrollCalculationRequest(
        employee_id=req.employee_id,
        month=req.month,
        year=req.year,
        working_days=req.working_days,
        paid_leave_days=req.paid_days,
        unpaid_leave_days=req.lop_days,
        bonus_amount=req.bonus,
        other_deductions=req.other_deductions,
        remarks=req.remarks
    )
    rec = await PayrollService.calculate_employee_payroll(calc_req, save_record=True, status="APPROVED")
    rec = await PayrollService.finalize_payroll(rec["id"], user_email=admin.get("email", "admin"))
    return SalarySlipResponse(**PayrollService.to_legacy_slip_format(rec))

@router.post("/batch-run")
async def legacy_run_batch_payroll(req: BatchPayrollRunRequest, admin: Dict[str, Any] = Depends(get_current_admin)):
    bulk_req = BulkPayrollRunRequest(month=req.month, year=req.year, department=req.department, auto_approve=True)
    result = await PayrollService.run_advanced_bulk_payroll(bulk_req)
    result["message"] = (
        f"Batch payroll run completed for {req.month} {req.year}: "
        f"{result['successful_count']}/{result['total_processed']} processed successfully."
    )
    return result

@router.get("/slips", response_model=SalarySlipListResponse)
async def legacy_get_salary_slips(
    month: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    employee_id: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    records = await PayrollService.get_payrolls(month=month, year=year, search=search)
    if employee_id:
        records = [r for r in records if r.get("employee_id") == employee_id]
    return SalarySlipListResponse(
        total=len(records), month=month, year=year,
        slips=[SalarySlipResponse(**PayrollService.to_legacy_slip_format(r)) for r in records]
    )

@router.get("/slip/{slip_id}", response_model=SalarySlipResponse)
async def legacy_get_slip_details(slip_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    slip_col = get_collection("salary_slips")
    doc = await slip_col.find_one({"_id": slip_id})
    if not doc:
        # Check payroll record
        payroll_col = get_collection("payrolls")
        pdoc = await payroll_col.find_one({"_id": slip_id})
        if pdoc: doc = pdoc
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary slip not found.")
    return SalarySlipResponse(**PayrollService.to_legacy_slip_format(fix_id(doc)))

@router.get("/slip/{slip_id}/printable", response_class=HTMLResponse)
async def legacy_get_printable_salary_slip(slip_id: str):
    slip_col = get_collection("salary_slips")
    doc = await slip_col.find_one({"_id": slip_id})
    if not doc:
        payroll_col = get_collection("payrolls")
        doc = await payroll_col.find_one({"_id": slip_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary slip not found.")
    html_content = PDFService.generate_salary_slip_html(doc)
    return HTMLResponse(content=html_content)

@router.get("/summary", response_model=PayrollSummaryResponse)
async def legacy_get_payroll_summary(
    month: str = Query("September"),
    year: int = Query(2026),
    admin: Dict[str, Any] = Depends(get_current_admin)
):
    """Retrieve monthly payroll register summary metrics and department breakdown."""
    metrics = await PayrollService.get_dashboard_metrics(month=month, year=year)
    records = await PayrollService.get_payrolls(month=month, year=year)
    total_pf = sum((r.get("deductions") or {}).get("pf", 0.0) for r in records)
    total_pt = sum((r.get("deductions") or {}).get("professional_tax", (r.get("deductions") or {}).get("pt", 0.0)) for r in records)
    total_tds = sum((r.get("deductions") or {}).get("tds", 0.0) for r in records)
    return PayrollSummaryResponse(
        month=month,
        year=year,
        total_slips=metrics["processed_count"],
        total_gross_disbursed=metrics["total_gross_payroll"],
        total_pf_deducted=round(total_pf, 2),
        total_pt_deducted=round(total_pt, 2),
        total_tds_deducted=round(total_tds, 2),
        total_net_disbursed=metrics["total_net_payroll"],
        department_summary=metrics["department_breakdown"]
    )

@router.delete("/slip/{slip_id}")
async def delete_slip(slip_id: str, admin: Dict[str, Any] = Depends(get_current_admin)):
    """Delete a salary slip record."""
    res = await get_collection("salary_slips").delete_one({"_id": slip_id})
    if res.deleted_count == 0:
        rec = await get_collection("payrolls").find_one({"_id": slip_id})
        if not rec:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Salary slip not found.")
        if rec.get("is_locked") or rec.get("status") in ("FINALIZED", "PAID"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Finalized or paid payroll cannot be deleted. Unlock it first.")
        await get_collection("payrolls").delete_one({"_id": slip_id})
    return {"success": True, "message": "Salary slip deleted successfully."}

@router.post("/adjust-salary", response_model=PayrollAdjustmentResponse)
async def adjust_employee_salary(
    req: PayrollAdjustmentRequest,
    admin: Dict[str, Any] = Depends(get_current_admin),
):
    """
    Increment or decrement a specific payroll component for an employee.
    Records the adjustment in the activity logs with old/new values and reason.
    """
    try:
        result = await PayrollService.adjust_employee_salary(
            employee_id=req.employee_id,
            field=req.field,
            adjustment_type=req.adjustment_type,
            amount=req.amount,
            reason=req.reason,
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Error adjusting salary: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to adjust salary.",
        )

    # Log the payroll adjustment
    await LogService.log_payroll_adjustment(
        admin_email=admin.get("email", ""),
        admin_role=admin.get("role", "admin"),
        employee_name=result["employee_name"],
        employee_id=req.employee_id,
        adjustment_type=req.adjustment_type,
        field=req.field,
        old_value=result["old_value"],
        new_value=result["new_value"],
        amount=req.amount,
        reason=req.reason,
    )

    return PayrollAdjustmentResponse(
        employee_id=req.employee_id,
        employee_name=result["employee_name"],
        field=req.field,
        adjustment_type=req.adjustment_type,
        old_value=result["old_value"],
        new_value=result["new_value"],
        amount=req.amount,
        reason=req.reason,
        new_gross_salary=result["new_gross_salary"],
        new_estimated_net_salary=result["new_estimated_net_salary"],
        adjusted_by=admin.get("email", ""),
        timestamp=result["timestamp"],
    )
