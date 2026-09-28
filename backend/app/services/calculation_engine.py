import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, List, Optional
from datetime import datetime
from app.utils.number_to_words import amount_to_words

class CalculationEngine:
    """
    Decimal-safe financial calculation engine for Indian and global payroll compliance.
    Prevents floating-point drift and enforces statutory rules and policies.
    """

    @staticmethod
    def _to_decimal(val: Any) -> Decimal:
        if val is None:
            return Decimal("0.00")
        try:
            return Decimal(str(val))
        except Exception:
            return Decimal("0.00")

    @classmethod
    def _round_2(cls, val: Any) -> float:
        dec = cls._to_decimal(val)
        return float(dec.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))

    @classmethod
    def calculate_full_payroll(
        cls,
        salary_structure: Dict[str, Any],
        attendance: Dict[str, Any],
        advances: Optional[List[Dict[str, Any]]] = None,
        loans: Optional[List[Dict[str, Any]]] = None,
        approved_bonuses: Optional[List[Dict[str, Any]]] = None,
        approved_overtime: Optional[List[Dict[str, Any]]] = None,
        manual_adjustments: Optional[List[Dict[str, Any]]] = None,
        settings: Optional[Dict[str, Any]] = None,
        advance_override: Optional[float] = None,
        loan_override: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Executes complete salary calculation incorporating Attendance, Leaves, Overtime,
        Bonuses, Advances, Loans, Statutory Rules (PF, PT, ESI, TDS) and Manual Adjustments.
        """
        settings = settings or {}
        advances = advances or []
        loans = loans or []
        approved_bonuses = approved_bonuses or []
        approved_overtime = approved_overtime or []
        manual_adjustments = manual_adjustments or []

        # --- 1. Basic & Allowances ---
        base_salary_d = cls._to_decimal(salary_structure.get("base_salary", 0.0))
        
        # HRA calculation
        hra_type = salary_structure.get("hra_type", "fixed")
        hra_val = cls._to_decimal(salary_structure.get("hra_value", 0.0))
        if hra_type == "percentage":
            hra_d = (base_salary_d * hra_val / Decimal("100.00"))
        else:
            hra_d = hra_val

        conveyance_d = cls._to_decimal(salary_structure.get("conveyance_allowance", 0.0))
        medical_d = cls._to_decimal(salary_structure.get("medical_allowance", 0.0))
        special_d = cls._to_decimal(salary_structure.get("special_allowance", 0.0))
        other_allow_d = cls._to_decimal(salary_structure.get("other_allowances", 0.0))

        # --- 2. Overtime ---
        ot_hours = cls._to_decimal(attendance.get("overtime_hours", 0.0))
        struct_ot_rate = cls._to_decimal(salary_structure.get("overtime_rate_per_hour", 0.0))
        if struct_ot_rate <= Decimal("0.00") and base_salary_d > Decimal("0.00"):
            # Standard formula: (Base salary / 240 hours) * 1.5 multiplier
            struct_ot_rate = (base_salary_d / Decimal("240.00")) * Decimal("1.5")

        approved_ot_total = sum(cls._to_decimal(ot.get("amount", 0.0)) for ot in approved_overtime)
        if approved_ot_total > Decimal("0.00"):
            overtime_pay_d = approved_ot_total
        else:
            overtime_pay_d = ot_hours * struct_ot_rate

        # --- 3. Bonuses & Incentives ---
        bonus_d = sum(cls._to_decimal(b.get("amount", 0.0)) for b in approved_bonuses if b.get("type") != "Sales Incentive")
        incentive_d = sum(cls._to_decimal(b.get("amount", 0.0)) for b in approved_bonuses if b.get("type") == "Sales Incentive")
        other_earnings_d = cls._to_decimal(salary_structure.get("other_earnings", 0.0))

        # --- 4. Manual Earnings Adjustments ---
        manual_earnings_d = sum(
            cls._to_decimal(adj.get("amount", 0.0))
            for adj in manual_adjustments
            if adj.get("type") == "earning"
        )

        # Standard Monthly Gross (Base + Core Allowances)
        standard_gross_d = base_salary_d + hra_d + conveyance_d + medical_d + special_d + other_allow_d
        
        # Total Earnings
        gross_salary_d = standard_gross_d + overtime_pay_d + bonus_d + incentive_d + other_earnings_d + manual_earnings_d

        # --- 5. Attendance & Leave Deductions (Loss of Pay) ---
        working_days = max(1, int(attendance.get("working_days", 30)))
        unpaid_leave_days = cls._to_decimal(attendance.get("unpaid_leave_days", 0.0))
        absent_days = cls._to_decimal(attendance.get("absent_days", 0.0))
        half_days = cls._to_decimal(attendance.get("half_days", 0.0))

        total_lop_days = unpaid_leave_days + absent_days + (half_days * Decimal("0.5"))
        daily_rate_d = standard_gross_d / Decimal(str(working_days))
        unpaid_leave_deduction_d = daily_rate_d * total_lop_days

        # --- 6. Late Attendance Deduction ---
        late_count = int(attendance.get("late_count", 0))
        late_rule = settings.get("late_deduction_rule", "count_tiers")
        late_deduction_d = Decimal("0.00")
        if late_rule == "count_tiers" and late_count >= 3:
            # 3 late marks = 0.5 day deduction, 6 late marks = 1.0 day deduction
            late_ded_days = Decimal(str(late_count // 3)) * Decimal("0.5")
            late_deduction_d = daily_rate_d * late_ded_days
        elif late_rule == "fixed":
            late_deduction_d = Decimal(str(late_count * 100))

        # --- 7. Statutory Deductions ---
        # PF Calculation
        pf_opted = salary_structure.get("pf_opted", True)
        pf_type = salary_structure.get("pf_type", "percentage_12")
        pf_d = Decimal("0.00")
        if pf_opted and base_salary_d > Decimal("0.00"):
            if pf_type == "percentage_12":
                pf_d = base_salary_d * Decimal("0.12")
            elif pf_type == "fixed":
                pf_d = cls._to_decimal(salary_structure.get("pf_fixed_amount", 0.0))

        # ESI Calculation (0.75% of Gross if gross <= 21000 or explicitly opted)
        esi_opted = salary_structure.get("esi_opted", False)
        esi_d = Decimal("0.00")
        if esi_opted and standard_gross_d > Decimal("0.00"):
            esi_perc = cls._to_decimal(salary_structure.get("esi_percentage", 0.75))
            esi_d = standard_gross_d * (esi_perc / Decimal("100.00"))

        # Professional Tax (PT)
        pt_d = cls._to_decimal(salary_structure.get("professional_tax", settings.get("default_pt_amount", 200.0)))

        # TDS / Tax
        tds_perc = cls._to_decimal(salary_structure.get("tds_percentage", 0.0))
        tds_d = standard_gross_d * (tds_perc / Decimal("100.00")) if tds_perc > Decimal("0.00") else Decimal("0.00")

        # --- 8. Salary Advance Deductions ---
        # Never deduct more than the remaining balance for any active advance!
        advances_deducted_records = []
        total_advance_deduction_d = Decimal("0.00")

        if advance_override is not None:
            total_advance_deduction_d = cls._to_decimal(advance_override)
        else:
            for adv in advances:
                rem_bal = cls._to_decimal(adv.get("remaining_balance", 0.0))
                monthly_installment = cls._to_decimal(adv.get("monthly_deduction_amount", 0.0))
                if rem_bal > Decimal("0.00") and monthly_installment > Decimal("0.00"):
                    ded_amt = min(rem_bal, monthly_installment)
                    total_advance_deduction_d += ded_amt
                    advances_deducted_records.append({
                        "advance_id": adv.get("advance_id"),
                        "advance_db_id": str(adv.get("_id", "")),
                        "deducted_amount": cls._round_2(ded_amt),
                        "previous_remaining": cls._round_2(rem_bal),
                        "new_remaining": cls._round_2(rem_bal - ded_amt)
                    })

        # --- 9. Employee Loan Deductions ---
        loans_deducted_records = []
        total_loan_deduction_d = Decimal("0.00")

        if loan_override is not None:
            total_loan_deduction_d = cls._to_decimal(loan_override)
        else:
            for loan in loans:
                rem_loan = cls._to_decimal(loan.get("remaining_amount", 0.0))
                monthly_emi = cls._to_decimal(loan.get("monthly_emi", 0.0))
                if rem_loan > Decimal("0.00") and monthly_emi > Decimal("0.00"):
                    ded_amt = min(rem_loan, monthly_emi)
                    total_loan_deduction_d += ded_amt
                    loans_deducted_records.append({
                        "loan_id": loan.get("loan_id"),
                        "loan_db_id": str(loan.get("_id", "")),
                        "deducted_amount": cls._round_2(ded_amt),
                        "previous_remaining": cls._round_2(rem_loan),
                        "new_remaining": cls._round_2(rem_loan - ded_amt)
                    })

        # --- 10. Manual Deduction Adjustments ---
        manual_deductions_d = sum(
            cls._to_decimal(adj.get("amount", 0.0))
            for adj in manual_adjustments
            if adj.get("type") == "deduction"
        )
        other_deductions_d = cls._to_decimal(salary_structure.get("other_deductions", 0.0))

        # Total Deductions
        total_deductions_d = (
            pf_d
            + esi_d
            + pt_d
            + tds_d
            + unpaid_leave_deduction_d
            + late_deduction_d
            + total_advance_deduction_d
            + total_loan_deduction_d
            + other_deductions_d
            + manual_deductions_d
        )

        # Net Salary calculation (Guardrail against negative unless explicit policy)
        net_salary_d = max(Decimal("0.00"), gross_salary_d - total_deductions_d)
        net_salary_float = cls._round_2(net_salary_d)
        words = amount_to_words(net_salary_float)

        return {
            "earnings": {
                "basic": cls._round_2(base_salary_d),
                "hra": cls._round_2(hra_d),
                "conveyance": cls._round_2(conveyance_d),
                "medical": cls._round_2(medical_d),
                "special_allowance": cls._round_2(special_d),
                "other_allowances": cls._round_2(other_allow_d),
                "overtime_pay": cls._round_2(overtime_pay_d),
                "bonus": cls._round_2(bonus_d),
                "incentive": cls._round_2(incentive_d),
                "other_earnings": cls._round_2(other_earnings_d),
                "manual_adjustments": cls._round_2(manual_earnings_d),
                "gross_salary": cls._round_2(gross_salary_d)
            },
            "deductions": {
                "pf": cls._round_2(pf_d),
                "esi": cls._round_2(esi_d),
                "professional_tax": cls._round_2(pt_d),
                "tds": cls._round_2(tds_d),
                "unpaid_leave_deduction": cls._round_2(unpaid_leave_deduction_d),
                "late_deduction": cls._round_2(late_deduction_d),
                "salary_advance_deduction": cls._round_2(total_advance_deduction_d),
                "loan_deduction": cls._round_2(total_loan_deduction_d),
                "other_deductions": cls._round_2(other_deductions_d),
                "manual_adjustments": cls._round_2(manual_deductions_d),
                "total_deductions": cls._round_2(total_deductions_d)
            },
            "gross_salary": cls._round_2(gross_salary_d),
            "total_deductions": cls._round_2(total_deductions_d),
            "net_salary": net_salary_float,
            "net_salary_words": words,
            "advances_deducted": advances_deducted_records,
            "loans_deducted": loans_deducted_records
        }
