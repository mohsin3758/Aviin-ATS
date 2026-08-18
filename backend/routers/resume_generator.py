"""AI Resume Generator / Resume Transformation Engine.

The original resume (resume_files / candidates.resume_text) is never
touched — every generated document is a brand-new file, stored as its own
generated_resumes row, downloadable only through the authenticated
endpoint below (never a raw static path). Uses the same compositional
renderer (services/resume_formatting.py) that kae_submission.py's 6 fixed
formats now call too — one document engine, not two.
"""
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import db
import events
from deps import Actor, get_actor
from services.resume_formatting import (
    render_resume_pdf, render_resume_docx, mask_name, DEFAULT_CONFIG,
    _resolve_body_text, _company_line, _client_line, VISUAL_THEMES, _VALID_THEMES,
)

router = APIRouter(prefix="/resume-generator", tags=["resume-generator"])

GEN_UPLOADS_BASE = Path("/app/uploads/generated_resumes")

_CONFIG_FIELDS = (
    "name_format", "show_mobile", "show_email", "show_location",
    "company_mode", "company_replacement", "project_mode",
    "client_name_mode", "client_name_replacement", "visual_theme",
)


@router.get("/visual-themes")
async def list_visual_themes(actor: Actor = Depends(get_actor)):
    """The real, selectable layout options (separate dimension from the
    content-composition templates below — any content template can render
    in any of these looks)."""
    return VISUAL_THEMES


async def _load_candidate(conn, tenant_id: str, candidate_id: str) -> dict:
    row = await conn.fetchrow(
        """SELECT id, full_name, phone, email, location, current_employer,
                  current_designation, total_exp_mo, skills, resume_text
           FROM candidates WHERE id=$1 AND tenant_id=$2""",
        candidate_id, tenant_id)
    if not row:
        raise HTTPException(404, "Candidate not found")
    return dict(row)


def _config_from_body(body: "GenerateIn | PreviewIn", template: Optional[dict]) -> dict:
    """Explicit per-request overrides win; anything not overridden falls
    back to the selected template's stored config; anything still unset
    falls back to DEFAULT_CONFIG."""
    base = dict(DEFAULT_CONFIG)
    if template:
        for f in ("name_format", "show_mobile", "show_email", "show_location",
                   "company_mode", "project_mode", "client_name_mode", "visual_theme"):
            if f in template and template[f] is not None:
                base[f] = template[f]
        # Column is named default_company_replacement on resume_templates
        # (it's a pre-fill, not necessarily what every generation uses) —
        # maps onto the compositional config's company_replacement key.
        if template.get("default_company_replacement"):
            base["company_replacement"] = template["default_company_replacement"]
    for f in _CONFIG_FIELDS:
        v = getattr(body, f, None)
        if v is not None:
            base[f] = v
    return base


# ─────────────────────────── Templates CRUD ───────────────────────────

class TemplateIn(BaseModel):
    name: str
    name_format: str = "full"
    show_mobile: bool = True
    show_email: bool = True
    show_location: bool = True
    company_mode: str = "original"
    default_company_replacement: Optional[str] = None
    project_mode: str = "include"
    client_name_mode: str = "hide"
    visual_theme: str = "classic"


_VALID = {
    "name_format": {"full", "masked"},
    "company_mode": {"original", "replace", "hide"},
    "project_mode": {"include", "hide", "focus"},
    "client_name_mode": {"show", "hide", "replace"},
    "visual_theme": _VALID_THEMES,
}


def _validate_template_fields(body: TemplateIn):
    if body.name_format not in _VALID["name_format"]:
        raise HTTPException(400, "name_format must be 'full' or 'masked'")
    if body.company_mode not in _VALID["company_mode"]:
        raise HTTPException(400, "company_mode must be original, replace, or hide")
    if body.project_mode not in _VALID["project_mode"]:
        raise HTTPException(400, "project_mode must be include, hide, or focus")
    if body.client_name_mode not in _VALID["client_name_mode"]:
        raise HTTPException(400, "client_name_mode must be show, hide, or replace")
    if body.visual_theme not in _VALID["visual_theme"]:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID['visual_theme'])}")


@router.get("/templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT * FROM resume_templates WHERE tenant_id=$1 ORDER BY is_builtin DESC, name",
            actor.tenant_id)
    return [dict(r) for r in rows]


