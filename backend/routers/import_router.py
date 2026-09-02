"""P38: Bulk CSV Import - minimal safe version."""
import csv, io, asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
import db
from deps import Actor, get_actor
from services import candidate_ownership as ownership
from services import activity_events
from services import source_attribution

import_router = APIRouter(prefix="/import", tags=["import"])

@import_router.post("/candidates")
async def import_candidates(file: UploadFile=File(...), actor: Actor=Depends(get_actor)):
    from routers.intelligence import auto_score_candidate_bg
    content = (await file.read()).decode("utf-8", "ignore")
    reader = csv.DictReader(io.StringIO(content))
    created = updated = errors = skipped_owned = 0
    error_list = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        for i, row in enumerate(reader, 1):
            try:
                name = (row.get("full_name") or row.get("name") or "").strip()
                email = (row.get("email") or "").strip().lower()
                if not name:
                    errors += 1
                    error_list.append({"row": i, "error": "Missing full_name"})
                    continue
                exp_mo = int(float(row.get("total_exp_years", 0) or 0) * 12)
                skills = [s.strip() for s in (row.get("skills", "") or "").split(";") if s.strip()]
                existing = None
                if email:
                    existing = await conn.fetchrow(
                        "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2",
                        email, actor.tenant_id)
                if existing:
                    # Individual recruiter ownership (rule 11): a bulk-
                    # import row hitting an already-owned candidate must
                    # not silently rewrite their record for a different
                    # recruiter — this update was previously unconditional
                    # (not even COALESCE'd, unlike every other intake path
                    # in this codebase), so any importer could clobber
                    # someone else's owned candidate's name outright.
                    # Unowned/expired -> this importer legitimately claims
                    # it; owned by someone else -> skip the update entirely
                    # (blocked_attempt logged by claim_ownership itself).
                    claim = {"claimed": True}
                    if actor.user_id and actor.email:
                        claim = await ownership.claim_ownership(
                            conn, actor.tenant_id, str(existing["id"]), str(actor.user_id), actor.email, "bulk_upload",
                        )
                    if claim["claimed"]:
                        await conn.execute(
                            "UPDATE candidates SET "
                            "full_name=COALESCE(NULLIF(full_name,''),$1), "
                            "total_exp_mo=CASE WHEN total_exp_mo=0 AND $2>0 THEN $2 ELSE total_exp_mo END "
                            "WHERE id=$3",
                            name, exp_mo, existing["id"])
                        updated += 1
                    else:
                        skipped_owned += 1
                else:
                    new_id = await conn.fetchval(
                        """INSERT INTO candidates (tenant_id,full_name,email,phone,location,
                           total_exp_mo,current_employer,skills,source)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'csv_import') RETURNING id""",
                        actor.tenant_id, name, email or None,
                        (row.get("phone") or "").strip() or None,
                        (row.get("location") or "").strip() or None,
                        exp_mo, (row.get("current_employer") or "").strip() or None, skills)
                    # HARD RULE #12 — was missing on this path entirely
                    # (found in the 2026-08-09 BGV audit).
                    await conn.execute(
                        "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
                        "VALUES ($1,$2,'resume_processing','bulk_import',TRUE,$3)",
                        actor.tenant_id, new_id, f"Added via CSV bulk import by {actor.user_id}.")
                    await source_attribution.record_source_attribution(conn, actor.tenant_id, str(new_id), 'csv_import')
                    # 2026-09-02 gap-audit fix: bulk import never auto-scored
                    # at all before this. Fire-and-forget per row, same
                    # convention as every other intake path — a large import
                    # queues many background scoring tasks rather than
                    # blocking the import itself on any of them.
                    asyncio.create_task(auto_score_candidate_bg(actor.tenant_id, str(new_id)))
                    # Individual recruiter ownership (2026-08-11): whoever
                    # runs the bulk import individually owns every new
                    # candidate it creates for 30 days (never the existing-
                    # row UPDATE branch above — an update never transfers
                    # ownership per the business rule).
                    if actor.user_id and actor.email:
                        await ownership.claim_ownership(
                            conn, actor.tenant_id, str(new_id), str(actor.user_id), actor.email, "bulk_upload",
                        )
                        await activity_events.log_recruiter_activity(
                            conn, actor.tenant_id, str(actor.user_id), activity_events.SOURCED, candidate_id=str(new_id),
                        )
                    created += 1
            except Exception as e:
                errors += 1
                error_list.append({"row": i, "error": str(e)[:100]})
    return {"created": created, "updated": updated, "skipped_owned": skipped_owned, "errors": errors, "error_details": error_list[:20]}

@import_router.get("/template/candidates")
async def candidate_import_template(actor: Actor=Depends(get_actor)):
    header = "full_name,email,phone,location,total_exp_years,current_employer,skills"
    row1 = "Rahul Verma,rahul@example.com,9876543210,Bengaluru,5,Infosys,Python;FastAPI"
    row2 = "Priya Sharma,priya@example.com,9876543211,Hyderabad,3,TCS,React;JavaScript"
    content = header + "\n" + row1 + "\n" + row2 + "\n"
    return Response(content=content, media_type="text/csv",
                    headers={"Content-Disposition": "attachment; filename=template.csv"})

