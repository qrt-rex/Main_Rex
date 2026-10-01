"""
Billing and Invoicing Router for Rexera CRM.
Provides Indian GST compliance, multi-branch invoice numbering, quotations,
clients, products, payments, reports and vector PDF generation.
"""
import base64
import csv
import io
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from xml.sax.saxutils import escape as _xml_escape
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from app.database import get_collection
from app.services.audit_service import AuditService
from app.services.auth_service import get_current_admin
from app.services import sales_payroll
from app.services.rbac_service import get_user_permissions, has_role
from app.utils.validators import optional_phone, search_pattern
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm

router = APIRouter(prefix="/api/billing", tags=["Billing & Invoices"])

# ---------------------------------------------------------------------------
# Helpers & Business Logic
# ---------------------------------------------------------------------------
ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

def _convert_two_digits(n: int) -> str:
    if n == 0:
        return ""
    elif n < 20:
        return ONES[n]
    else:
        tens_part = TENS[n // 10]
        units_part = ONES[n % 10]
        return f"{tens_part} {units_part}".strip()

def _convert_three_digits(n: int) -> str:
    hundreds = n // 100
    remainder = n % 100
    parts = []
    if hundreds > 0:
        parts.append(f"{ONES[hundreds]} Hundred")
    if remainder > 0:
        parts.append(_convert_two_digits(remainder))
    return " ".join(parts)

def amount_to_words_inr(amount: float) -> str:
    if amount is None or amount == 0:
        return "Zero Rupees Only"
    amount = round(amount, 2)
    is_negative = amount < 0
    amount = abs(amount)
    total_paise = int(round(amount * 100))  # avoids 0.995 -> "100 paise"
    rupees, paise = divmod(total_paise, 100)
    if rupees == 0 and paise == 0:
        return "Zero Rupees Only"
    parts = []
    if rupees > 0:
        crores = rupees // 10000000
        rem_crores = rupees % 10000000
        lakhs = rem_crores // 100000
        rem_lakhs = rem_crores % 100000
        thousands = rem_lakhs // 1000
        hundreds_units = rem_lakhs % 1000  # was `rem_thousands`, an undefined name: every non-zero total crashed
        if crores > 0:
            if crores >= 100:
                parts.append(f"{amount_to_words_inr(crores).replace(' Rupees Only', '')} Crore")
            else:
                parts.append(f"{_convert_two_digits(crores)} Crore")
        if lakhs > 0:
            parts.append(f"{_convert_two_digits(lakhs)} Lakh")
        if thousands > 0:
            parts.append(f"{_convert_two_digits(thousands)} Thousand")
        if hundreds_units > 0:
            parts.append(_convert_three_digits(hundreds_units))
        rupees_word = " ".join(parts).strip()
        result = f"{rupees_word} {'Rupee' if rupees == 1 else 'Rupees'}"
    else:
        result = ""
    if paise > 0:
        paise_word = _convert_two_digits(paise)
        result = f"{result} and {paise_word} Paise" if result else f"{paise_word} Paise"
    prefix = "Minus " if is_negative else ""
    return f"{prefix}{result} Only".strip()

def get_financial_year(target_date: Optional[date] = None):
    if target_date is None:
        target_date = date.today()
    elif isinstance(target_date, datetime):
        target_date = target_date.date()
    year = target_date.year
    month = target_date.month
    if month >= 4:
        start_yr = year
        end_yr = year + 1
    else:
        start_yr = year - 1
        end_yr = year
    start_yy = str(start_yr)[-2:]
    end_yy = str(end_yr)[-2:]
    return f"{start_yy}{end_yy}", f"{start_yy}-{end_yy}"

BRANCHES_MASTER = {
    "ahmedabad_y": {
        "branch_key": "ahmedabad_y",
        "prefix": "AM1",
        "display_name": "Ahmedabad(Y)",
        "company_name": "REXERA FINANCIAL SERVICES PRIVATE LIMITED",
        "address": "102-b Block D Ganesh, Meridian Opp Kargil Pump, Ghatlodia, Ahmedabad, Gujarat, 380061",
        "phone": "9898187478",
        "email": "contact@rexera.co.in",
        "gstin": "24AAOCR9991A1ZZ",
        "state": "Gujarat",
        "state_code": "24",
        "bank_details": {
            "account_name": "REXERA FINANCIAL SERVICES PVT LTD",
            "account_number": "404005000998",
            "ifsc_code": "ICIC0004040",
            "upi_id": "9898187478@icici"
        }
    },
    "ahmedabad_a": {
        "branch_key": "ahmedabad_a",
        "prefix": "AM2",
        "display_name": "Ahmedabad(A)",
        "company_name": "REXERA FINANCIAL SERVICES PRIVATE LIMITED",
        "address": "1408-1409, 14th Floor, Altimus, Navrangpura, Ahmedabad, Gujarat 380009",
        "phone": "9898187478",
        "email": "contact@rexera.co.in",
        "gstin": "24AAOCR9991A1ZZ",
        "state": "Gujarat",
        "state_code": "24",
        "bank_details": {
            "account_name": "REXERA FINANCIAL SERVICES PVT LTD",
            "account_number": "404005000998",
            "ifsc_code": "ICIC0004040",
            "upi_id": "9898187478@icici"
        }
    },
    "baroda": {
        "branch_key": "baroda",
        "prefix": "BRD",
        "display_name": "Baroda",
        "company_name": "REXERA FINANCIAL SERVICES PRIVATE LIMITED",
        "address": "610, 6th Floor, Everest Onyx, Beside Indraprasth Appartment, Race course road, Vadiwadi, Baroda - 390021",
        "phone": "9898187478",
        "email": "contact@rexera.co.in",
        "gstin": "24AAOCR9991A1ZZ",
        "state": "Gujarat",
        "state_code": "24",
        "bank_details": {
            "account_name": "REXERA FINANCIAL SERVICES PVT LTD",
            "account_number": "404005000998",
            "ifsc_code": "ICIC0004040",
            "upi_id": "9898187478@icici"
        }
    }
}

async def generate_next_number(branch_key: str = "ahmedabad_y", doc_type: str = "invoice", reserve: bool = True) -> str:
    fy_code, _ = get_financial_year()
    branch = BRANCHES_MASTER.get(branch_key, BRANCHES_MASTER["ahmedabad_y"])
    prefix = branch["prefix"]
    counters = get_collection("billing_counters")
    
    if doc_type == "proforma":
        key = f"PROFORMA_{fy_code}"
        doc = await counters.find_one({"key": key})
        curr = doc.get("sequence_value", 0) if doc else 0
        seq = curr + 1
        if reserve:
            await counters.update_one({"key": key}, {"$set": {"key": key, "sequence_value": seq}}, upsert=True)
        return f"INV-{seq:03d}"
    elif doc_type == "quotation":
        key = f"QT_{fy_code}"
        doc = await counters.find_one({"key": key})
        curr = doc.get("sequence_value", 0) if doc else 0
        seq = curr + 1
        if reserve:
            await counters.update_one({"key": key}, {"$set": {"key": key, "sequence_value": seq}}, upsert=True)
        return f"QT{fy_code}-{seq:04d}"
    else:
        key = f"INV_{fy_code}_{prefix}"
        doc = await counters.find_one({"key": key})
        curr = doc.get("sequence_value", 0) if doc else 0
        seq = curr + 1
        if reserve:
            await counters.update_one({"key": key}, {"$set": {"key": key, "sequence_value": seq}}, upsert=True)
        return f"Inv{fy_code}/{prefix}-{seq:04d}"

GST_RATES = {0.0, 0.1, 0.25, 1.5, 3.0, 5.0, 12.0, 18.0, 28.0, 40.0}
QUOTATION_STATUSES = {"draft", "sent", "accepted", "rejected", "expired", "converted"}
GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def _num(value: Any, label: str, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        n = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{label} must be a number.")
    if n != n or n in (float("inf"), float("-inf")):
        raise HTTPException(status_code=422, detail=f"{label} must be a number.")
    return n


def validate_items(items: Any) -> List[Dict[str, Any]]:
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=422, detail="Add at least one line item.")
    for i, item in enumerate(items, 1):
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail=f"Line {i} is not a valid item.")
        if not str(item.get("name") or "").strip():
            raise HTTPException(status_code=422, detail=f"Line {i}: enter the item name.")
        qty = _num(item.get("quantity"), f"Line {i} quantity", 1)
        price = _num(item.get("unit_price"), f"Line {i} rate")
        disc = _num(item.get("discount"), f"Line {i} discount")
        rate = _num(item.get("gst_rate"), f"Line {i} GST rate", 18.0)
        if qty <= 0:
            raise HTTPException(status_code=422, detail=f"Line {i}: quantity must be more than zero.")
        if price < 0 or disc < 0:
            raise HTTPException(status_code=422, detail=f"Line {i}: rate and discount cannot be negative.")
        if disc > qty * price + 0.005:
            raise HTTPException(status_code=422, detail=f"Line {i}: the discount is larger than the line amount.")
        if rate not in GST_RATES:
            raise HTTPException(status_code=422, detail=f"Line {i}: {rate:g}% is not a GST rate.")
    return items


def validate_client(client: Any) -> Dict[str, Any]:
    if not isinstance(client, dict) or not str(client.get("name") or client.get("company_name") or "").strip():
        raise HTTPException(status_code=422, detail="Choose or enter the client.")
    gstin = str(client.get("gstin") or "").strip().upper()
    if gstin:
        if not GSTIN_RE.match(gstin):
            raise HTTPException(status_code=422, detail=f"GSTIN {gstin} is not valid (15 characters, e.g. 24ABCDE1234F1Z5).")
        client = {**client, "gstin": gstin}
    if client.get("phone"):
        client = {**client, "phone": _phone(client["phone"], "Client phone")}
    return client


