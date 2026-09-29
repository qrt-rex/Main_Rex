from typing import Literal
from pydantic import BaseModel, Field


class PayrollAdjustmentRequest(BaseModel):
    employee_id: str
    adjustment_type: Literal["increment", "decrement"] = Field(..., description="'increment' or 'decrement'")
    field: Literal["base_salary", "hra", "conveyance_allowance", "special_allowance", "professional_tax"] = Field(
        ...,
        description="Salary field to adjust: base_salary, hra, conveyance_allowance, special_allowance, professional_tax",
    )
    amount: float = Field(..., gt=0, le=100_000_000, description="Positive amount to add or subtract")
    reason: str = Field(..., min_length=3, max_length=500, description="Reason for the adjustment")


class PayrollAdjustmentResponse(BaseModel):
    success: bool = True
    employee_id: str
    employee_name: str
    field: str
    adjustment_type: str
    old_value: float
    new_value: float
    amount: float
    reason: str
    new_gross_salary: float
    new_estimated_net_salary: float
    adjusted_by: str
    timestamp: str
