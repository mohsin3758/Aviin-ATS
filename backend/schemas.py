"""Pydantic request models for P1 endpoints.

Response bodies are returned as plain dicts (asyncpg Record -> dict);
FastAPI's jsonable_encoder already handles UUID/Decimal/datetime, so
no response models are declared.
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

EmploymentType = Literal["contract", "fulltime", "c2h", "fte", "part_time"]
RequisitionStatus = Literal["open", "on_hold", "filled", "closed"]
ApplicationStage = Literal[
    "sourced", "screened", "submitted", "interview", "offer", "placed", "rejected"
]
OfferStatus = Literal[
    "draft", "pending_approval", "approved", "issued", "accepted", "declined", "rescinded"
]
Recommendation = Literal["strong_yes", "yes", "neutral", "no", "strong_no"]


class LoginRequest(BaseModel):
    email: str
    password: str


class CandidateCreate(BaseModel):
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    total_exp_mo: int = 0
    location: Optional[str] = None
    current_employer: Optional[str] = None
    resume_text: Optional[str] = None
    source: Optional[str] = None
    consent_text: Optional[str] = None
    expected_ctc: Optional[float] = None
    current_ctc: Optional[float] = None
    notice_period_days: Optional[int] = None


class CandidateUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    skills: Optional[list[str]] = None
    total_exp_mo: Optional[int] = None
    location: Optional[str] = None
    current_employer: Optional[str] = None
    resume_text: Optional[str] = None
    source: Optional[str] = None
    expected_ctc: Optional[float] = None
    current_ctc: Optional[float] = None
    notice_period_days: Optional[int] = None


class RequisitionCreate(BaseModel):
    client_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    skills_required: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    employment_type: EmploymentType = "contract"
    positions_count: int = 1
    sla_hours: Optional[int] = None
    # New fields
    experience_min: int = 0
    experience_max: int = 10
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    bill_rate: Optional[float] = None
    work_mode: Optional[str] = "onsite"
    priority: Optional[str] = "medium"
    deadline: Optional[str] = None
    expected_start_date: Optional[str] = None
    education_required: Optional[str] = None
    shift_type: Optional[str] = "day"
    notice_period_max: Optional[int] = 60
    industry: Optional[str] = None
    client_name: Optional[str] = None


class RequisitionUpdate(BaseModel):
    client_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    skills_required: Optional[list[str]] = None
    location: Optional[str] = None
    employment_type: Optional[EmploymentType] = None
    status: Optional[RequisitionStatus] = None
    positions_count: Optional[int] = None
    sla_hours: Optional[int] = None
    # New fields
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    bill_rate: Optional[float] = None
    work_mode: Optional[str] = None
    priority: Optional[str] = None
    deadline: Optional[str] = None
    expected_start_date: Optional[str] = None
    education_required: Optional[str] = None
    shift_type: Optional[str] = None
    notice_period_max: Optional[int] = None
    industry: Optional[str] = None
    client_name: Optional[str] = None


class ApplicationCreate(BaseModel):
    requisition_id: str
    candidate_id: str
    assigned_recruiter_id: Optional[str] = None


class StageUpdate(BaseModel):
    stage: ApplicationStage
    reason: Optional[str] = None


class OfferCreate(BaseModel):
    application_id: str
    ctc_offered: Optional[float] = None
    currency: str = "INR"
    joining_date: Optional[date] = None


class OfferRespond(BaseModel):
    status: Literal["accepted", "declined"]


class AssignmentCreate(BaseModel):
    requisition_id: str
    recruiter_id: str
    match_score: Optional[float] = None


class ReassignRequest(BaseModel):
    new_recruiter_id: str
    reason: Optional[str] = None


class ConsentCreate(BaseModel):
    candidate_id: str
    data_category: str
    channel: Optional[str] = None
    consent_given: bool
    consent_text: Optional[str] = None
    expected_ctc: Optional[float] = None
    current_ctc: Optional[float] = None
    notice_period_days: Optional[int] = None


class JDGenerateRequest(BaseModel):
    title: str
    skills_required: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    employment_type: EmploymentType = "contract"
    experience_years: Optional[int] = None
    notes: Optional[str] = None


class ScorecardCreate(BaseModel):
    application_id: str
    interviewer_id: Optional[str] = None
    round: str = "L1"
    scores: dict = Field(default_factory=dict)
    overall_rating: Optional[float] = None
    recommendation: Optional[Recommendation] = None
    notes: Optional[str] = None