def _date(value: Any, label: str, default: str) -> str:
    if value in (None, ""):
        return default
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label} must be a valid date (YYYY-MM-DD).")


def calculate_taxes(items: List[Dict[str, Any]], client: Dict[str, Any], apply_gst: bool = True) -> Dict[str, Any]:
    sub_total = 0.0
    discount_total = 0.0
    processed_items = []

    client_state = (client.get("state") or "").strip().lower()
    client_state_code = str(client.get("state_code") or "").strip()
    gstin_state = str(client.get("gstin") or "")[:2]
    # Place of supply decides CGST+SGST (inside Gujarat) vs IGST.
    is_intra_state = client_state == "gujarat" or client_state_code == "24" or gstin_state == "24"
    cgst_amount = sgst_amount = igst_amount = 0.0

    for item in items:
        qty = float(item.get("quantity", 1) or 1)
        price = float(item.get("unit_price", 0) or 0)
        disc = float(item.get("discount", 0) or 0)
        rate = float(item.get("gst_rate", 18.0) if item.get("gst_rate") not in (None, "") else 18.0)
        line_gross = qty * price
        line_amount = max(line_gross - disc, 0.0)
        sub_total += line_amount
        discount_total += min(disc, line_gross)
        # Each line is taxed at its own GST rate (everything used to be taxed at 18%).
        if apply_gst:
            if is_intra_state:
                cgst_amount += line_amount * rate / 200.0
                sgst_amount += line_amount * rate / 200.0
            else:
                igst_amount += line_amount * rate / 100.0
        processed_items.append({
            "name": item.get("name", "Service"),
            "description": item.get("description", ""),
            "hsn_sac": item.get("hsn_sac", "997159"),
            "quantity": round(qty, 2),
            "unit": item.get("unit", "NOS"),
            "unit_price": round(price, 2),
            "discount": round(disc, 2),
            "amount": round(line_amount, 2),
            "gst_rate": rate,
        })

    sub_total = round(sub_total, 2)
    taxable_amount = sub_total
    cgst_amount, sgst_amount, igst_amount = round(cgst_amount, 2), round(sgst_amount, 2), round(igst_amount, 2)

    # A single headline rate when every line shares one; "mixed" otherwise.
    rates = {i["gst_rate"] for i in processed_items} if apply_gst else {0.0}
    uniform = next(iter(rates)) if len(rates) == 1 else None
    cgst_rate = sgst_rate = igst_rate = 0.0
    if apply_gst and is_intra_state:
        cgst_rate = sgst_rate = (uniform / 2) if uniform is not None else "mixed"
    elif apply_gst:
        igst_rate = uniform if uniform is not None else "mixed"

    total_tax = cgst_amount + sgst_amount + igst_amount
    grand_total = round(taxable_amount + total_tax, 2)
    words = amount_to_words_inr(grand_total)
    
    return {
        "items": processed_items,
        "sub_total": sub_total,
        "discount_total": round(discount_total, 2),
        "taxable_amount": taxable_amount,
        "cgst_rate": cgst_rate,
        "cgst_amount": cgst_amount,
        "sgst_rate": sgst_rate,
        "sgst_amount": sgst_amount,
        "igst_rate": igst_rate,
        "igst_amount": igst_amount,
        "round_off": 0.0,
        "grand_total": grand_total,
        "amount_in_words": words
    }

# ---------------------------------------------------------------------------
# ReportLab PDF Generator
# ---------------------------------------------------------------------------
def generate_invoice_pdf(invoice: Dict[str, Any]) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm
    )
    body_bold = ParagraphStyle('BodyB', fontName='Helvetica-Bold', fontSize=8.5, leading=11, textColor=colors.HexColor('#0F172A'))
    body_normal = ParagraphStyle('BodyN', fontName='Helvetica', fontSize=8, leading=10.5, textColor=colors.HexColor('#334155'))
    table_hdr = ParagraphStyle('TH', fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.HexColor('#FFFFFF'))
    
    # Every value below is escaped: ReportLab parses its own mini-HTML, so a client named
    # "A<B" or an item description with markup broke (or injected into) the PDF.
    branch = {k: (_xml_escape(v) if isinstance(v, str) else v) for k, v in (invoice.get("branch") or {}).items()}
    client = {k: (_xml_escape(str(v)) if v is not None else "") for k, v in (invoice.get("client") or {}).items()}
    e = lambda v: _xml_escape(str(v if v is not None else ""))
    pct = lambda v: f"{v:g}%" if isinstance(v, (int, float)) else "mixed rates"

    story = []

    # Header row
    inv_type = "TAX INVOICE" if invoice.get("invoice_type") != "proforma" else "PROFORMA INVOICE"
    hdr_data = [
        [
            Paragraph(f"<b>{branch.get('company_name', 'REXERA FINANCIAL SERVICES PVT LTD')}</b><br/>{branch.get('address', '')}<br/>GSTIN: <b>{branch.get('gstin', '')}</b> | State: {branch.get('state', 'Gujarat')}", body_normal),
            Paragraph(f"<font color='#2563EB'><b>{inv_type}</b></font><br/><b>Invoice #:</b> {e(invoice.get('invoice_number', ''))}<br/><b>Date:</b> {e(invoice.get('invoice_date', ''))}<br/><b>Due Date:</b> {e(invoice.get('due_date', ''))}", body_normal)
        ]
    ]
    hdr_table = Table(hdr_data, colWidths=[110 * mm, 70 * mm])
    hdr_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    story.append(hdr_table)
    story.append(Spacer(1, 4 * mm))
    
    # Bill To Box
    bill_to_data = [
        [
            Paragraph("<b>BILLED TO (CLIENT DETAILS)</b>", body_bold),
            Paragraph("<b>PLACE OF SUPPLY</b>", body_bold)
        ],
        [
            Paragraph(f"<b>{client.get('name') or client.get('company_name', '')}</b><br/>{client.get('address', '')}<br/>GSTIN: <b>{client.get('gstin') or 'Unregistered'}</b><br/>State: {client.get('state', '')} (Code: {client.get('state_code', '')})<br/>Contact: {client.get('contact_person', '')} ({client.get('phone', '')})", body_normal),
            Paragraph(f"State: <b>{client.get('state', branch.get('state', 'Gujarat'))}</b><br/>Reverse Charge (RCM): <b>{'Yes' if invoice.get('is_reverse_charge') else 'No'}</b><br/>Branch: <b>{branch.get('display_name', 'Main')}</b>", body_normal)
        ]
    ]
    b_table = Table(bill_to_data, colWidths=[110 * mm, 70 * mm])
    b_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(b_table)
    story.append(Spacer(1, 4 * mm))
    
    # Items Table
    items_header = [
        Paragraph("#", table_hdr),
        Paragraph("Item & Description", table_hdr),
        Paragraph("HSN/SAC", table_hdr),
        Paragraph("Qty", table_hdr),
        Paragraph("Rate (₹)", table_hdr),
        Paragraph("Discount", table_hdr),
        Paragraph("Amount (₹)", table_hdr)
    ]
    items_rows = [items_header]
    for idx, it in enumerate(invoice.get("items", []), 1):
        items_rows.append([
            Paragraph(str(idx), body_normal),
            Paragraph(f"<b>{e(it.get('name', ''))}</b><br/><font color='#64748B'>{e(it.get('description', ''))}</font>", body_normal),
            Paragraph(e(it.get('hsn_sac', '')), body_normal),
            Paragraph(f"{e(it.get('quantity', 1))} {e(it.get('unit', ''))}", body_normal),
            Paragraph(f"₹{it.get('unit_price', 0):,.2f}", body_normal),
            Paragraph(f"₹{it.get('discount', 0):,.2f}", body_normal),
            Paragraph(f"<b>₹{it.get('amount', 0):,.2f}</b>", body_bold),
        ])
    
    it_table = Table(items_rows, colWidths=[10 * mm, 68 * mm, 22 * mm, 18 * mm, 22 * mm, 18 * mm, 24 * mm])
    it_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1E293B')),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(it_table)
    story.append(Spacer(1, 4 * mm))
    
    # Summary Box
    bank = branch.get("bank_details", {})
    summary_data = [
        [
            Paragraph(f"<b>Bank Account Details:</b><br/>A/C Name: <b>{bank.get('account_name', '')}</b><br/>A/C No: <b>{bank.get('account_number', '')}</b><br/>IFSC Code: <b>{bank.get('ifsc_code', '')}</b><br/>UPI ID: <b>{bank.get('upi_id', '')}</b>", body_normal),
            Table([
                [Paragraph("Taxable Amount:", body_normal), Paragraph(f"₹{invoice.get('taxable_amount', 0):,.2f}", body_normal)],
                *(
                    [
                        [Paragraph(f"CGST ({pct(invoice.get('cgst_rate', 9))}):", body_normal), Paragraph(f"₹{invoice.get('cgst_amount', 0):,.2f}", body_normal)],
                        [Paragraph(f"SGST ({pct(invoice.get('sgst_rate', 9))}):", body_normal), Paragraph(f"₹{invoice.get('sgst_amount', 0):,.2f}", body_normal)],
                    ] if (invoice.get("cgst_amount") or 0) > 0 else
                    [
                        [Paragraph(f"IGST ({pct(invoice.get('igst_rate', 18))}):", body_normal), Paragraph(f"₹{invoice.get('igst_amount', 0):,.2f}", body_normal)],
                    ]
                ),
                [Paragraph("<b>Grand Total:</b>", body_bold), Paragraph(f"<b>₹{invoice.get('grand_total', 0):,.2f}</b>", body_bold)],
                [Paragraph("Balance Due:", body_normal), Paragraph(f"₹{invoice.get('balance_amount', invoice.get('grand_total', 0)):,.2f}", body_normal)],
            ], colWidths=[38 * mm, 32 * mm])
        ]
    ]
    sum_table = Table(summary_data, colWidths=[110 * mm, 70 * mm])
    sum_table.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(sum_table)
    story.append(Spacer(1, 3 * mm))
    
    # Amount in words
    words_p = Paragraph(f"<b>Amount in Words:</b> <i>{e(invoice.get('amount_in_words', ''))}</i>", body_normal)
    story.append(words_p)
    story.append(Spacer(1, 4 * mm))
    
    # Terms & Authorization
    auth_data = [
        [
            Paragraph("<b>Terms & Conditions:</b><br/>1. Payment due within 15 days of invoice date.<br/>2. Interest @ 18% p.a. will be charged for delayed payments.<br/>3. Subject to Ahmedabad jurisdiction.", body_normal),
            Paragraph(f"<b>For {branch.get('company_name', 'REXERA FINANCIAL SERVICES PVT LTD')}</b><br/><br/><br/><b>Authorised Signatory</b>", body_normal)
        ]
    ]
    auth_table = Table(auth_data, colWidths=[110 * mm, 70 * mm])
    auth_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(auth_table)
    
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

