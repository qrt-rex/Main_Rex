import logging
from html import escape
from typing import Dict, Any, Optional
from app.config import settings

logger = logging.getLogger("rexera.pdf")

class PDFService:
    @classmethod
    def generate_salary_slip_html(cls, slip: Dict[str, Any], company_settings: Optional[Dict[str, Any]] = None) -> str:
        """
        Generate official corporate printable HTML format for Salary Slip with company letterhead,
        comprehensive attendance, structured earnings & deductions, net pay in words, QR signature,
        and official stamp.
        """
        cfg = company_settings or {}
        # Every text value is HTML-escaped: names, departments etc. come from forms and imports,
        # and this page is served from the API origin and emailed.
        comp_name = escape(str(cfg.get("company_name") or settings.COMPANY_NAME))
        comp_addr = escape(str(cfg.get("company_address") or settings.COMPANY_ADDRESS))
        comp_phone = escape(str(cfg.get("company_phone") or settings.COMPANY_PHONE))
        comp_email = escape(str(cfg.get("company_email") or settings.COMPANY_EMAIL))

        earnings = slip.get("earnings") or {}
        deductions = slip.get("deductions") or {}
        attendance = slip.get("attendance") or {}
        raw_slip = slip
        slip = {k: (escape(v) if isinstance(v, str) else v) for k, v in raw_slip.items()}

        # Mask account number: e.g. ••••1234
        acc_raw = str(raw_slip.get("account_no") or "")
        acc_masked = escape(f"••••{acc_raw[-4:]}" if len(acc_raw) >= 4 else (acc_raw or "N/A"))

        def num(v, default=0.0):
            try:
                return float(v)
            except (TypeError, ValueError):
                return default
        lop_days = num(attendance.get("unpaid_leave_days")) + num(attendance.get("absent_days"))
        days = {k: escape(str(attendance.get(k, d))) for k, d in
                (("calendar_days", 30), ("working_days", 30), ("present_days", 30))}

        # Format rows
        def fmt(val):
            try:
                f_val = float(val)
                return f"₹{f_val:,.2f}"
            except Exception:
                return "₹0.00"

        # Sales staff: how the incentive on this slip was worked out (a copy taken when payroll was calculated).
        sales_block = ""
        inc = raw_slip.get("incentive_details")
        if isinstance(inc, dict):
            elig = inc.get("eligibility") or {}
            slab = inc.get("slab_percent")
            lines = [
                ("Gross Collection", fmt(inc.get("gross_collection", inc.get("collection", 0)))),
                ("DSC Deduction", fmt(inc.get("dsc_deduction", 0))),
                ("Net Eligible Collection", fmt(inc.get("net_collection", inc.get("collection", 0)))),
                ("Eligibility", f"{escape(str(elig.get('status', '—')))} (needs {fmt(inc.get('gate_amount', 0))})"),
                ("Monthly Target", fmt(inc.get("target_amount", 0))),
                ("Daily Incentive", fmt(inc.get("daily_incentive", 0))),
                ("Weekly Incentive", fmt(inc.get("weekly_incentive", 0))),
                (f"Monthly Incentive{f' ({slab:g}% slab)' if isinstance(slab, (int, float)) else ''}", fmt(inc.get("monthly_incentive", 0))),
            ]
            rows_html = "".join(f"<tr><td>{k}</td><td class=\"amt\">{v}</td></tr>" for k, v in lines)
            sales_block = f"""
        <div class="section-header">SALES PERFORMANCE</div>
        <table class="calc-table">
            <tbody>
                {rows_html}
                <tr class="total-row"><td>TOTAL INCENTIVE</td><td class="amt">{fmt(inc.get('incentive', 0))}</td></tr>
            </tbody>
        </table>
        <p style="font-size: 10px; color: #64748b; margin: -8px 0 15px;">{escape(str(inc.get('note', '')))}</p>"""

        # PF as payroll calculated it (copied onto the payslip at finalize). Older payslips have no copy and stay as they were.
        pf = raw_slip.get("pf") if isinstance(raw_slip.get("pf"), dict) else None
        pf_label = "Provident Fund (PF - 12%)"
        pf_block = ""
        if pf:
            if pf.get("status") == "CALCULATED":
                pf_label = f"Employee PF ({num(pf.get('employee_pf_percent')):g}% of PF wage)"
                limit = {"minimum": "raised to the minimum PF wage", "maximum": "capped at the maximum PF wage"}.get(pf.get("wage_limited_by") or "", "")
                lines = [
                    ("PF Wage", f"{fmt(pf.get('pf_wage'))}" + (f" <small style='color:#64748b'>({limit})</small>" if limit else "")),
                    (f"Employee PF ({num(pf.get('employee_pf_percent')):g}%)", fmt(pf.get("employee_pf"))),
                    (f"Employer PF ({num(pf.get('employer_pf_percent')):g}%)", fmt(pf.get("employer_pf"))),
                    (f"EPS ({num(pf.get('eps_percent')):g}%)", fmt(pf.get("eps"))),
                    ("Employer EPF", fmt(pf.get("employer_epf"))),
                ]
                basis = {"BASIC": "Basic", "BASIC_DA": "Basic + DA", "STATUTORY": "Statutory PF wage"}.get(
                    str(pf.get("calculation_basis") or "BASIC"), "Basic")
                rule_note = (f"PF wage = MIN(MAX({basis} {fmt(pf.get('pf_base'))}, {fmt(pf.get('minimum_pf_wage'))}), "
                             f"{fmt(pf.get('maximum_pf_wage'))}) · {escape(str(pf.get('rule_name', '')))}")
            else:
                pf_label = "Provident Fund (PF)"
                lines = [("PF status", escape(str(pf.get("reason") or pf.get("status") or "")))]
                rule_note = ""
            uan = escape(str(pf.get("uan") or "Not on record"))
            rows_html = "".join(f"<tr><td>{k}</td><td class=\"amt\">{v}</td></tr>" for k, v in lines)
            pf_block = f"""
        <div class="section-header">PROVIDENT FUND (UAN: {uan})</div>
        <table class="calc-table">
            <tbody>
                {rows_html}
                <tr class="total-row"><td>TOTAL EMPLOYER CONTRIBUTION</td><td class="amt">{fmt(pf.get('employer_pf', 0))}</td></tr>
                <tr><td>Cost to company (gross + employer contribution)</td><td class="amt">{fmt(raw_slip.get('ctc') or num(raw_slip.get('gross_salary')) + num(pf.get('employer_pf')))}</td></tr>
            </tbody>
        </table>
        <p style="font-size: 10px; color: #64748b; margin: -8px 0 15px;">{rule_note}</p>"""

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Salary Slip - {slip.get('employee_name')} - {slip.get('month')} {slip.get('year')}</title>
    <style>
        @page {{ size: A4; margin: 12mm; }}
        * {{ box-sizing: border-box; }}
        body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 20px; background: #f8fafc; line-height: 1.4; }}
        .payslip-container {{ max-width: 820px; margin: 0 auto; background: #ffffff; border: 2px solid #09234b; padding: 25px; border-radius: 8px; position: relative; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }}
        .header {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #09234b; padding-bottom: 15px; margin-bottom: 15px; }}
        .logo-box img {{ height: 55px; }}
        .company-info {{ text-align: right; }}
        .company-info h2 {{ margin: 0; color: #09234b; font-size: 20px; text-transform: uppercase; font-weight: 800; }}
        .company-info p {{ margin: 2px 0; font-size: 11px; color: #64748b; }}
        
        .slip-title {{ text-align: center; background: #09234b; color: #ffffff; padding: 8px; margin-bottom: 15px; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; border-radius: 4px; }}
        
        .details-grid {{ width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; }}
        .details-grid td {{ padding: 6px 10px; border: 1px solid #e2e8f0; }}
        .details-grid .lbl {{ font-weight: 700; background: #f8fafc; color: #334155; width: 20%; }}
        .details-grid .val {{ color: #0f172a; width: 30%; }}
        
        .section-header {{ background: #f1f5f9; padding: 6px 10px; font-weight: 700; font-size: 12px; color: #09234b; border: 1px solid #e2e8f0; border-bottom: none; }}
        
        .calc-table {{ width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; }}
        .calc-table th {{ background: #1e3a8a; color: #ffffff; padding: 7px 10px; text-align: left; font-size: 11px; }}
        .calc-table td {{ padding: 6px 10px; border: 1px solid #e2e8f0; }}
        .calc-table .amt {{ text-align: right; font-family: 'Consolas', monospace; font-size: 12px; font-weight: 600; }}
        .total-row {{ background: #f8fafc; font-weight: 700; font-size: 12px; }}
        
        .net-salary-banner {{ background: #f0fdf4; border: 2px solid #10b981; padding: 12px 18px; border-radius: 6px; margin: 15px 0; display: flex; justify-content: space-between; align-items: center; }}
        .net-lbl {{ font-size: 13px; font-weight: 700; color: #065f46; text-transform: uppercase; }}
        .net-amt {{ font-size: 22px; font-weight: 800; color: #065f46; font-family: 'Consolas', monospace; }}
        .net-words {{ font-size: 11px; color: #065f46; font-style: italic; margin-top: 4px; }}
        
        .footer-signatures {{ display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; padding-top: 15px; }}
        .sig-box {{ text-align: center; width: 180px; }}
        .sig-line {{ border-top: 1px dashed #64748b; margin-top: 40px; padding-top: 5px; font-size: 11px; font-weight: 700; color: #334155; }}
        .stamp-box {{ text-align: center; }}
        .stamp-box img {{ height: 85px; opacity: 0.9; transform: rotate(-4deg); }}
        
        .notes-box {{ margin-top: 15px; padding: 8px 12px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px; font-size: 10px; color: #64748b; text-align: center; }}
        
        .no-print-bar {{ text-align: center; margin-bottom: 20px; }}
        .btn-print {{ background: #09234b; color: #fff; border: none; padding: 10px 24px; font-size: 13px; font-weight: 700; border-radius: 6px; cursor: pointer; }}
        
        @media print {{
            .no-print-bar {{ display: none; }}
            body {{ padding: 0; background: #fff; }}
            .payslip-container {{ border: none; padding: 0; box-shadow: none; }}
        }}
    </style>
</head>
<body>
    <div class="no-print-bar">
        <button class="btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>

    <div class="payslip-container">
        <!-- Letterhead Header -->
        <div class="header">
            <div class="logo-box">
                <img src="/assets/logo.png" alt="Rexera Logo" onerror="this.src='/logo.png'">
            </div>
            <div class="company-info">
                <h2>{comp_name}</h2>
                <p>{comp_addr}</p>
                <p>Email: {comp_email} | Tel: {comp_phone}</p>
            </div>
        </div>

        <div class="slip-title">
            SALARY PAYSLIP & COMPLIANCE STATEMENT — {str(slip.get('month', '')).upper()} {slip.get('year')}
        </div>

        <!-- Employee & Attendance Details Grid -->
        <table class="details-grid">
            <tr>
                <td class="lbl">Employee Name:</td>
                <td class="val"><strong>{slip.get('employee_name')}</strong></td>
                <td class="lbl">Payslip Number:</td>
                <td class="val"><code>{slip.get('payslip_number') or slip.get('slip_number') or 'REX-PAY-2026-001'}</code></td>
            </tr>
            <tr>
                <td class="lbl">Employee ID:</td>
                <td class="val"><strong>{slip.get('employee_code')}</strong></td>
                <td class="lbl">Payroll ID:</td>
                <td class="val"><code>{slip.get('payroll_id') or 'N/A'}</code></td>
            </tr>
            <tr>
                <td class="lbl">Department:</td>
                <td class="val">{slip.get('department')}</td>
                <td class="lbl">Designation:</td>
                <td class="val">{slip.get('designation')}</td>
            </tr>
            <tr>
                <td class="lbl">Date of Joining:</td>
                <td class="val">{slip.get('joining_date') or slip.get('date_of_joining') or 'N/A'}</td>
                <td class="lbl">PAN Number:</td>
                <td class="val">{slip.get('pan_number') or 'N/A'}</td>
            </tr>
            <tr>
                <td class="lbl">Bank Name:</td>
                <td class="val">{slip.get('bank_name') or 'N/A'}</td>
                <td class="lbl">Bank Account:</td>
                <td class="val">{acc_masked} (IFSC: {slip.get('ifsc_code') or 'N/A'})</td>
            </tr>
            <tr>
                <td class="lbl">Calendar / Working Days:</td>
                <td class="val">{days['calendar_days']} / {days['working_days']}</td>
                <td class="lbl">Paid / LOP Days:</td>
                <td class="val">{days['present_days']} Present / {lop_days:g} LOP</td>
            </tr>
        </table>

        <!-- Earnings & Deductions Tables (Side by Side Breakdown) -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
            <tr>
                <td style="width: 50%; vertical-align: top; padding-right: 6px;">
                    <div class="section-header">EARNINGS COMPONENT</div>
                    <table class="calc-table">
                        <thead>
                            <tr><th>Particulars</th><th style="text-align: right;">Amount (₹)</th></tr>
                        </thead>
                        <tbody>
                            <tr><td>Basic Salary</td><td class="amt">{fmt(earnings.get('basic', 0))}</td></tr>
                            {f"<tr><td>Dearness Allowance (DA)</td><td class='amt'>{fmt(earnings.get('da', 0))}</td></tr>" if num(earnings.get('da')) else ""}
                            <tr><td>House Rent Allowance (HRA)</td><td class="amt">{fmt(earnings.get('hra', 0))}</td></tr>
                            <tr><td>Conveyance Allowance</td><td class="amt">{fmt(earnings.get('conveyance', 0))}</td></tr>
                            <tr><td>Medical Allowance</td><td class="amt">{fmt(earnings.get('medical', 0))}</td></tr>
                            <tr><td>Special Allowance</td><td class="amt">{fmt(earnings.get('special_allowance', 0))}</td></tr>
                            <tr><td>Other Allowances</td><td class="amt">{fmt(earnings.get('other_allowances', 0))}</td></tr>
                            <tr><td>Overtime Pay</td><td class="amt">{fmt(earnings.get('overtime_pay', 0))}</td></tr>
                            <tr><td>Performance Bonus</td><td class="amt">{fmt(earnings.get('bonus', 0))}</td></tr>
                            <tr><td>Incentives</td><td class="amt">{fmt(earnings.get('incentive', 0))}</td></tr>
                            <tr><td>Other Earnings / Adjustments</td><td class="amt">{fmt(num(earnings.get('other_earnings')) + num(earnings.get('manual_adjustments')))}</td></tr>
                            <tr class="total-row">
                                <td>TOTAL GROSS EARNINGS</td>
                                <td class="amt" style="color: #1e3a8a;">{fmt(earnings.get('gross_salary', slip.get('gross_salary', 0)))}</td>
                            </tr>
                        </tbody>
                    </table>
                </td>

                <td style="width: 50%; vertical-align: top; padding-left: 6px;">
                    <div class="section-header">DEDUCTIONS & RECOVERIES</div>
                    <table class="calc-table">
                        <thead>
                            <tr><th>Particulars</th><th style="text-align: right;">Amount (₹)</th></tr>
                        </thead>
                        <tbody>
                            <tr><td>{pf_label}</td><td class="amt">{fmt(deductions.get('pf', 0))}</td></tr>
                            <tr><td>Employee State Insurance (ESI)</td><td class="amt">{fmt(deductions.get('esi', 0))}</td></tr>
                            <tr><td>Professional Tax (PT)</td><td class="amt">{fmt(deductions.get('professional_tax', deductions.get('pt', 200)))}</td></tr>
                            <tr><td>Income Tax / TDS</td><td class="amt">{fmt(deductions.get('tds', 0))}</td></tr>
                            <tr><td>Unpaid Leave / LOP Deduction</td><td class="amt">{fmt(deductions.get('unpaid_leave_deduction', deductions.get('lop_deduction', 0)))}</td></tr>
                            <tr><td>Late Attendance Deduction</td><td class="amt">{fmt(deductions.get('late_deduction', 0))}</td></tr>
                            <tr><td>Salary Advance Recovery</td><td class="amt">{fmt(deductions.get('salary_advance_deduction', 0))}</td></tr>
                            <tr><td>Employee Loan EMI</td><td class="amt">{fmt(deductions.get('loan_deduction', 0))}</td></tr>
                            <tr><td>Other Deductions / Adjustments</td><td class="amt">{fmt(num(deductions.get('other_deductions')) + num(deductions.get('manual_adjustments')))}</td></tr>
                            <tr style="visibility: hidden;"><td>Placeholder</td><td class="amt">0</td></tr>
                            <tr class="total-row">
                                <td>TOTAL DEDUCTIONS</td>
                                <td class="amt" style="color: #991b1b;">{fmt(deductions.get('total_deductions', deductions.get('gross_deductions', 0)))}</td>
                            </tr>
                        </tbody>
                    </table>
                </td>
            </tr>
        </table>
{sales_block}{pf_block}
        <!-- Net Payable Summary Banner -->
        <div class="net-salary-banner">
            <div>
                <div class="net-lbl">NET TAKE-HOME PAYABLE SALARY</div>
                <div class="net-words">Amount in words: <strong>{slip.get('net_salary_words', '')}</strong></div>
            </div>
            <div class="net-amt">
                {fmt(slip.get('net_salary', 0))}
            </div>
        </div>

        <!-- Authorization Signatures & Official Stamp -->
        <div class="footer-signatures">
            <div class="sig-box">
                <div class="sig-line">Employee Signature</div>
            </div>

            <div class="stamp-box">
                <img src="/assets/stamp.png" alt="Rexera Official Stamp" onerror="this.src='/stamp.png'">
            </div>

            <div class="sig-box">
                <div class="sig-line">Authorized Signatory<br><small>Rexera HR & Payroll Division</small></div>
            </div>
        </div>

        <div class="notes-box">
            Note: This is an authentic system-generated payslip issued by Rexera Technologies Inc. and does not require a physical signature when electronically verified. For inquiries, contact hr@rexera.co.in.
        </div>
    </div>
</body>
</html>"""