@import_router.post("/candidates/excel")
async def import_excel(file: UploadFile = File(...), actor: Actor = Depends(get_actor)):
    """Import candidates from .xlsx file."""
    from routers.intelligence import auto_score_candidate_bg
    try:
        import openpyxl, io as _io
    except ImportError:
        raise HTTPException(503, "openpyxl not installed")
    wb = openpyxl.load_workbook(_io.BytesIO(await file.read()), read_only=True)
    ws = wb.active
    rows_iter = iter(ws.rows)
    header = [str(c.value or "").lower().strip().replace(" ", "_") for c in next(rows_iter)]
    aliases = {"name":"full_name","experience":"total_exp_years","exp":"total_exp_years",
               "company":"current_employer","skill":"skills","skill_set":"skills"}
    header = [aliases.get(h, h) for h in header]
    created = updated = errors = skipped_owned = 0
    errs = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        for i, row in enumerate(rows_iter, 2):
            try:
                d = {header[j]: (cell.value or "") for j, cell in enumerate(row) if j < len(header)}
                name  = str(d.get("full_name") or "").strip()
                email = str(d.get("email") or "").strip().lower()
                if not name:
                    errors += 1; errs.append({"row":i,"error":"Missing name"}); continue
                exp_mo = int(float(str(d.get("total_exp_years") or 0).replace("yr","").strip() or 0) * 12)
                skills = [s.strip() for s in str(d.get("skills","")).replace(";",",").split(",") if s.strip()]
                existing = await conn.fetchrow(
                    "SELECT id FROM candidates WHERE email=$1 AND tenant_id=$2", email, actor.tenant_id
                ) if email else None
                if existing:
                    # Individual recruiter ownership (rule 11) — same
                    # block-entirely-on-conflict treatment as the CSV path.
                    claim = {"claimed": True}
                    if actor.user_id and actor.email:
                        claim = await ownership.claim_ownership(
                            conn, actor.tenant_id, str(existing["id"]), str(actor.user_id), actor.email, "bulk_upload",
                        )
                    if claim["claimed"]:
                        await conn.execute(
                            "UPDATE candidates SET "
                            "full_name=COALESCE(NULLIF(full_name,''),$1), "
                            "total_exp_mo=CASE WHEN total_exp_mo=0 AND $2>0 THEN $2 ELSE total_exp_mo END "
                            "WHERE id=$3",
                            name, exp_mo, existing["id"])
                        updated += 1
                    else:
                        skipped_owned += 1
                else:
                    new_id = await conn.fetchval("""
                        INSERT INTO candidates (tenant_id,full_name,email,phone,location,
                          total_exp_mo,current_employer,skills,source)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'excel_import') RETURNING id
                    """, actor.tenant_id, name, email or None,
                         str(d.get("phone","")).strip() or None,
                         str(d.get("location","")).strip() or None,
                         exp_mo, str(d.get("current_employer","")).strip() or None, skills)
                    # HARD RULE #12 — was missing on this path entirely
                    # (found in the 2026-08-09 BGV audit).
                    await conn.execute(
                        "INSERT INTO consent_records (tenant_id,candidate_id,data_category,channel,consent_given,consent_text) "
                        "VALUES ($1,$2,'resume_processing','bulk_import',TRUE,$3)",
                        actor.tenant_id, new_id, f"Added via Excel bulk import by {actor.user_id}.")
                    await source_attribution.record_source_attribution(conn, actor.tenant_id, str(new_id), 'excel_import')
                    asyncio.create_task(auto_score_candidate_bg(actor.tenant_id, str(new_id)))
                    # Same individual-ownership claim as the CSV path above.
                    if actor.user_id and actor.email:
                        await ownership.claim_ownership(
                            conn, actor.tenant_id, str(new_id), str(actor.user_id), actor.email, "bulk_upload",
                        )
                        await activity_events.log_recruiter_activity(
                            conn, actor.tenant_id, str(actor.user_id), activity_events.SOURCED, candidate_id=str(new_id),
                        )
                    created += 1
            except Exception as e:
                errors += 1; errs.append({"row":i,"error":str(e)[:80]})
    return {"created":created,"updated":updated,"skipped_owned":skipped_owned,"errors":errors,"error_details":errs[:20]}

@import_router.get("/template/excel")
async def excel_template(actor: Actor = Depends(get_actor)):
    try:
        import openpyxl, io as _io
        from fastapi.responses import Response as R
    except ImportError:
        raise HTTPException(503, "openpyxl not installed")
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Candidates"
    ws.append(["full_name","email","phone","location","total_exp_years","current_employer","skills"])
    ws.append(["Rahul Verma","rahul@example.com","9876543210","Bengaluru",5,"Infosys","Python;FastAPI"])
    ws.append(["Priya Sharma","priya@example.com","9876543211","Hyderabad",3,"TCS","React;JavaScript"])
    buf = _io.BytesIO(); wb.save(buf)
    return R(content=buf.getvalue(),
             media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             headers={"Content-Disposition":"attachment; filename=candidates_template.xlsx"})