async def _require_tax_invoice_access(admin: dict, invoice_type: str) -> None:
    """Tax invoices are HR-only; anyone with billing.create may issue proforma invoices."""
    if invoice_type != "invoice":
        return
    if "billing.tax_invoice" not in await get_user_permissions(admin):
        raise HTTPException(status_code=403, detail="Only HR can issue or edit tax invoices. You can issue proforma invoices.")

# ---- Ownership: an invoice belongs to the person who generated it ----
# Created directly: the signed-in user. Issued from an invoice request: the requester. Converted from a
# quotation: whoever made the quotation. Never taken from the request body. When the owner is a sales
# account, the invoice's collections are credited to them (scorecard and incentive).

def _me(admin: dict) -> str:
    return str(admin.get("email") or admin.get("username") or "").strip().lower()


async def _sees_all(admin: dict) -> bool:
    """HR, Admin / Accounting and Super Admin see every invoice; everyone else only their own."""
    return "billing.all_invoices" in await get_user_permissions(admin)


def _mine(admin: dict) -> Dict[str, Any]:
    me = _me(admin)
    return {"$or": [{"owner_email": me}, {"sales_person_email": me}]}


def _is_mine(doc: Dict[str, Any], admin: dict) -> bool:
    me = _me(admin)
    return bool(me) and me in (str(doc.get("owner_email") or "").lower(), str(doc.get("sales_person_email") or "").lower())


async def _scoped(query: Dict[str, Any], admin: dict) -> Dict[str, Any]:
    """An invoice query limited to what this person may see: their own and not cancelled, unless they see all."""
    if await _sees_all(admin):
        return query
    return {"$and": [query, _mine(admin), {"status": {"$ne": "cancelled"}}]}


