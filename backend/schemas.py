"""Pydantic request models for P1 endpoints.

Response bodies are returned as plain dicts (asyncpg Record -> dict);
FastAPI's jsonable_encoder already handles UUID/Decimal/datetime, so
no response models are declared.
"""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field

EmploymentType = Literal["contract", "fulltime", "c2h", "fte", "part_time", "fl_contract"]
WorkMode = Literal["remote", "onsite", "hybrid"]
RequisitionStatus = Literal["open", "on_hold", "filled", "closed"]
ApplicationStage = Literal[
    "sourced", "contacted", "interested", "nda",
    "screened", "submitted",
    "l1_interview", "l2_interview",
    "offer", "offer_accepted",
    "placed", "rejected", "hold",
    "interview"  # legacy - kept for backwards compatibility
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
    # Real subset of skills_required (2026-08-24) -- which of the required
    # skills are genuinely mandatory, not just nice-to-have. Deliberately a
    # separate column, not encoded into skills_required itself, so every
    # existing reader of that field (AI matching, Boolean search, JD
    # templates) keeps working unchanged.
    mandatory_skills: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    employment_type: EmploymentType = "contract"
    # Real multi-select (2026-08-24): a requisition can now genuinely need
    # more than one employment type (e.g. Contract + FL Contract) at once.
    # employment_type (scalar) is still accepted/kept in sync as
    # employment_types[0] - the many existing display call sites
    # (dashboard cards, Companies page, public career pages, GlobalSearch)
    # read it as a single string and were not rewritten today.
    employment_types: list[EmploymentType] = Field(default_factory=list)
    positions_count: int = 1
    sla_hours: Optional[int] = None
    submission_limit_per_recruiter: Optional[int] = None
    # New fields
    experience_min: int = 0
    experience_max: int = 10
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    bill_rate: Optional[float] = None
    # Real min/max range (2026-08-24), matching the existing budget_min/max
    # pattern -- bill_rate (scalar) kept in sync as bill_rate_min so any
    # existing reader of the single value still works.
    bill_rate_min: Optional[float] = None
    bill_rate_max: Optional[float] = None
    work_mode: Optional[str] = "onsite"
    work_modes: list[WorkMode] = Field(default_factory=list)
    priority: Optional[str] = "medium"
    deadline: Optional[date] = None
    expected_start_date: Optional[date] = None
    education_required: Optional[str] = None
    shift_type: Optional[str] = "day"
    shift_timing_ids: list[str] = Field(default_factory=list)
    notice_period_max: Optional[int] = 60
    industry: Optional[str] = None
    client_name: Optional[str] = None


class RequisitionUpdate(BaseModel):
    client_id: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    skills_required: Optional[list[str]] = None
    mandatory_skills: Optional[list[str]] = None
    location: Optional[str] = None
    employment_type: Optional[EmploymentType] = None
    employment_types: Optional[list[EmploymentType]] = None
    status: Optional[RequisitionStatus] = None
    positions_count: Optional[int] = None
    sla_hours: Optional[int] = None
    # New fields
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    bill_rate: Optional[float] = None
    bill_rate_min: Optional[float] = None
    bill_rate_max: Optional[float] = None
    work_mode: Optional[str] = None
    work_modes: Optional[list[WorkMode]] = None
    priority: Optional[str] = None
    deadline: Optional[date] = None
    expected_start_date: Optional[date] = None
    education_required: Optional[str] = None
    shift_type: Optional[str] = None
    shift_timing_ids: Optional[list[str]] = None
    notice_period_max: Optional[int] = None
    industry: Optional[str] = None
    client_name: Optional[str] = None
    submission_limit_per_recruiter: Optional[int] = None
    is_active: Optional[bool] = None


class ApplicationCreate(BaseModel):
    requisition_id: str
    candidate_id: str
    assigned_recruiter_id: Optional[str] = None
    # Real bug fix (2026-08-20): defaulting this to the literal 'sourced'
    # at the schema level meant an omitted stage never reached
    # create_application() as falsy, silently defeating its own
    # tenant-configured-default-add-stage fallback (a candidate could
    # land in a hidden 'sourced' stage - invisible on the Kanban board -
    # for any tenant that hides it, exactly what that feature exists to
    # prevent). None lets the endpoint's own resolution logic run.
    stage: Optional[str] = None


class StageUpdate(BaseModel):
    # Plain str, not the ApplicationStage Literal — tenants can add custom
    # stages beyond the original 13 (see sql/16_custom_stages.sql). Validated
    # against that tenant's pipeline_stage_config in applications.py instead.
    stage: str
    reason: Optional[str] = None          # free-text notes (rejection: optional extra detail)
    reason_code: Optional[str] = None     # structured taxonomy code, required when stage=='rejected'
    custom_message: Optional[str] = None
    send_email: bool = True


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
    new_recruiter_id: Optional[str] = None
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