@router.post("/templates")
async def create_template(body: TemplateIn, actor: Actor = Depends(get_actor)):
    _validate_template_fields(body)
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO resume_templates
                 (tenant_id, name, is_builtin, name_format, show_mobile, show_email, show_location,
                  company_mode, default_company_replacement, project_mode, client_name_mode, visual_theme, created_by)
               VALUES ($1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *""",
            actor.tenant_id, body.name, body.name_format, body.show_mobile, body.show_email,
            body.show_location, body.company_mode, body.default_company_replacement,
            body.project_mode, body.client_name_mode, body.visual_theme, actor.user_id)
    return dict(row)


@router.put("/templates/{template_id}")
async def update_template(template_id: str, body: TemplateIn, actor: Actor = Depends(get_actor)):
    _validate_template_fields(body)
    async with db.tenant_conn(actor.tenant_id) as conn:
        existing = await conn.fetchrow(
            "SELECT is_builtin FROM resume_templates WHERE id=$1 AND tenant_id=$2", template_id, actor.tenant_id)
        if not existing:
            raise HTTPException(404, "Template not found")
        if existing["is_builtin"]:
            raise HTTPException(400, "Built-in templates cannot be edited — create a custom template instead")
        row = await conn.fetchrow(
            """UPDATE resume_templates SET name=$1, name_format=$2, show_mobile=$3, show_email=$4,
                 show_location=$5, company_mode=$6, default_company_replacement=$7, project_mode=$8,
                 client_name_mode=$9, visual_theme=$10, updated_at=now()
               WHERE id=$11 RETURNING *""",
            body.name, body.name_format, body.show_mobile, body.show_email, body.show_location,
            body.company_mode, body.default_company_replacement, body.project_mode,
            body.client_name_mode, body.visual_theme, template_id)
    return dict(row)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT is_builtin FROM resume_templates WHERE id=$1 AND tenant_id=$2", template_id, actor.tenant_id)
        if not row:
            raise HTTPException(404, "Template not found")
        if row["is_builtin"]:
            raise HTTPException(400, "Built-in templates cannot be deleted")
        await conn.execute("DELETE FROM resume_templates WHERE id=$1", template_id)
    return {"ok": True}


# ─────────────────────────── Recommendation (52.9) ───────────────────────────

@router.get("/candidates/{candidate_id}/recommend")
async def recommend_template(candidate_id: str, requisition_id: Optional[str] = None, actor: Actor = Depends(get_actor)):
    """Real recommendation, not a placeholder: client's configured default
    template wins; else the most recently used template for that same
    client (learned from real prior generations); else the tenant's
    Full Contact built-in as a safe, unsurprising default."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        client_id = None
        if requisition_id:
            client_id = await conn.fetchval(
                "SELECT client_id FROM requisitions WHERE id=$1 AND tenant_id=$2", requisition_id, actor.tenant_id)

        if client_id:
            pref = await conn.fetchrow(
                """SELECT rt.* FROM clients c JOIN resume_templates rt ON rt.id = c.default_resume_template_id
                   WHERE c.id=$1 AND c.tenant_id=$2""", client_id, actor.tenant_id)
            if pref:
                return {"template": dict(pref), "reason": "This client has a configured default resume format."}

            recent = await conn.fetchrow(
                """SELECT rt.* FROM generated_resumes gr JOIN resume_templates rt ON rt.id = gr.template_id
                   WHERE gr.tenant_id=$1 AND gr.client_id=$2
                   ORDER BY gr.generated_at DESC LIMIT 1""", actor.tenant_id, client_id)
            if recent:
                return {"template": dict(recent), "reason": "Most recently used format for this client."}

        default_tpl = await conn.fetchrow(
            "SELECT * FROM resume_templates WHERE tenant_id=$1 AND name='Full Contact Resume' LIMIT 1",
            actor.tenant_id)
    return {"template": dict(default_tpl) if default_tpl else None,
            "reason": "No client preference or history found — using the default Full Contact format."}


# ─────────────────────────── Preview (52.4) ───────────────────────────

class PreviewIn(BaseModel):
    template_id: Optional[str] = None
    name_format: Optional[str] = None
    show_mobile: Optional[bool] = None
    show_email: Optional[bool] = None
    show_location: Optional[bool] = None
    company_mode: Optional[str] = None
    company_replacement: Optional[str] = None
    project_mode: Optional[str] = None
    client_name_mode: Optional[str] = None
    client_name_replacement: Optional[str] = None
    visual_theme: Optional[str] = None
    requisition_id: Optional[str] = None


@router.post("/candidates/{candidate_id}/preview")
async def preview_resume(candidate_id: str, body: PreviewIn, actor: Actor = Depends(get_actor)):
    """A fast, structured preview (not a rendered PDF on every keystroke) —
    reflects exactly what Generate will produce: masked name, which contact
    fields survive, the company line, and a snippet of the body text."""
    if body.visual_theme is not None and body.visual_theme not in _VALID_THEMES:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID_THEMES)}")
    async with db.tenant_conn(actor.tenant_id) as conn:
        candidate = await _load_candidate(conn, actor.tenant_id, candidate_id)
        template = None
        if body.template_id:
            template = dict(await conn.fetchrow(
                "SELECT * FROM resume_templates WHERE id=$1 AND tenant_id=$2", body.template_id, actor.tenant_id) or {})
        client_name = None
        if body.requisition_id:
            client_name = await conn.fetchval(
                """SELECT cl.name FROM requisitions r JOIN clients cl ON cl.id=r.client_id
                   WHERE r.id=$1 AND r.tenant_id=$2""", body.requisition_id, actor.tenant_id)

    cfg = _config_from_body(body, template or None)
    display_name = mask_name(candidate["full_name"] or "") if cfg["name_format"] == "masked" else (candidate["full_name"] or "Candidate")
    heading, text = _resolve_body_text(candidate, cfg)
    return {
        "display_name": display_name,
        "designation": candidate["current_designation"],
        "mobile": candidate["phone"] if cfg["show_mobile"] else None,
        "email": candidate["email"] if cfg["show_email"] else None,
        "location": candidate["location"] if cfg["show_location"] else None,
        "company": _company_line(candidate, cfg),
        "skills": candidate["skills"] or [],
        "section_heading": heading,
        "body_snippet": (text[:600] + ("…" if len(text) > 600 else "")) if text else "",
        "client_line": _client_line(client_name, cfg),
        "config": cfg,
    }


