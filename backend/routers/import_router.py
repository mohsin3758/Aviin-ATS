"""P38: Bulk CSV Import - minimal safe version."""
import csv, io
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, Response
import db
from deps import Actor, get_actor

import_router = APIRouter(prefix="/import", tags=["import"])

@import_router.post("/candidates")
async def import_candidates(file: UploadFile=File(...), actor: Actor=Depends(get_actor)):
    content = (await file.read()).decode("utf-8", "ignore")
    reader = csv.DictReader(io.StringIO(content))
    created = updated = errors = 0
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
                    await conn.execute(
                        "UPDATE candidates SET full_name=$1, total_exp_mo=$2 WHERE id=$3",
                        name, exp_mo, existing["id"])
                    updated += 1
                else:
                    await conn.execute(
                        """INSERT INTO candidates (tenant_id,full_name,email,phone,location,
                           total_exp_mo,current_employer,skills,source)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,"csv_import")""",
                        actor.tenant_id, name, email or None,
                        (row.get("phone") or "").strip() or None,
                        (row.get("location") or "").strip() or None,
                        exp_mo, (row.get("current_employer") or "").strip() or None, skills)
                    created += 1
            except Exception as e:
                errors += 1
                error_list.append({"row": i, "error": str(e)[:100]})
    return {"created": created, "updated": updated, "errors": errors, "error_details": error_list[:20]}

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
    created = updated = errors = 0
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
                    await conn.execute("UPDATE candidates SET full_name=$1, total_exp_mo=$2 WHERE id=$3",
                                       name, exp_mo, existing["id"])
                    updated += 1
                else:
                    await conn.execute("""
                        INSERT INTO candidates (tenant_id,full_name,email,phone,location,
                          total_exp_mo,current_employer,skills,source)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'excel_import')
                    """, actor.tenant_id, name, email or None,
                         str(d.get("phone","")).strip() or None,
                         str(d.get("location","")).strip() or None,
                         exp_mo, str(d.get("current_employer","")).strip() or None, skills)
                    created += 1
            except Exception as e:
                errors += 1; errs.append({"row":i,"error":str(e)[:80]})
    return {"created":created,"updated":updated,"errors":errors,"error_details":errs[:20]}

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