async def _invoice_for(invoice_id: str, admin: dict) -> Dict[str, Any]:
    inv = await get_collection("billing_invoices").find_one(
        {"$or": [{"id": invoice_id}, {"_id": invoice_id}, {"invoice_number": invoice_id}]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if not await _sees_all(admin) and not (_is_mine(inv, admin) and inv.get("status") != "cancelled"):
        raise HTTPException(status_code=403, detail="You can only open your own invoices.")
    return inv


async def _owner_fields(owner_email: str) -> Dict[str, str]:
    owner_email = owner_email.strip().lower()
    user = await get_collection("admins").find_one(
        {"email": {"$regex": f"^{re.escape(owner_email)}$", "$options": "i"}}) if owner_email else None
    name = (user or {}).get("username") or owner_email
    sales = bool(user) and user.get("is_active", True) and has_role(user, "sales")
    return {"owner_email": owner_email, "owner_name": name,
            "sales_person_email": owner_email if sales else "", "sales_person_name": name if sales else ""}


async def _customer_link(client: Dict[str, Any], admin: dict) -> Dict[str, Any]:
    """The saved customer (and the lead it came from) the invoice traces back to, if this person may use it."""
    cid = str(client.get("id") or "").strip()
    saved = await get_collection("billing_clients").find_one({"$or": [{"id": cid}, {"_id": cid}]}) if cid else None
    if not saved or not (await _sees_all(admin) or str(saved.get("owner_email") or "").lower() == _me(admin)):
        return {"customer_id": None, "lead_id": None}
    return {"customer_id": saved.get("id") or str(saved["_id"]), "lead_id": saved.get("lead_id")}

@router.get("/invoices/next-number")
async def get_next_invoice_number(
    branch_key: str = Query("ahmedabad_y"),
    invoice_type: str = Query("invoice"),
    admin: dict = Depends(get_current_admin)
):
    next_num = await generate_next_number(branch_key=branch_key, doc_type=invoice_type, reserve=False)
    return {"success": True, "invoice_number": next_num}

@router.get("/invoices")
async def list_invoices(
    branch_key: Optional[str] = Query(None),
    invoice_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: dict = Depends(get_current_admin)
):
    coll = get_collection("billing_invoices")
    query = {}
    if branch_key and branch_key != "all":
        query["branch_key"] = branch_key
    if invoice_type and invoice_type != "all":
        query["invoice_type"] = invoice_type
    if status == "overdue":
        # Nothing stores an "overdue" status: it means unpaid past the due date.
        query["balance_amount"] = {"$gt": 0}
        query["due_date"] = {"$lt": date.today().isoformat()}
        query["status"] = {"$ne": "cancelled"}
    elif status and status != "all":
        query["status"] = status
    if search and search.strip():
        pattern = search_pattern(search)
        query["$or"] = [
            {"invoice_number": {"$regex": pattern, "$options": "i"}},
            {"client.name": {"$regex": pattern, "$options": "i"}},
            {"client.company_name": {"$regex": pattern, "$options": "i"}},
            {"client.gstin": {"$regex": pattern, "$options": "i"}},
        ]

    query = await _scoped(query, admin)
    # Count and page in the database (loading 1000 rows capped totals and dropped older invoices).
    total = await coll.count_documents(query)
    skip = (page - 1) * limit
    paginated = await coll.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {
        "success": True,
        "items": paginated,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 1
    }

@router.post("/invoices", status_code=status.HTTP_201_CREATED)
async def create_invoice(payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    """Made out for the signed-in user, or for the requester when a billing manager issues it for a request."""
    request = None
    if payload.get("request_id"):
        if not await _can_manage_billing(admin):
            raise HTTPException(status_code=403, detail="Only billing managers can issue an invoice for a request.")
        request = await _load_request(str(payload["request_id"]), admin)
        if request.get("status") != "pending":
            raise HTTPException(status_code=409, detail="That request has already been processed.")
    doc = await _new_invoice(payload, admin, (request or {}).get("requested_by") or _who(admin))
    if request:  # issuing the invoice is what approves the request
        await get_collection("billing_requests").update_one({"_id": request["_id"]}, {"$set": {
            "status": "approved", "reviewed_by": _who(admin), "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "invoice_id": doc["id"], "invoice_number": doc["invoice_number"]}})
    return {"success": True, "invoice": doc}


async def _new_invoice(payload: Dict[str, Any], admin: dict, owner_email: str) -> Dict[str, Any]:
    coll = get_collection("billing_invoices")
    branch_key = payload.get("branch_key") or "ahmedabad_y"
    invoice_type = payload.get("invoice_type") or "invoice"
    if branch_key not in BRANCHES_MASTER:
        raise HTTPException(status_code=422, detail="Unknown branch.")
    if invoice_type not in ("invoice", "proforma"):
        raise HTTPException(status_code=422, detail="Invoice type must be 'invoice' or 'proforma'.")
    await _require_tax_invoice_access(admin, invoice_type)
    owner = await _owner_fields(owner_email)
    claimed = str(payload.get("sales_person_email") or "").strip().lower()
    if claimed and claimed != owner["sales_person_email"]:
        raise HTTPException(status_code=403, detail="An invoice belongs to the person who creates it; it can't be made out in someone else's name.")
    client = validate_client(payload.get("client"))
    items = validate_items(payload.get("items"))
    today = date.today().isoformat()
    invoice_date = _date(payload.get("invoice_date"), "Invoice date", today)
    due_date = _date(payload.get("due_date"), "Due date", invoice_date)
    if due_date < invoice_date:
        raise HTTPException(status_code=422, detail="The due date cannot be before the invoice date.")
    apply_gst = bool(payload.get("apply_gst", True))

    # Calculate taxes server-side
    calc = calculate_taxes(items, client, apply_gst=apply_gst)
    grand_total = calc["grand_total"]
    paid_amount = _num(payload.get("paid_amount"), "Amount paid")
    if paid_amount < 0 or paid_amount > grand_total + 0.005:
        raise HTTPException(status_code=422, detail="The amount paid must be between zero and the invoice total.")

    # Auto-generate number if not provided; a given number must be unused.
    inv_number = str(payload.get("invoice_number") or "").strip()
    if inv_number:
        if await coll.find_one({"invoice_number": inv_number}):
            raise HTTPException(status_code=409, detail=f"Invoice number {inv_number} already exists.")
    else:
        inv_number = await generate_next_number(branch_key=branch_key, doc_type=invoice_type, reserve=True)

    branch = BRANCHES_MASTER[branch_key]
    invoice_id = str(uuid.uuid4())
    balance_amount = round(max(grand_total - paid_amount, 0.0), 2)
    
    inv_status = "issued"
    if balance_amount == 0 and grand_total > 0:
        inv_status = "paid"
    elif paid_amount > 0:
        inv_status = "partially_paid"
        
    doc = {
        "id": invoice_id,
        "_id": invoice_id,
        "invoice_number": inv_number,
        "invoice_type": invoice_type,
        "branch_key": branch_key,
        "branch": branch,
        "client": client,
        "invoice_date": invoice_date,
        "due_date": due_date,
        "is_reverse_charge": payload.get("is_reverse_charge", False),
        "apply_gst": apply_gst,
        "items": calc["items"],
        "sub_total": calc["sub_total"],
        "discount_total": calc["discount_total"],
        "taxable_amount": calc["taxable_amount"],
        "cgst_rate": calc["cgst_rate"],
        "cgst_amount": calc["cgst_amount"],
        "sgst_rate": calc["sgst_rate"],
        "sgst_amount": calc["sgst_amount"],
        "igst_rate": calc["igst_rate"],
        "igst_amount": calc["igst_amount"],
        "round_off": calc["round_off"],
        "grand_total": grand_total,
        "paid_amount": paid_amount,
        "balance_amount": balance_amount,
        "amount_in_words": calc["amount_in_words"],
        "status": inv_status,
        "notes": payload.get("notes", ""),
        **owner,
        "created_by": admin.get("email") or admin.get("username", "admin"),
        "created_by_user_id": str(admin.get("_id") or admin.get("id") or ""),
        "created_by_name": admin.get("username") or admin.get("email", ""),
        "request_id": payload.get("request_id") or None,
        **await _customer_link(client, admin),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    await coll.insert_one(doc)
    return doc

@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, admin: dict = Depends(get_current_admin)):
    return {"success": True, "invoice": await _invoice_for(invoice_id, admin)}

@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_invoices")
    inv = await _invoice_for(invoice_id, admin)
    await _require_tax_invoice_access(admin, inv.get("invoice_type", "invoice"))

    client = validate_client(payload.get("client", inv.get("client", {})))
    items = validate_items(payload.get("items", inv.get("items", [])))
    # Keep the invoice's own GST choice unless the edit changes it (editing used to add GST to non-GST invoices).
    apply_gst = bool(payload.get("apply_gst", inv.get("apply_gst", True)))
    calc = calculate_taxes(items, client, apply_gst=apply_gst)
    invoice_date = _date(payload.get("invoice_date"), "Invoice date", inv.get("invoice_date") or date.today().isoformat())
    due_date = _date(payload.get("due_date"), "Due date", inv.get("due_date") or invoice_date)
    if due_date < invoice_date:
        raise HTTPException(status_code=422, detail="The due date cannot be before the invoice date.")

    grand_total = calc["grand_total"]
    paid_amount = _num(payload.get("paid_amount", inv.get("paid_amount", 0.0)), "Amount paid")
    if paid_amount < 0:
        raise HTTPException(status_code=422, detail="The amount paid cannot be negative.")
    if paid_amount > grand_total + 0.005:
        raise HTTPException(status_code=422, detail=f"Payments already recorded (₹{paid_amount:,.2f}) exceed the new total.")
    balance_amount = round(max(grand_total - paid_amount, 0.0), 2)
    # Status follows the money; only a cancellation can be set by hand.
    inv_status = "paid" if balance_amount == 0 and grand_total > 0 else "partially_paid" if paid_amount > 0 else "issued"
    if payload.get("status") == "cancelled":
        inv_status = "cancelled"

    update_data = {
        "client": client,
        "items": calc["items"],
        "apply_gst": apply_gst,
        "invoice_date": invoice_date,
        "due_date": due_date,
        "sub_total": calc["sub_total"],
        "discount_total": calc["discount_total"],
        "taxable_amount": calc["taxable_amount"],
        "cgst_rate": calc["cgst_rate"],
        "cgst_amount": calc["cgst_amount"],
        "sgst_rate": calc["sgst_rate"],
        "sgst_amount": calc["sgst_amount"],
        "igst_rate": calc["igst_rate"],
        "igst_amount": calc["igst_amount"],
        "grand_total": grand_total,
        "paid_amount": paid_amount,
        "balance_amount": balance_amount,
        "amount_in_words": calc["amount_in_words"],
        "status": inv_status,
        "notes": payload.get("notes", inv.get("notes", "")),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await coll.update_one({"$or": [{"id": invoice_id}, {"_id": invoice_id}]}, {"$set": update_data})
    updated = await coll.find_one({"$or": [{"id": invoice_id}, {"_id": invoice_id}]})
    return {"success": True, "invoice": updated}

@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_invoices")
    inv = await coll.find_one({"$or": [{"id": invoice_id}, {"_id": invoice_id}]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if float(inv.get("paid_amount") or 0) > 0:
        raise HTTPException(status_code=409, detail="This invoice has payments recorded against it and cannot be deleted. Cancel it instead.")
    await coll.delete_one({"_id": inv["_id"]})
    return {"success": True, "message": "Invoice deleted"}

@router.get("/invoices/{invoice_id}/pdf")
async def get_invoice_pdf_endpoint(
    invoice_id: str,
    download: bool = Query(False),
    admin: dict = Depends(get_current_admin)
):
    inv = await _invoice_for(invoice_id, admin)
    pdf_bytes = generate_invoice_pdf(inv)
    inv_num = re.sub(r"[^A-Za-z0-9_]", "_", str(inv.get("invoice_number") or "invoice"))
    disposition = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disposition}; filename="{inv_num}.pdf"'}
    )

# ---------------------------------------------------------------------------
# Quotations Endpoints
# ---------------------------------------------------------------------------

@router.get("/quotations")
async def list_quotations(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: dict = Depends(get_current_admin)
):
    coll = get_collection("billing_quotations")
    query: Dict[str, Any] = {}
    if status and status != "all":
        query["status"] = status
    if search and search.strip():
        pattern = search_pattern(search)
        query["$or"] = [
            {"quotation_number": {"$regex": pattern, "$options": "i"}},
            {"client.name": {"$regex": pattern, "$options": "i"}},
            {"client.company_name": {"$regex": pattern, "$options": "i"}},
        ]
    if not await _sees_all(admin):
        query = {"$and": [query, {"created_by": _who(admin)}]}
    total = await coll.count_documents(query)
    skip = (page - 1) * limit
    items = await coll.find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"success": True, "items": items, "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit if total > 0 else 1}


def _quotation_money(calc: Dict[str, Any]) -> Dict[str, Any]:
    """Every amount field a quotation stores (updates used to leave the tax breakdown stale)."""
    keys = ("sub_total", "discount_total", "taxable_amount", "cgst_rate", "cgst_amount", "sgst_rate", "sgst_amount",
            "igst_rate", "igst_amount", "grand_total", "amount_in_words")
    return {k: calc[k] for k in keys}

@router.post("/quotations", status_code=status.HTTP_201_CREATED)
async def create_quotation(payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_quotations")
    branch_key = payload.get("branch_key") or "ahmedabad_y"
    if branch_key not in BRANCHES_MASTER:
        raise HTTPException(status_code=422, detail="Unknown branch.")
    client = validate_client(payload.get("client"))
    items = validate_items(payload.get("items"))
    today = date.today().isoformat()
    quotation_date = _date(payload.get("quotation_date"), "Quotation date", today)
    valid_until = _date(payload.get("valid_until"), "Valid-until date", quotation_date)
    if valid_until < quotation_date:
        raise HTTPException(status_code=422, detail="'Valid until' cannot be before the quotation date.")
    status_value = payload.get("status") or "draft"
    if status_value not in QUOTATION_STATUSES - {"converted"}:
        raise HTTPException(status_code=422, detail="Unknown quotation status.")
    apply_gst = bool(payload.get("apply_gst", True))
    calc = calculate_taxes(items, client, apply_gst=apply_gst)

    qt_num = str(payload.get("quotation_number") or "").strip()
    if qt_num:
        if await coll.find_one({"quotation_number": qt_num}):
            raise HTTPException(status_code=409, detail=f"Quotation number {qt_num} already exists.")
    else:
        qt_num = await generate_next_number(doc_type="quotation", reserve=True)
    branch = BRANCHES_MASTER[branch_key]

    qid = str(uuid.uuid4())
    doc = {
        "id": qid,
        "_id": qid,
        "quotation_number": qt_num,
        "branch_key": branch_key,
        "branch": branch,
        "client": client,
        "quotation_date": quotation_date,
        "valid_until": valid_until,
        "apply_gst": apply_gst,
        "items": calc["items"],
        **_quotation_money(calc),
        "status": status_value,
        "notes": payload.get("notes", ""),
        "created_by": admin.get("email") or admin.get("username", "admin"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await coll.insert_one(doc)
    return {"success": True, "quotation": doc}

async def _quotation_for(quotation_id: str, admin: dict) -> Dict[str, Any]:
    qt = await get_collection("billing_quotations").find_one({"$or": [{"id": quotation_id}, {"_id": quotation_id}]})
    if not qt:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if not await _sees_all(admin) and qt.get("created_by") != _who(admin):
        raise HTTPException(status_code=403, detail="You can only open your own quotations.")
    return qt

@router.get("/quotations/{quotation_id}")
async def get_quotation(quotation_id: str, admin: dict = Depends(get_current_admin)):
    return {"success": True, "quotation": await _quotation_for(quotation_id, admin)}

@router.put("/quotations/{quotation_id}")
async def update_quotation(quotation_id: str, payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_quotations")
    qt = await _quotation_for(quotation_id, admin)
    if qt.get("status") == "converted":
        raise HTTPException(status_code=409, detail=f"This quotation was already converted to invoice {qt.get('converted_invoice')}.")
    client = validate_client(payload.get("client", qt.get("client", {})))
    items = validate_items(payload.get("items", qt.get("items", [])))
    apply_gst = bool(payload.get("apply_gst", qt.get("apply_gst", True)))
    calc = calculate_taxes(items, client, apply_gst=apply_gst)
    quotation_date = _date(payload.get("quotation_date"), "Quotation date", qt.get("quotation_date") or date.today().isoformat())
    valid_until = _date(payload.get("valid_until"), "Valid-until date", qt.get("valid_until") or quotation_date)
    status_value = payload.get("status", qt.get("status", "draft"))
    if status_value not in QUOTATION_STATUSES - {"converted"}:
        raise HTTPException(status_code=422, detail="Unknown quotation status.")
    update_data = {
        "client": client,
        "items": calc["items"],
        "apply_gst": apply_gst,
        "quotation_date": quotation_date,
        "valid_until": valid_until,
        **_quotation_money(calc),
        "status": status_value,
        "notes": payload.get("notes", qt.get("notes", "")),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await coll.update_one({"$or": [{"id": quotation_id}, {"_id": quotation_id}]}, {"$set": update_data})
    updated = await coll.find_one({"$or": [{"id": quotation_id}, {"_id": quotation_id}]})
    return {"success": True, "quotation": updated}

@router.delete("/quotations/{quotation_id}")
async def delete_quotation(quotation_id: str, admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_quotations")
    res = await coll.delete_one({"$or": [{"id": quotation_id}, {"_id": quotation_id}]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return {"success": True, "message": "Quotation deleted"}

@router.get("/quotations/{quotation_id}/pdf")
async def get_quotation_pdf_endpoint(quotation_id: str, download: bool = Query(False), admin: dict = Depends(get_current_admin)):
    qt = await _quotation_for(quotation_id, admin)
    inv_data = {**qt, "invoice_number": qt.get("quotation_number"), "invoice_type": "proforma", "invoice_date": qt.get("quotation_date"), "due_date": qt.get("valid_until")}
    pdf_bytes = generate_invoice_pdf(inv_data)
    disposition = "attachment" if download else "inline"
    qt_num = re.sub(r"[^A-Za-z0-9_]", "_", str(qt.get("quotation_number") or "quote"))
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f'{disposition}; filename="{qt_num}.pdf"'})

@router.post("/quotations/{quotation_id}/convert")
async def convert_quotation_to_invoice(quotation_id: str, admin: dict = Depends(get_current_admin)):
    coll_q = get_collection("billing_quotations")
    qt = await _quotation_for(quotation_id, admin)
    if qt.get("status") == "converted":
        # Converting twice used to create a duplicate invoice.
        raise HTTPException(status_code=409, detail=f"This quotation was already converted to invoice {qt.get('converted_invoice')}.")

    # Create invoice from quotation (create_invoice reserves the next number for the branch)
    branch_key = qt.get("branch_key", "ahmedabad_y")
    inv_payload = {
        "invoice_type": "invoice",
        "branch_key": branch_key,
        "client": qt.get("client", {}),
        "items": qt.get("items", []),
        "apply_gst": qt.get("apply_gst", True),
        "invoice_date": date.today().isoformat(),
        "due_date": (date.today() + timedelta(days=15)).isoformat(),  # the invoice terms give 15 days
        "notes": f"Converted from Quotation {qt.get('quotation_number')}. {qt.get('notes', '')}".strip(),
    }
    invoice = await _new_invoice(inv_payload, admin, qt.get("created_by") or _who(admin))  # stays with whoever quoted
    inv_num = invoice["invoice_number"]
    await coll_q.update_one({"_id": qt["_id"]}, {"$set": {"status": "converted", "converted_invoice": inv_num}})
    return {"success": True, "invoice": invoice, "message": f"Quotation converted to Tax Invoice {inv_num}"}

# ---------------------------------------------------------------------------
# Clients & Products Endpoints
# ---------------------------------------------------------------------------

@router.get("/clients")
async def list_clients(search: Optional[str] = Query(None), admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_clients")
    query = {}
    if search and search.strip():
        pattern = search_pattern(search)
        query["$or"] = [{"name": {"$regex": pattern, "$options": "i"}},
                        {"company_name": {"$regex": pattern, "$options": "i"}},
                        {"gstin": {"$regex": pattern, "$options": "i"}}]
    if not await _sees_all(admin):
        query["owner_email"] = _me(admin)
    clients = await coll.find(query).sort("name", 1).to_list(5000)
    # Starter clients only for a brand-new, empty directory (a search with no hits used to re-add them every time).
    if not clients and not query and await coll.count_documents({}) == 0:
        # Seed default clients
        default_clients = [
            {"id": "cl-1", "name": "Apex Global Solutions Pvt Ltd", "company_name": "Apex Global Solutions Pvt Ltd", "email": "billing@apexglobal.com", "phone": "9876543210", "address": "402, Pinnacle Business Park, Prahlad Nagar, Ahmedabad, Gujarat 380015", "gstin": "24ABCDE1234F1Z5", "state": "Gujarat", "state_code": "24", "contact_person": "Rahul Sharma", "outstanding_balance": 0.0},
            {"id": "cl-2", "name": "Zenith Tech Enterprises", "company_name": "Zenith Tech Enterprises", "email": "finance@zenithtech.in", "phone": "9812345678", "address": "12th Floor, World Trade Center, Cuffe Parade, Mumbai, Maharashtra 400005", "gstin": "27AAACZ1234A1Z9", "state": "Maharashtra", "state_code": "27", "contact_person": "Pooja Verma", "outstanding_balance": 0.0},
        ]
        for c in default_clients:
            await coll.insert_one({**c, "_id": c["id"]})
        clients = default_clients
    return {"success": True, "items": clients}


_CLIENT_FIELDS = ("name", "company_name", "email", "phone", "address", "gstin", "state", "state_code", "contact_person")


def _phone(value: Any, label: str = "Phone number") -> str:
    try:
        return optional_phone(value, label)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _clean_client(payload: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    merged = {**(existing or {}), **{k: v for k, v in payload.items() if k in _CLIENT_FIELDS}}
    merged["name"] = str(merged.get("name") or merged.get("company_name") or "").strip()
    merged["company_name"] = str(merged.get("company_name") or merged["name"]).strip()
    if not merged["name"]:
        raise HTTPException(status_code=422, detail="Enter the client name.")
    email = str(merged.get("email") or "").strip()
    if email and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    validate_client(merged)
    merged["phone"] = _phone(merged.get("phone"))
    gstin = str(merged.get("gstin") or "").strip().upper()
    merged["gstin"] = gstin
    if gstin:
        merged["state_code"] = gstin[:2]  # the GSTIN's first two digits are the state code
    return {k: merged.get(k, "") for k in _CLIENT_FIELDS}


@router.post("/clients", status_code=status.HTTP_201_CREATED)
async def create_client(payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_clients")
    fields = _clean_client({"state": "Gujarat", "state_code": "24", **payload})
    cid = str(uuid.uuid4())
    doc = {
        "id": cid,
        "_id": cid,
        **fields,
        "outstanding_balance": 0.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await coll.insert_one(doc)
    return {"success": True, "client": doc}

@router.post("/clients/from-lead/{lead_id}", status_code=status.HTTP_201_CREATED)
async def create_client_from_lead(lead_id: str, payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    """Converts a lead into a customer, starting from the lead's own details (the form may correct them).
    A sales person can convert only leads assigned to them (or ones they created that nobody else has)."""
    leads = get_collection("sales_leads")
    lead = await leads.find_one({"_id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    assigned = lead.get("assigned_to") or {}
    me_id = str(admin.get("_id") or admin.get("id") or "")
    manager = "sales.hub.manage" in await get_user_permissions(admin) or await _sees_all(admin)
    own = assigned.get("user_id") == me_id or (not assigned and str(lead.get("created_by") or "").lower() == _me(admin))
    if not (manager or own):
        raise HTTPException(status_code=403, detail="You can only convert your own leads.")
    if lead.get("customer_id"):
        raise HTTPException(status_code=409, detail="This lead is already a customer.")
    from_lead = {"name": lead.get("company") or lead.get("name"), "company_name": lead.get("company") or lead.get("name"),
                 "contact_person": lead.get("name"), "phone": lead.get("phone"), "email": lead.get("email"),
                 "address": lead.get("address") or lead.get("city"), "gstin": lead.get("gstin"),
                 "state": lead.get("state") or "Gujarat"}
    # Place of supply: a GSTIN sets the state code itself; otherwise only Gujarat is known to be 24.
    from_lead["state_code"] = "24" if str(from_lead["state"]).strip().lower() == "gujarat" else ""
    fields = _clean_client({**{k: v for k, v in from_lead.items() if v}, **{k: v for k, v in payload.items() if v not in (None, "")}})
    coll = get_collection("billing_clients")
    for key, label in (("gstin", "GSTIN"), ("email", "email"), ("phone", "phone number")):
        if fields.get(key) and await coll.find_one({key: fields[key]}):
            raise HTTPException(status_code=409, detail=f"A customer with this {label} already exists.")
    owner = str(assigned.get("email") or lead.get("created_by") or _who(admin)).strip().lower()
    cid = str(uuid.uuid4())
    doc = {"id": cid, "_id": cid, **fields, "outstanding_balance": 0.0, "lead_id": lead_id, "owner_email": owner,
           "owner_name": assigned.get("name") or owner, "created_by": _who(admin),
           "created_at": datetime.now(timezone.utc).isoformat()}
    await coll.insert_one(doc)
    await leads.update_one({"_id": lead_id}, {"$set": {"status": "CONVERTED", "customer_id": cid,
                                                       "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"success": True, "client": doc}

@router.get("/clients/{client_id}")
async def get_client(client_id: str, admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_clients")
    cl = await coll.find_one({"$or": [{"id": client_id}, {"_id": client_id}]})
    if not cl:
        raise HTTPException(status_code=404, detail="Client not found")
    if not await _sees_all(admin) and str(cl.get("owner_email") or "").lower() != _me(admin):
        raise HTTPException(status_code=403, detail="You can only open your own customers.")
    return {"success": True, "client": cl}

@router.put("/clients/{client_id}")
async def update_client(client_id: str, payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_clients")
    existing = await coll.find_one({"$or": [{"id": client_id}, {"_id": client_id}]})
    if not existing:
        raise HTTPException(status_code=404, detail="Client not found")
    # Only known fields: a payload carrying "id"/"_id" used to overwrite the id and orphan the record.
    fields = _clean_client(payload, existing)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await coll.update_one({"_id": existing["_id"]}, {"$set": fields})
    updated = await coll.find_one({"_id": existing["_id"]})
    return {"success": True, "client": updated}

@router.delete("/clients/{client_id}")
async def delete_client(client_id: str, admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_clients")
    res = await coll.delete_one({"$or": [{"id": client_id}, {"_id": client_id}]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"success": True, "message": "Client deleted"}

@router.get("/products")
async def list_products(admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_products")
    prods = await coll.find().to_list(500)
    if not prods:
        default_prods = [
            {"id": "prd-1", "name": "Financial Advisory Services", "sku": "SRV-FIN-01", "hsn_sac": "997159", "description": "Corporate financial consulting and compliance advisory", "unit": "NOS", "unit_price": 25000.0, "default_gst_rate": 18.0},
            {"id": "prd-2", "name": "Audit & Compliance Review", "sku": "SRV-AUD-02", "hsn_sac": "998222", "description": "Statutory audit and accounting records verification", "unit": "NOS", "unit_price": 50000.0, "default_gst_rate": 18.0},
            {"id": "prd-3", "name": "Tax Assessment & Return Filing", "sku": "SRV-TAX-03", "hsn_sac": "998231", "description": "Direct and indirect tax assessment and filing", "unit": "NOS", "unit_price": 15000.0, "default_gst_rate": 18.0},
        ]
        for p in default_prods:
            await coll.insert_one({**p, "_id": p["id"]})
        prods = default_prods
    return {"success": True, "items": prods}


_PRODUCT_FIELDS = ("name", "sku", "hsn_sac", "description", "unit", "unit_price", "default_gst_rate")


def _clean_product(payload: Dict[str, Any], existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    merged = {**(existing or {}), **{k: v for k, v in payload.items() if k in _PRODUCT_FIELDS}}
    if not str(merged.get("name") or "").strip():
        raise HTTPException(status_code=422, detail="Enter the product or service name.")
    price = _num(merged.get("unit_price"), "Unit price")
    rate = _num(merged.get("default_gst_rate"), "GST rate", 18.0)
    if price < 0:
        raise HTTPException(status_code=422, detail="The unit price cannot be negative.")
    if rate not in GST_RATES:
        raise HTTPException(status_code=422, detail=f"{rate:g}% is not a GST rate.")
    out = {k: merged.get(k, "") for k in _PRODUCT_FIELDS}
    out.update({"name": str(merged["name"]).strip(), "unit_price": price, "default_gst_rate": rate,
                "unit": merged.get("unit") or "NOS"})
    return out


@router.post("/products", status_code=status.HTTP_201_CREATED)
async def create_product(payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_products")
    pid = str(uuid.uuid4())
    doc = {"id": pid, "_id": pid, **_clean_product(payload), "created_at": datetime.now(timezone.utc).isoformat()}
    await coll.insert_one(doc)
    return {"success": True, "product": doc}

@router.get("/products/{product_id}")
async def get_product(product_id: str, admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_products")
    p = await coll.find_one({"$or": [{"id": product_id}, {"_id": product_id}]})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"success": True, "product": p}

@router.put("/products/{product_id}")
async def update_product(product_id: str, payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_products")
    existing = await coll.find_one({"$or": [{"id": product_id}, {"_id": product_id}]})
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    fields = _clean_product(payload, existing)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await coll.update_one({"_id": existing["_id"]}, {"$set": fields})
    updated = await coll.find_one({"_id": existing["_id"]})
    return {"success": True, "product": updated}

@router.delete("/products/{product_id}")
async def delete_product(product_id: str, admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_products")
    res = await coll.delete_one({"$or": [{"id": product_id}, {"_id": product_id}]})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"success": True, "message": "Product deleted"}

# ---------------------------------------------------------------------------
# Payments & Metrics Endpoints
# ---------------------------------------------------------------------------

@router.get("/payments")
async def list_payments(admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_payments")
    query: Dict[str, Any] = {}
    if not await _sees_all(admin):
        mine = await get_collection("billing_invoices").find(await _scoped({}, admin)).to_list(20000)
        query = {"invoice_id": {"$in": [i["id"] for i in mine if i.get("id")]}}
    payments = await coll.find(query).sort("payment_date", -1).to_list(500)
    return {"success": True, "items": payments}


@router.get("/deals")
async def list_deals(admin: dict = Depends(get_current_admin)):
    """Each invoice is a deal. What was collected is summed from the payment records, not taken from a status,
    so a deal is fully collected only when the recorded payments reach its value."""
    invoices = [i for i in await get_collection("billing_invoices").find(await _scoped({}, admin)).sort("created_at", -1).to_list(20000)
                if i.get("status") != "cancelled" and i.get("id")]
    paid: Dict[str, float] = {}
    counts: Dict[str, int] = {}
    ids = [i["id"] for i in invoices]
    for p in await get_collection("billing_payments").find({"invoice_id": {"$in": ids}}).to_list(200000) if ids else []:
        paid[p["invoice_id"]] = paid.get(p["invoice_id"], 0.0) + float(p.get("amount") or 0)
        counts[p["invoice_id"]] = counts.get(p["invoice_id"], 0) + 1
    rows = []
    for i in invoices:
        value, got = round(float(i.get("grand_total") or 0), 2), round(paid.get(i["id"], 0.0), 2)
        state = "fully_collected" if value > 0 and got >= value - 0.005 else "partly_collected" if got > 0 else "not_collected"
        rows.append({"id": i["id"], "invoice_number": i.get("invoice_number"), "invoice_type": i.get("invoice_type"),
                     "invoice_date": i.get("invoice_date"), "client_name": (i.get("client") or {}).get("name", ""),
                     "customer_id": i.get("customer_id"), "lead_id": i.get("lead_id"),
                     "owner_name": i.get("owner_name") or i.get("sales_person_name") or i.get("created_by", ""),
                     "value": value, "collected": got, "balance": round(max(value - got, 0.0), 2),
                     "payments": counts.get(i["id"], 0), "collection_status": state})
    summary = {s: sum(1 for r in rows if r["collection_status"] == s) for s in ("fully_collected", "partly_collected", "not_collected")}
    summary.update(value=round(sum(r["value"] for r in rows), 2), collected=round(sum(r["collected"] for r in rows), 2))
    return {"success": True, "items": rows, "summary": summary}

@router.post("/payments", status_code=status.HTTP_201_CREATED)
async def record_payment(payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    coll_p = get_collection("billing_payments")
    coll_i = get_collection("billing_invoices")
    
    invoice_id = payload.get("invoice_id")
    amount = round(_num(payload.get("amount"), "Amount"), 2)
    inv = await coll_i.find_one({"$or": [{"id": invoice_id}, {"_id": invoice_id}, {"invoice_number": invoice_id}]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.get("status") == "cancelled":
        raise HTTPException(status_code=409, detail="Payments cannot be recorded against a cancelled invoice.")

    curr_paid = float(inv.get("paid_amount", 0.0))
    grand_total = float(inv.get("grand_total", 0.0))
    outstanding = round(max(grand_total - curr_paid, 0.0), 2)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="The payment amount must be more than zero.")
    if amount > outstanding + 0.005:
        raise HTTPException(status_code=422, detail=f"The payment is more than the balance due (₹{outstanding:,.2f}).")
    payment_date = _date(payload.get("payment_date"), "Payment date", date.today().isoformat())
    # DSC is taken at today's configured amount and stored on the payment, so changing the setting later
    # never rewrites payments already recorded. The sales scorecard and incentive use amount - DSC.
    dsc_deducted = bool(payload.get("dsc_deducted"))
    dsc_amount = float((await sales_payroll.get_config())["dsc_amount"]) if dsc_deducted else 0.0
    if dsc_amount > amount:
        raise HTTPException(status_code=422, detail=f"The DSC deduction (₹{dsc_amount:,.2f}) is more than this payment.")
    new_paid = round(curr_paid + amount, 2)
    new_balance = round(max(grand_total - new_paid, 0.0), 2)

    new_status = "paid" if new_balance == 0 else "partially_paid"
    
    pay_id = str(uuid.uuid4())
    doc = {
        "id": pay_id,
        "_id": pay_id,
        "invoice_id": inv.get("id"),
        "invoice_number": inv.get("invoice_number"),
        "client_name": inv.get("client", {}).get("name", ""),
        "client_id": inv.get("client", {}).get("id") or inv.get("client_id", ""),
        "amount": amount,  # gross collection
        "dsc_deducted": dsc_deducted,
        "dsc_amount": round(dsc_amount, 2),
        "net_amount": round(amount - dsc_amount, 2),
        "sales_person_email": inv.get("sales_person_email", ""),
        "sales_person_name": inv.get("sales_person_name", ""),
        "payment_method": payload.get("payment_method", "NEFT/RTGS"),
        "reference_number": payload.get("reference_number", ""),
        "payment_date": payment_date,
        "notes": payload.get("notes", ""),
        "recorded_by": admin.get("email") or admin.get("username", "admin"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await coll_p.insert_one(doc)
    await AuditService.log_action(user_email=doc["recorded_by"], user_role=admin.get("role", ""), action="Recorded payment",
                                  entity_type="billing_payment", entity_id=pay_id,
                                  new_value={k: doc[k] for k in ("invoice_number", "amount", "dsc_amount", "net_amount",
                                                                 "payment_date", "sales_person_email")})
    await coll_i.update_one(
        {"_id": inv["_id"]},
        {"$set": {"paid_amount": new_paid, "balance_amount": new_balance, "status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"success": True, "payment": doc}

@router.get("/dashboard/metrics")
async def get_billing_dashboard_metrics(admin: dict = Depends(get_current_admin)):
    coll_i = get_collection("billing_invoices")
    coll_q = get_collection("billing_quotations")
    coll_c = get_collection("billing_clients")
    
    everything = await _sees_all(admin)
    all_invoices = await coll_i.find(await _scoped({}, admin)).to_list(50000)
    quotations_count = await coll_q.count_documents({} if everything else {"created_by": _who(admin)})
    clients_count = await coll_c.count_documents({} if everything else {"owner_email": _me(admin)})
    # Revenue = tax invoices only: proformas are not invoices and cancelled ones don't count.
    invoices = [i for i in all_invoices if i.get("invoice_type", "invoice") == "invoice" and i.get("status") != "cancelled"]

    total_invoiced = sum(float(i.get("grand_total", 0)) for i in invoices)
    total_paid = sum(float(i.get("paid_amount", 0)) for i in invoices)
    total_outstanding = sum(float(i.get("balance_amount", 0)) for i in invoices)
    
    paid_count = sum(1 for i in invoices if i.get("status") == "paid")
    unpaid_count = sum(1 for i in invoices if i.get("status") in ("issued", "overdue"))
    partial_count = sum(1 for i in invoices if i.get("status") == "partially_paid")
    
    return {
        "success": True,
        "metrics": {
            "total_invoiced": total_invoiced,
            "total_collected": total_paid,
            "total_outstanding": total_outstanding,
            "invoices_count": len(invoices),
            "paid_count": paid_count,
            "unpaid_count": unpaid_count,
            "partial_count": partial_count,
            "quotations_count": quotations_count,
            "clients_count": clients_count,
        }
    }

@router.get("/reports/gstr1")
async def get_gstr1_report(admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_invoices")
    invoices = [i for i in await coll.find({"invoice_type": "invoice"}).to_list(50000) if i.get("status") != "cancelled"]
    b2b = [i for i in invoices if i.get("client", {}).get("gstin")]
    b2c = [i for i in invoices if not i.get("client", {}).get("gstin")]
    
    total_taxable = sum(float(i.get("taxable_amount", 0)) for i in invoices)
    total_cgst = sum(float(i.get("cgst_amount", 0)) for i in invoices)
    total_sgst = sum(float(i.get("sgst_amount", 0)) for i in invoices)
    total_igst = sum(float(i.get("igst_amount", 0)) for i in invoices)
    
    return {
        "success": True,
        "summary": {
            "total_taxable_amount": total_taxable,
            "total_cgst": total_cgst,
            "total_sgst": total_sgst,
            "total_igst": total_igst,
            "total_tax": total_cgst + total_sgst + total_igst,
            "b2b_invoices_count": len(b2b),
            "b2c_invoices_count": len(b2c),
        },
        "b2b_invoices": b2b,
        "b2c_invoices": b2c
    }

@router.get("/reports/aging")
async def get_aging_report(admin: dict = Depends(get_current_admin)):
    coll = get_collection("billing_invoices")
    unpaid = [i for i in await coll.find({"balance_amount": {"$gt": 0}}).to_list(10000) if i.get("status") != "cancelled"]
    today = date.today().isoformat()
    buckets = {"current": 0.0, "1_30": 0.0, "31_60": 0.0, "61_90": 0.0, "over_90": 0.0}
    for inv in unpaid:
        due = str(inv.get("due_date") or inv.get("invoice_date") or today)[:10]
        try:
            days = (date.today() - date.fromisoformat(due)).days
        except ValueError:
            days = 0
        inv["days_overdue"] = max(days, 0)
        key = "current" if days <= 0 else "1_30" if days <= 30 else "31_60" if days <= 60 else "61_90" if days <= 90 else "over_90"
        buckets[key] += float(inv.get("balance_amount", 0))
    total_outstanding = sum(float(i.get("balance_amount", 0)) for i in unpaid)
    return {
        "success": True,
        "unpaid_invoices": unpaid,
        # Only what is past its due date is overdue (this used to report every unpaid rupee as overdue).
        "total_overdue": round(total_outstanding - buckets["current"], 2),
        "total_outstanding": round(total_outstanding, 2),
        "buckets": {k: round(v, 2) for k, v in buckets.items()},
    }

# ---------------------------------------------------------------------------
# Invoice requests, documents, payment reversal, exports & monthly summary
# (features carried over from the standalone Bill-Invoice module)
# ---------------------------------------------------------------------------

async def _can_manage_billing(admin: dict) -> bool:
    return "billing.manage" in await get_user_permissions(admin)

def _who(admin: dict) -> str:
    return admin.get("email") or admin.get("username", "admin")

def _csv_response(filename: str, header: List[str], rows: List[List[Any]]) -> Response:
    def cell(v: Any) -> Any:
        # Neutralise spreadsheet formulas in user-supplied text.
        return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows([[cell(v) for v in r] for r in rows])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

# ---- Invoice requests: a billing user asks a manager to issue a tax invoice ----

def _clean_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    name = str(payload.get("billing_name") or "").strip()
    address = str(payload.get("billing_address") or "").strip()
    if not name or not address:
        raise HTTPException(status_code=422, detail="Enter the client name and address.")
    gstin = str(payload.get("client_gstin") or "").strip().upper()
    if gstin and not GSTIN_RE.match(gstin):
        raise HTTPException(status_code=422, detail="The client GSTIN is not valid.")
    branch_key = payload.get("branch_key") or "ahmedabad_y"
    if branch_key not in BRANCHES_MASTER:
        raise HTTPException(status_code=422, detail="Choose a valid branch.")
    raw_items = payload.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(status_code=422, detail="Add at least one item.")
    items = []
    for n, it in enumerate(raw_items, 1):
        it = it if isinstance(it, dict) else {}
        particulars = str(it.get("particulars") or "").strip()
        qty = _num(it.get("quantity"), f"Item {n} quantity")
        rate = _num(it.get("rate"), f"Item {n} rate")
        if not particulars or qty <= 0 or rate < 0:
            raise HTTPException(status_code=422, detail=f"Complete item {n}.")
        items.append({"particulars": particulars[:500], "quantity": qty, "rate": rate})
    return {
        "billing_name": name[:255], "billing_address": address[:1000],
        "billing_phone": _phone(payload.get("billing_phone"), "Phone"),
        "client_gstin": gstin, "client_state": str(payload.get("client_state") or "").strip()[:100],
        "branch_key": branch_key, "remark": str(payload.get("remark") or "").strip()[:1000],
        "items": items, "estimated_total": round(sum(i["quantity"] * i["rate"] for i in items), 2),
    }

async def _load_request(request_id: str, admin: dict) -> Dict[str, Any]:
    r = await get_collection("billing_requests").find_one({"$or": [{"id": request_id}, {"_id": request_id}]})
    if not r or not (r.get("requested_by") == _who(admin) or await _can_manage_billing(admin)):
        raise HTTPException(status_code=404, detail="Request not found")
    return r

@router.get("/requests")
async def list_requests(status: Optional[str] = Query(None), admin: dict = Depends(get_current_admin)):
    query: Dict[str, Any] = {}
    if not await _can_manage_billing(admin):
        query["requested_by"] = _who(admin)
    if status and status != "all":
        query["status"] = status
    items = await get_collection("billing_requests").find(query).sort("created_at", -1).to_list(500)
    return {"success": True, "items": items}

@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    counters = get_collection("billing_counters")
    seq = ((await counters.find_one({"key": "REQUEST"})) or {}).get("sequence_value", 0) + 1
    await counters.update_one({"key": "REQUEST"}, {"$set": {"key": "REQUEST", "sequence_value": seq}}, upsert=True)
    rid = str(uuid.uuid4())
    is_sales = has_role(admin, "sales")
    doc = {**_clean_request(payload), "id": rid, "_id": rid, "sales_person_email": _who(admin).lower() if is_sales else "", "request_number": f"REQ-{seq:04d}", "status": "pending",
           "requested_by": _who(admin), "requested_by_name": admin.get("name") or _who(admin),
           "created_at": datetime.now(timezone.utc).isoformat()}
    await get_collection("billing_requests").insert_one(doc)
    return {"success": True, "request": doc}

@router.get("/requests/{request_id}")
async def get_request(request_id: str, admin: dict = Depends(get_current_admin)):
    return {"success": True, "request": await _load_request(request_id, admin)}

async def _close_request(request_id: str, admin: dict, new_status: str, extra: Dict[str, Any]) -> Dict[str, Any]:
    r = await _load_request(request_id, admin)
    if r.get("status") != "pending":
        raise HTTPException(status_code=409, detail="That request has already been processed.")
    coll = get_collection("billing_requests")
    await coll.update_one({"_id": r["_id"]}, {"$set": {"status": new_status, "reviewed_by": _who(admin),
                                                       "reviewed_at": datetime.now(timezone.utc).isoformat(), **extra}})
    return await coll.find_one({"_id": r["_id"]})

@router.post("/requests/{request_id}/approve")
async def approve_request(request_id: str, payload: Dict[str, Any], admin: dict = Depends(get_current_admin)):
    """Marks a request approved once the invoice made from it exists."""
    inv_id = payload.get("invoice_id")
    inv = await get_collection("billing_invoices").find_one({"$or": [{"id": inv_id}, {"_id": inv_id}]})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    req = await _close_request(request_id, admin, "approved", {"invoice_id": inv.get("id"), "invoice_number": inv.get("invoice_number")})
    return {"success": True, "request": req}

@router.post("/requests/{request_id}/reject")
async def reject_request(request_id: str, admin: dict = Depends(get_current_admin)):
    return {"success": True, "request": await _close_request(request_id, admin, "rejected", {})}

# ---- Shared documents (rate cards, brochures, templates) ----

MAX_DOC_BYTES = 5 * 1024 * 1024

def _doc_view(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: d.get(k) for k in ("id", "filename", "content_type", "size", "uploaded_by", "created_at")}

@router.get("/documents")
async def list_documents(admin: dict = Depends(get_current_admin)):
    docs = await get_collection("billing_documents").find({}).sort("created_at", -1).to_list(500)
    return {"success": True, "items": [_doc_view(d) for d in docs]}

@router.post("/documents", status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile = File(...), admin: dict = Depends(get_current_admin)):
    data = await file.read(MAX_DOC_BYTES + 1)
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail=f"Files can be at most {MAX_DOC_BYTES // (1024 * 1024)} MB.")
    if not data:
        raise HTTPException(status_code=422, detail="The file is empty.")
    doc_id = str(uuid.uuid4())
    name = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1][:255] or "file"
    doc = {"id": doc_id, "_id": doc_id, "filename": name, "content_type": (file.content_type or "application/octet-stream")[:120],
           "size": len(data), "uploaded_by": _who(admin), "created_at": datetime.now(timezone.utc).isoformat()}
    await get_collection("billing_document_files").insert_one({"_id": doc_id, "data_b64": base64.b64encode(data).decode("ascii")})
    await get_collection("billing_documents").insert_one(doc)
    return {"success": True, "document": _doc_view(doc)}

@router.get("/documents/{document_id}/download")
async def download_document(document_id: str, admin: dict = Depends(get_current_admin)):
    d = await get_collection("billing_documents").find_one({"_id": document_id})
    f = await get_collection("billing_document_files").find_one({"_id": document_id})
    if not d or not f:
        raise HTTPException(status_code=404, detail="Document not found")
    safe = re.sub(r'[^A-Za-z0-9._ -]', "_", d["filename"])
    # Always a download, never rendered inline, so an uploaded HTML/SVG file cannot run script.
    return Response(content=base64.b64decode(f["data_b64"]), media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{safe}"', "X-Content-Type-Options": "nosniff"})

@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, admin: dict = Depends(get_current_admin)):
    res = await get_collection("billing_documents").delete_one({"_id": document_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Document not found")
    await get_collection("billing_document_files").delete_one({"_id": document_id})
    return {"success": True, "message": "Document deleted"}

# ---- Payment reversal ----

@router.delete("/payments/{payment_id}")
async def delete_payment(payment_id: str, admin: dict = Depends(get_current_admin)):
    """Removes a wrongly recorded payment and puts its amount back on the invoice balance."""
    coll_p = get_collection("billing_payments")
    coll_i = get_collection("billing_invoices")
    pay = await coll_p.find_one({"$or": [{"id": payment_id}, {"_id": payment_id}]})
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")
    inv = await coll_i.find_one({"$or": [{"id": pay.get("invoice_id")}, {"_id": pay.get("invoice_id")}]})
    if inv:
        grand = float(inv.get("grand_total", 0))
        paid = round(max(float(inv.get("paid_amount", 0)) - float(pay.get("amount", 0)), 0.0), 2)
        new_status = inv.get("status") if inv.get("status") == "cancelled" else "paid" if paid >= grand > 0 else "partially_paid" if paid > 0 else "issued"
        await coll_i.update_one({"_id": inv["_id"]}, {"$set": {"paid_amount": paid, "balance_amount": round(max(grand - paid, 0.0), 2),
                                                              "status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await coll_p.delete_one({"_id": pay["_id"]})
    # The scorecard and any payroll not yet finalized drop it; a finalized payroll keeps its incentive until
    # it is unlocked and recalculated.
    await AuditService.log_action(user_email=admin.get("email") or admin.get("username", "admin"), user_role=admin.get("role", ""),
                                  action="Removed payment", entity_type="billing_payment", entity_id=str(pay["_id"]),
                                  old_value={k: pay.get(k) for k in ("invoice_number", "amount", "dsc_amount", "payment_date",
                                                                     "sales_person_email")})
    return {"success": True, "message": "Payment removed"}

# ---- Exports & monthly summary ----

@router.get("/export/invoices.csv")
async def export_invoices_csv(admin: dict = Depends(get_current_admin)):
    invs = await get_collection("billing_invoices").find(await _scoped({}, admin)).sort("invoice_date", -1).to_list(50000)
    rows = [[i.get("invoice_number"), i.get("invoice_type"), i.get("invoice_date"), i.get("due_date"), i.get("branch_key"),
             (i.get("client") or {}).get("name"), (i.get("client") or {}).get("gstin"), i.get("taxable_amount"),
             i.get("cgst_amount"), i.get("sgst_amount"), i.get("igst_amount"), i.get("grand_total"),
             i.get("paid_amount"), i.get("balance_amount"), i.get("status")] for i in invs]
    return _csv_response("invoices.csv", ["Invoice #", "Type", "Date", "Due date", "Branch", "Client", "GSTIN", "Taxable",
                                          "CGST", "SGST", "IGST", "Total", "Paid", "Balance", "Status"], rows)

@router.get("/reports/gst-register.csv")
async def gst_register_csv(month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"), admin: dict = Depends(get_current_admin)):
    invs = [i for i in await get_collection("billing_invoices").find({"invoice_type": "invoice"}).sort("invoice_date", 1).to_list(50000)
            if i.get("status") != "cancelled" and (not month or str(i.get("invoice_date", ""))[:7] == month)]
    rows = [[i.get("invoice_date"), i.get("invoice_number"), (i.get("client") or {}).get("name"), (i.get("client") or {}).get("gstin"),
             (i.get("client") or {}).get("state"), i.get("taxable_amount"), i.get("cgst_amount"), i.get("sgst_amount"),
             i.get("igst_amount"), i.get("grand_total")] for i in invs]
    return _csv_response(f"gst-register{'-' + month if month else ''}.csv",
                         ["Date", "Invoice #", "Client", "GSTIN", "State", "Taxable", "CGST", "SGST", "IGST", "Total"], rows)

@router.get("/reports/monthly")
async def monthly_summary(admin: dict = Depends(get_current_admin)):
    """Invoiced, GST and collected per calendar month (tax invoices only, cancelled excluded)."""
    months: Dict[str, Dict[str, float]] = {}

    def row(m: str) -> Dict[str, float]:
        return months.setdefault(m, {"invoices": 0, "taxable": 0.0, "tax": 0.0, "invoiced": 0.0, "collected": 0.0})

    for i in await get_collection("billing_invoices").find({"invoice_type": "invoice"}).to_list(50000):
        if i.get("status") == "cancelled" or not i.get("invoice_date"):
            continue
        r = row(str(i["invoice_date"])[:7])
        r["invoices"] += 1
        r["taxable"] += float(i.get("taxable_amount", 0))
        r["tax"] += float(i.get("cgst_amount", 0)) + float(i.get("sgst_amount", 0)) + float(i.get("igst_amount", 0))
        r["invoiced"] += float(i.get("grand_total", 0))
    for p in await get_collection("billing_payments").find({}).to_list(50000):
        if p.get("payment_date"):
            row(str(p["payment_date"])[:7])["collected"] += float(p.get("amount", 0))
    return {"success": True, "items": [{"month": m, **{k: round(v, 2) for k, v in r.items()}} for m, r in sorted(months.items(), reverse=True)]}
