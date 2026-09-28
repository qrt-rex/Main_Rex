from typing import List, Optional, Any, Dict
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from app.utils.sanitize import clean_payload
from app.utils.validators import optional_iso_date, require_choice, require_mobile

CANDIDATE_STATUSES = ["Applied", "Screening", "Interview Scheduled", "Interviewed", "Selected",
                      "Joined", "On Hold", "Rejected"]


def _status(v: Optional[str]) -> Optional[str]:
    return v if v is None else require_choice(v, CANDIDATE_STATUSES, "Status")

class EducationItem(BaseModel):
    degree: str = ""
    institution: str = ""
    year: str = ""
    grade: str = ""

class WorkExperienceItem(BaseModel):
    company: str = ""
    role: str = ""
    duration: str = ""
    responsibilities: str = ""

class SkillItem(BaseModel):
    name: str = ""
    proficiency: str = "Intermediate"  # Beginner, Intermediate, Advanced, Expert
    comments: Optional[str] = ""

class CandidateCreateRequest(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _neutralize_markup(cls, data):
        return clean_payload(data)

    candidate_name: str = Field(min_length=2, max_length=120)
    position_applied: str = Field(min_length=1, max_length=120)
    interview_date: Optional[str] = ""
    contact_number: str
    email: EmailStr

    @field_validator("contact_number")
    @classmethod
    def _phone(cls, v):
        return require_mobile(v)

    @field_validator("interview_date")
    @classmethod
    def _interview_date(cls, v):
        return optional_iso_date(v, "Interview date")
    current_company: Optional[str] = ""
    total_experience: Optional[str] = ""
    notice_period: Optional[str] = ""
    current_ctc: Optional[str] = ""
    expected_ctc: Optional[str] = ""
    education: List[EducationItem] = []
    work_experience: List[WorkExperienceItem] = []
    skills: List[SkillItem] = []
    languages_known: Optional[str] = ""
    hobbies: Optional[str] = ""
    strengths: Optional[str] = ""
    weaknesses: Optional[str] = ""
    interview_notes: Optional[str] = ""
    declaration_accepted: bool = True

class CandidateUpdateRequest(BaseModel):
    candidate_name: Optional[str] = None
    position_applied: Optional[str] = None
    interview_date: Optional[str] = None
    contact_number: Optional[str] = None
    email: Optional[EmailStr] = None
    current_company: Optional[str] = None
    total_experience: Optional[str] = None
    notice_period: Optional[str] = None
    current_ctc: Optional[str] = None
    expected_ctc: Optional[str] = None
    education: Optional[List[EducationItem]] = None
    work_experience: Optional[List[WorkExperienceItem]] = None
    skills: Optional[List[SkillItem]] = None
    languages_known: Optional[str] = None
    hobbies: Optional[str] = None
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    interview_notes: Optional[str] = None
    status: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v):
        return _status(v)

    @field_validator("contact_number")
    @classmethod
    def _phone(cls, v):
        return v if v is None else require_mobile(v)

    @field_validator("interview_date")
    @classmethod
    def _interview_date(cls, v):
        return v if v is None else optional_iso_date(v, "Interview date")

    @field_validator("candidate_name", "position_applied")
    @classmethod
    def _not_blank(cls, v):
        if v is not None and not v.strip():
            raise ValueError("This field is required.")
        return v

class CandidateStatusUpdateRequest(BaseModel):
    status: str  # Applied, Screening, Interview Scheduled, Interviewed, Selected, Rejected, On Hold, Joined
    interview_notes: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v):
        return _status(v)

class CandidateResponse(BaseModel):
    id: str
    candidate_name: str
    position_applied: str
    interview_date: Optional[str] = ""
    contact_number: str
    email: str
    current_company: Optional[str] = ""
    total_experience: Optional[str] = ""
    notice_period: Optional[str] = ""
    current_ctc: Optional[str] = ""
    expected_ctc: Optional[str] = ""
    education: List[EducationItem] = []
    work_experience: List[WorkExperienceItem] = []
    skills: List[SkillItem] = []
    languages_known: Optional[str] = ""
    hobbies: Optional[str] = ""
    strengths: Optional[str] = ""
    weaknesses: Optional[str] = ""
    status: str = "Applied"
    interview_notes: Optional[str] = ""
    has_joining_token: bool = False
    joining_token: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class CandidateListResponse(BaseModel):
    total: int
    page: int
    limit: int
    candidates: List[CandidateResponse]