# ─────────────────────────── Generate (52.5 / 52.6) ───────────────────────────

class GenerateIn(PreviewIn):
    output_format: str = "pdf"
    submit_to_kae: bool = False
    cc_self: bool = True


def _save_generated_file(data: bytes, tenant_id: str, candidate_id: str, ext: str) -> str:
    date_str = datetime.now().strftime("%Y/%m/%d")
    folder = GEN_UPLOADS_BASE / tenant_id / date_str
    folder.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex[:10]
    dest = folder / f"{uid}_{candidate_id[:8]}.{ext}"
    dest.write_bytes(data)
    return str(dest)


async def _generate_one(candidate_id: str, body: "GenerateIn", actor: Actor) -> tuple[dict, bytes]:
    """Core single-candidate generation, shared by the single endpoint and
    bulk-generate below — extracted so bulk generation doesn't duplicate
    this logic a second time. Returns (generated_resumes row dict,
    file_bytes) on success; on failure the row's generation_status is
    'failed' and file_bytes is empty — caller decides whether to raise
    (single) or record-and-continue (bulk)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        candidate = await _load_candidate(conn, actor.tenant_id, candidate_id)
        template = None
        if body.template_id:
            template = dict(await conn.fetchrow(
                "SELECT * FROM resume_templates WHERE id=$1 AND tenant_id=$2", body.template_id, actor.tenant_id) or {})
            if not template:
                raise HTTPException(404, "Template not found")

        client_id, client_name = None, None
        if body.requisition_id:
            req = await conn.fetchrow(
                """SELECT r.client_id, cl.name AS client_name FROM requisitions r
                   LEFT JOIN clients cl ON cl.id=r.client_id
                   WHERE r.id=$1 AND r.tenant_id=$2""", body.requisition_id, actor.tenant_id)
            if req:
                client_id, client_name = req["client_id"], req["client_name"]

        source_resume_file_id = await conn.fetchval(
            """SELECT id FROM resume_files WHERE candidate_id=$1 AND tenant_id=$2
               ORDER BY created_at DESC LIMIT 1""", candidate_id, actor.tenant_id)

        version = (await conn.fetchval(
            "SELECT COALESCE(MAX(version),0)+1 FROM generated_resumes WHERE tenant_id=$1 AND candidate_id=$2",
            actor.tenant_id, candidate_id)) or 1

    cfg = _config_from_body(body, template or None)
    display_name = mask_name(candidate["full_name"] or "") if cfg["name_format"] == "masked" else (candidate["full_name"] or "Candidate")

    try:
        if body.output_format == "pdf":
            file_bytes = render_resume_pdf(candidate, cfg, client_name)
        else:
            file_bytes = render_resume_docx(candidate, cfg, client_name)
        file_path = _save_generated_file(file_bytes, actor.tenant_id, candidate_id, body.output_format)
        status, error_msg = "completed", None
    except Exception as exc:
        file_bytes, file_path, status, error_msg = b"", "", "failed", str(exc)

    template_name = (template or {}).get("name") or "Custom"

    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO generated_resumes
                 (tenant_id, candidate_id, source_resume_file_id, template_id, requisition_id, client_id,
                  template_name, name_format, display_name, show_mobile, show_email, show_location,
                  company_mode, company_replacement, project_mode, client_name_mode, client_name_replacement,
                  visual_theme, output_format, file_path, file_size, version, generation_status, error_message, generated_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
               RETURNING *""",
            actor.tenant_id, candidate_id, source_resume_file_id, body.template_id, body.requisition_id, client_id,
            template_name, cfg["name_format"], display_name, cfg["show_mobile"], cfg["show_email"], cfg["show_location"],
            cfg["company_mode"], cfg["company_replacement"], cfg["project_mode"], cfg["client_name_mode"], cfg["client_name_replacement"],
            cfg["visual_theme"], body.output_format, file_path, len(file_bytes), version, status, error_msg, actor.user_id,
        )
        if status == "completed":
            await events.write_outbox(
                conn, actor.tenant_id, "resume.generated",
                {"candidate_id": candidate_id, "generated_resume_id": str(row["id"]), "template": template_name},
                f"resume.generated:{row['id']}",
            )
            await events.write_audit(
                conn, actor.tenant_id, actor.user_id, "generate_resume", "candidate", candidate_id,
                before=None,
                after={"template": template_name, "format": body.output_format, "display_name": display_name,
                       "removed_fields": [f for f, shown in (("mobile", cfg["show_mobile"]), ("email", cfg["show_email"])) if not shown],
                       "company_mode": cfg["company_mode"], "company_replacement": cfg["company_replacement"],
                       "version": version},
            )
    return dict(row), file_bytes


@router.post("/candidates/{candidate_id}/generate")
async def generate_resume(candidate_id: str, body: GenerateIn, actor: Actor = Depends(get_actor)):
    if body.output_format not in ("pdf", "docx"):
        raise HTTPException(400, "output_format must be 'pdf' or 'docx'")
    if body.visual_theme is not None and body.visual_theme not in _VALID_THEMES:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID_THEMES)}")

    row, file_bytes = await _generate_one(candidate_id, body, actor)
    template_name = row["template_name"]

    out = dict(row)
    if row["generation_status"] == "failed":
        raise HTTPException(500, f"Resume generation failed: {row['error_message']}")

    # REAL BUG FIX (2026-08-12 audit): this used to email the KAE directly
    # via _send_kae_email, completely bypassing the real submission-
    # tracking system — no candidate_submissions row, no stage bump, no
    # tracking-sheet sl_no increment, invisible in "Submit to KAE"'s own
    # submission history even though both send to the same KAE for the
    # same candidate/requisition. Now routes through the same shared
    # _do_kae_submission() core kae_submission.py's 6 legacy styles use.
    if body.submit_to_kae and body.requisition_id:
        from routers.kae_submission import _do_kae_submission
        async with db.tenant_conn(actor.tenant_id) as conn:
            app_row = await conn.fetchrow(
                """SELECT id FROM applications WHERE candidate_id=$1 AND requisition_id=$2 AND tenant_id=$3
                   ORDER BY updated_at DESC LIMIT 1""",
                candidate_id, body.requisition_id, actor.tenant_id)
        if not app_row:
            out["submitted_to_kae"] = False
            out["submit_error"] = "No application links this candidate to this requisition — cannot resolve a submission record"
        else:
            safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", row["display_name"] or "candidate")
            ext = "pdf" if body.output_format == "pdf" else "docx"
            try:
                submission = await _do_kae_submission(
                    actor.tenant_id, str(app_row["id"]), actor, file_bytes,
                    f"Resume_{safe_name}_{template_name.replace(' ', '_')}.{ext}", "custom_generated",
                    f"{template_name} ({ext.upper()}, via Resume Generator)",
                    generated_resume_id=str(row["id"]), cc_self=body.cc_self,
                )
                out["submitted_to_kae"] = submission["email_sent"]
                out["submit_error"] = submission["email_error"]
                out["submission_id"] = str(submission["id"])
                out["stage_bumped_to_submitted"] = submission["stage_bumped_to_submitted"]
            except HTTPException as exc:
                out["submitted_to_kae"] = False
                out["submit_error"] = exc.detail

    return out


class BulkGenerateIn(BaseModel):
    candidate_ids: list[str]
    template_id: Optional[str] = None
    output_format: str = "pdf"
    # Same compositional overrides as single-candidate generation, applied
    # identically to every candidate in the batch — bulk generation is
    # deliberately single-template, no per-candidate live preview (spec
    # gap: "no bulk resume generation", not "no per-candidate bulk config").
    name_format: Optional[str] = None
    show_mobile: Optional[bool] = None
    show_email: Optional[bool] = None
    show_location: Optional[bool] = None
    company_mode: Optional[str] = None
    company_replacement: Optional[str] = None
    project_mode: Optional[str] = None
    client_name_mode: Optional[str] = None
    visual_theme: Optional[str] = None


@router.post("/bulk-generate")
async def bulk_generate_resumes(body: BulkGenerateIn, actor: Actor = Depends(get_actor)):
    if body.output_format not in ("pdf", "docx"):
        raise HTTPException(400, "output_format must be 'pdf' or 'docx'")
    if body.visual_theme is not None and body.visual_theme not in _VALID_THEMES:
        raise HTTPException(400, f"visual_theme must be one of {sorted(_VALID_THEMES)}")
    if not body.candidate_ids:
        raise HTTPException(400, "candidate_ids must be a non-empty list")

    per_candidate_body = GenerateIn(
        template_id=body.template_id, name_format=body.name_format, show_mobile=body.show_mobile,
        show_email=body.show_email, show_location=body.show_location, company_mode=body.company_mode,
        company_replacement=body.company_replacement, project_mode=body.project_mode,
        client_name_mode=body.client_name_mode, visual_theme=body.visual_theme, output_format=body.output_format,
    )

    results = []
    for cid in body.candidate_ids:
        try:
            row, _ = await _generate_one(cid, per_candidate_body, actor)
            results.append({
                "candidate_id": cid, "generated_resume_id": str(row["id"]),
                "status": row["generation_status"], "error": row["error_message"],
            })
        except HTTPException as exc:
            results.append({"candidate_id": cid, "generated_resume_id": None, "status": "failed", "error": exc.detail})
        except Exception as exc:
            results.append({"candidate_id": cid, "generated_resume_id": None, "status": "failed", "error": str(exc)})

    succeeded = sum(1 for r in results if r["status"] == "completed")
    return {"total": len(results), "succeeded": succeeded, "failed": len(results) - succeeded, "results": results}


@router.get("/candidates/{candidate_id}/versions")
async def list_versions(candidate_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT gr.*, u.full_name AS generated_by_name, cl.name AS client_name, r.title AS requisition_title
               FROM generated_resumes gr
               LEFT JOIN users u ON u.id = gr.generated_by
               LEFT JOIN clients cl ON cl.id = gr.client_id
               LEFT JOIN requisitions r ON r.id = gr.requisition_id
               WHERE gr.candidate_id=$1 AND gr.tenant_id=$2
               ORDER BY gr.generated_at DESC""",
            candidate_id, actor.tenant_id)
    return [dict(r) for r in rows]


@router.get("/{generated_id}/download")
async def download_generated(generated_id: str, actor: Actor = Depends(get_actor)):
    """Authenticated, tenant-scoped download — never a raw static path.
    Original resume file is never reachable through this endpoint at all;
    this only ever serves rows from generated_resumes."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM generated_resumes WHERE id=$1 AND tenant_id=$2", generated_id, actor.tenant_id)
    if not row or row["generation_status"] != "completed":
        raise HTTPException(404, "Generated resume not found")
    path = Path(row["file_path"])
    if not path.exists():
        raise HTTPException(404, "Generated file is missing from storage")
    data = path.read_bytes()
    ext = row["output_format"]
    media_type = "application/pdf" if ext == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", row["display_name"] or "resume")
    filename = f"{safe_name}_{row['template_name'].replace(' ', '_')}.{ext}"
    return Response(content=data, media_type=media_type,
                     headers={"Content-Disposition": f'attachment; filename="{filename}"'})
