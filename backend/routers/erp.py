"""P12 ERP: Timesheet + Invoice + Payroll endpoints.

HARD RULE #11: Aadhaar/PAN/PF/bank-account columns ALWAYS encrypted at rest
via pgcrypto pgp_sym_encrypt. The encryption key is passed per-connection as
SET app.encrypt_key — never stored in the schema or returned in API responses.

Role-gated (admin/manager only) and audit-logged throughout, per the
2026-08-10 audit finding that every endpoint here previously had neither —
any authenticated user of any role could approve timesheets, generate/pay
client invoices, run payroll, and read/write contractor PII, with zero
event_outbox/audit_log trace of any of it (HARD RULE #5 gap).
"""

import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
import events
from deps import Actor, get_actor, require_role

router = APIRouter(prefix="/erp", tags=["erp"])

# Encryption key from env (set per-tenant in a real deployment; using global for demo)
ERP_ENCRYPT_KEY = os.getenv("ERP_ENCRYPT_KEY", "erp_demo_key_change_in_prod")

_FINANCE_ROLES = require_role("admin", "manager")


async def _set_encrypt_key(conn) -> None:
    """Set encryption key for the current transaction (pgcrypto HARD RULE #11)."""
    await conn.execute("SELECT set_config('app.encrypt_key', $1, true)", ERP_ENCRYPT_KEY)


# ─── Contractor PII (HARD RULE #11 encrypted fields) ────────────────────────

class PiiUpsert(BaseModel):
    candidate_id: str
    aadhaar: Optional[str] = None
    pan: Optional[str] = None
    pf_number: Optional[str] = None
    bank_account: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None


@router.post("/contractor-pii")
async def upsert_contractor_pii(body: PiiUpsert, actor: Actor = Depends(_FINANCE_ROLES)):
    """Stores sensitive fields encrypted. Returns row without decrypted values."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _set_encrypt_key(conn)
        row = await conn.fetchrow(
            """INSERT INTO contractor_pii
               (tenant_id, candidate_id, aadhaar_enc, pan_enc, pf_number_enc, bank_account_enc, bank_ifsc, bank_name)
               VALUES ($1, $2,
                 CASE WHEN $3::text IS NOT NULL THEN erp_encrypt($3::text) END,
                 CASE WHEN $4::text IS NOT NULL THEN erp_encrypt($4::text) END,
                 CASE WHEN $5::text IS NOT NULL THEN erp_encrypt($5::text) END,
                 CASE WHEN $6::text IS NOT NULL THEN erp_encrypt($6::text) END,
                 $7, $8)
               ON CONFLICT (tenant_id, candidate_id) DO UPDATE SET
                 aadhaar_enc      = CASE WHEN $3::text IS NOT NULL THEN erp_encrypt($3::text) ELSE contractor_pii.aadhaar_enc END,
                 pan_enc          = CASE WHEN $4::text IS NOT NULL THEN erp_encrypt($4::text) ELSE contractor_pii.pan_enc END,
                 pf_number_enc    = CASE WHEN $5::text IS NOT NULL THEN erp_encrypt($5::text) ELSE contractor_pii.pf_number_enc END,
                 bank_account_enc = CASE WHEN $6::text IS NOT NULL THEN erp_encrypt($6::text) ELSE contractor_pii.bank_account_enc END,
                 bank_ifsc        = COALESCE($7, contractor_pii.bank_ifsc),
                 bank_name        = COALESCE($8, contractor_pii.bank_name),
                 updated_at       = now()
               RETURNING id, candidate_id, bank_ifsc, bank_name, updated_at""",
            actor.tenant_id, body.candidate_id,
            body.aadhaar, body.pan, body.pf_number, body.bank_account,
            body.bank_ifsc, body.bank_name,
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "contractor_pii.upserted",
            "contractor_pii", str(row["id"]), after={"candidate_id": body.candidate_id},
        )
    return {**dict(row), "note": "Aadhaar/PAN/PF/bank encrypted at rest (HARD RULE #11)"}


@router.get("/contractor-pii/{candidate_id}")
async def get_contractor_pii(candidate_id: str, actor: Actor = Depends(_FINANCE_ROLES)):
    """Returns metadata only — encrypted fields masked. Decryption requires explicit endpoint."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT id, candidate_id,
                      aadhaar_enc IS NOT NULL AS has_aadhaar,
                      pan_enc IS NOT NULL AS has_pan,
                      pf_number_enc IS NOT NULL AS has_pf,
                      bank_account_enc IS NOT NULL AS has_bank_account,
                      bank_ifsc, bank_name, updated_at
               FROM contractor_pii
               WHERE candidate_id = $1""",
            candidate_id,
        )
    if not row:
        raise HTTPException(404, "No PII record found")
    return dict(row)


# ─── Timesheets ────────────────────────────────────────────────────────────────

class TimesheetCreate(BaseModel):
    placement_id: str
    candidate_id: str
    client_id: Optional[str] = None
    week_start: str
    regular_hours: float = 0
    overtime_hours: float = 0
    notes: Optional[str] = None


class TimesheetApprove(BaseModel):
    status: str  # 'approved' or 'rejected'


@router.get("/timesheets")
async def list_timesheets(status: Optional[str] = None, actor: Actor = Depends(_FINANCE_ROLES)):
    where = "WHERE t.tenant_id = $1"
    params: list = [actor.tenant_id]
    if status:
        params.append(status)
        where += f" AND t.status = ${len(params)}"
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT t.id, t.placement_id, t.candidate_id, t.client_id,
                       t.week_start, t.week_end, t.regular_hours, t.overtime_hours,
                       t.total_hours, t.status, t.submitted_at, t.approved_at, t.notes,
                       c.full_name AS candidate_name, cl.name AS client_name
                FROM timesheets t
                JOIN candidates c ON c.id = t.candidate_id
                LEFT JOIN clients cl ON cl.id = t.client_id
                {where}
                ORDER BY t.week_start DESC""",
            *params,
        )
    return [dict(r) for r in rows]


@router.post("/timesheets")
async def create_timesheet(body: TimesheetCreate, actor: Actor = Depends(_FINANCE_ROLES)):
    # week_start is a plain str on the wire but asyncpg needs a real date
    # object to bind against the DATE column — never caught before because
    # this endpoint had zero UI/test callers until now.
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """INSERT INTO timesheets
               (tenant_id, placement_id, candidate_id, client_id, week_start,
                regular_hours, overtime_hours, notes)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               RETURNING id, status, week_start, week_end, total_hours""",
            actor.tenant_id, body.placement_id, body.candidate_id, body.client_id,
            date.fromisoformat(body.week_start), body.regular_hours, body.overtime_hours, body.notes,
        )
        await events.write_outbox(
            conn, actor.tenant_id, "timesheet.created",
            {"timesheet_id": str(row["id"]), "candidate_id": body.candidate_id},
            f"timesheet_created:{row['id']}",
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "timesheet.created",
            "timesheet", str(row["id"]), after={
                "status": row["status"], "week_start": str(row["week_start"]),
                "week_end": str(row["week_end"]), "total_hours": float(row["total_hours"]),
            },
        )
    return dict(row)


@router.post("/timesheets/{ts_id}/submit")
async def submit_timesheet(ts_id: str, actor: Actor = Depends(_FINANCE_ROLES)):
    # State machine: only draft/rejected timesheets can be (re)submitted.
    # Previously this was an unconditional UPDATE that could revert an
    # already-approved, already-billed, or already-paid timesheet back to
    # 'submitted' with no guard at all.
    async with db.tenant_conn(actor.tenant_id) as conn:
        current = await conn.fetchrow("SELECT status FROM timesheets WHERE id=$1", ts_id)
        if not current:
            raise HTTPException(404, "Timesheet not found")
        if current["status"] not in ("draft", "rejected"):
            raise HTTPException(
                400, f"Cannot submit a timesheet in status '{current['status']}' "
                     "(only draft or rejected timesheets can be submitted)"
            )
        row = await conn.fetchrow(
            "UPDATE timesheets SET status='submitted', submitted_at=now() WHERE id=$1 RETURNING id, status",
            ts_id,
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "timesheet.submitted",
            "timesheet", ts_id, before={"status": current["status"]}, after={"status": "submitted"},
        )
    return dict(row)


@router.post("/timesheets/{ts_id}/approve")
async def approve_timesheet(ts_id: str, body: TimesheetApprove, actor: Actor = Depends(_FINANCE_ROLES)):
    if body.status not in ("approved", "rejected"):
        raise HTTPException(400, "status must be 'approved' or 'rejected'")
    # State machine: approve/reject only applies to a timesheet currently
    # 'submitted'. Previously this was unconditional and could re-approve
    # (or reject) a timesheet already billed to a client or paid out —
    # reproduced live during the audit as a full un-bill/re-pay cycle with
    # the approval trail silently overwritten each time.
    async with db.tenant_conn(actor.tenant_id) as conn:
        current = await conn.fetchrow("SELECT status FROM timesheets WHERE id=$1", ts_id)
        if not current:
            raise HTTPException(404, "Timesheet not found")
        if current["status"] != "submitted":
            raise HTTPException(
                400, f"Cannot {body.status[:-1] if body.status=='approved' else 'reject'} a timesheet in "
                     f"status '{current['status']}' (must be 'submitted')"
            )
        row = await conn.fetchrow(
            """UPDATE timesheets SET status=$1, approved_by=$2, approved_at=now()
               WHERE id=$3 RETURNING id, status""",
            body.status, actor.user_id, ts_id,
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, f"timesheet.{body.status}",
            "timesheet", ts_id, before={"status": "submitted"}, after={"status": body.status},
        )
    return dict(row)


# ─── Invoices ─────────────────────────────────────────────────────────────────

@router.get("/invoices")
async def list_invoices(status: Optional[str] = None, actor: Actor = Depends(_FINANCE_ROLES)):
    where = ""
    params: list = [actor.tenant_id]
    if status:
        params.append(status)
        where = f"AND status = ${len(params)}"
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            f"""SELECT i.id, i.invoice_number, i.invoice_date, i.due_date,
                       i.subtotal, i.gst_amount, i.total_amount, i.status,
                       i.paid_at, cl.name AS client_name
                FROM invoices i
                JOIN clients cl ON cl.id = i.client_id
                WHERE i.tenant_id = $1 {where}
                ORDER BY i.invoice_date DESC""",
            *params,
        )
    return [dict(r) for r in rows]


class InvoiceGenerate(BaseModel):
    client_id: str
    period_start: str
    period_end: str
    gst_rate: float = 18.0


@router.post("/invoices/generate")
async def generate_invoice(body: InvoiceGenerate, actor: Actor = Depends(_FINANCE_ROLES)):
    """Auto-generate invoice from approved timesheets for a client/period."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT generate_invoice_from_timesheets($1,$2,$3,$4,$5) AS invoice_id",
            actor.tenant_id, body.client_id,
            date.fromisoformat(body.period_start), date.fromisoformat(body.period_end),
            body.gst_rate,
        )
        if row["invoice_id"] is None:
            # No approved timesheets for this client/period — the SQL
            # function now checks before consuming an invoice number,
            # instead of always creating a permanent ₹0 invoice.
            raise HTTPException(400, "No approved timesheets found for this client and period")
        await events.write_outbox(
            conn, actor.tenant_id, "invoice.generated",
            {"invoice_id": str(row["invoice_id"]), "client_id": body.client_id},
            f"invoice_generated:{row['invoice_id']}",
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "invoice.generated",
            "invoice", str(row["invoice_id"]), after={"client_id": body.client_id,
            "period_start": body.period_start, "period_end": body.period_end},
        )
    return {"invoice_id": str(row["invoice_id"])}


@router.post("/invoices/{inv_id}/mark-paid")
async def mark_invoice_paid(inv_id: str, actor: Actor = Depends(_FINANCE_ROLES)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        current = await conn.fetchrow("SELECT status FROM invoices WHERE id=$1", inv_id)
        if not current:
            raise HTTPException(404, "Invoice not found")
        if current["status"] == "paid":
            raise HTTPException(400, "Invoice is already marked paid")
        if current["status"] == "cancelled":
            raise HTTPException(400, "Cannot mark a cancelled invoice as paid")
        row = await conn.fetchrow(
            "UPDATE invoices SET status='paid', paid_at=now() WHERE id=$1 RETURNING id, status, paid_at",
            inv_id,
        )
        await events.write_audit(
            conn, actor.tenant_id, actor.user_id, "invoice.paid",
            "invoice", inv_id, before={"status": current["status"]}, after={"status": "paid"},
        )
    return dict(row)


# ─── Payroll ──────────────────────────────────────────────────────────────────

@router.get("/payroll-runs")
async def list_payroll_runs(actor: Actor = Depends(_FINANCE_ROLES)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT id, pay_period_start, pay_period_end, status,
                      total_gross, total_tds, total_pf, total_net, created_at
               FROM payroll_runs WHERE tenant_id = $1 ORDER BY pay_period_start DESC""",
            actor.tenant_id,
        )
    return [dict(r) for r in rows]


class PayrollRunCreate(BaseModel):
    pay_period_start: str
    pay_period_end: str


@router.post("/payroll-runs")
async def create_payroll_run(body: PayrollRunCreate, actor: Actor = Depends(_FINANCE_ROLES)):
    """Creates a payroll run and generates payslips from approved timesheets.

    Idempotent on two levels (2026-08-10 audit fix — a live double-pay of
    the same period was reproduced pre-fix): a real UNIQUE constraint on
    (tenant_id, pay_period_start, pay_period_end) rejects an exact-period
    retry with a clean 409, and each included timesheet is stamped with
    payroll_run_id so it can never be pulled into a second run under any
    period boundary, overlapping or not.
    """
    period_start = date.fromisoformat(body.pay_period_start)
    period_end = date.fromisoformat(body.pay_period_end)
    async with db.tenant_conn(actor.tenant_id) as conn:
        async with conn.transaction():
            try:
                run = await conn.fetchrow(
                    """INSERT INTO payroll_runs(tenant_id, pay_period_start, pay_period_end)
                       VALUES ($1,$2,$3) RETURNING id""",
                    actor.tenant_id, period_start, period_end,
                )
            except Exception as e:
                if "payroll_runs_period_uniq" in str(e):
                    raise HTTPException(409, "A payroll run already exists for this exact period")
                raise
            run_id = run["id"]

            # Build payslips from approved timesheets in period, excluding
            # any timesheet already claimed by an earlier payroll run.
            rows = await conn.fetch(
                """SELECT t.id AS timesheet_id, t.candidate_id, t.placement_id,
                          SUM(t.total_hours) AS hours,
                          MAX(COALESCE(p.pay_rate, 0)) AS pay_rate
                   FROM timesheets t
                   JOIN placements p ON p.id = t.placement_id
                   WHERE t.tenant_id = $1 AND t.status = 'approved'
                     AND t.payroll_run_id IS NULL
                     AND t.week_start >= $2 AND t.week_end <= $3
                   GROUP BY t.id, t.candidate_id, t.placement_id""",
                actor.tenant_id, period_start, period_end,
            )

            total_gross = total_tds = total_pf = 0.0
            for r in rows:
                gross = float(r["hours"]) * float(r["pay_rate"])
                pf = gross * 0.12        # 12% PF (employee share)
                tds = gross * 0.10       # 10% TDS flat (simplified)
                await conn.execute(
                    """INSERT INTO payslips
                       (tenant_id, payroll_run_id, candidate_id, placement_id,
                        gross_pay, tds_amount, pf_amount, hours_worked, pay_rate)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                    actor.tenant_id, run_id, r["candidate_id"], r["placement_id"],
                    gross, tds, pf, r["hours"], r["pay_rate"],
                )
                await conn.execute(
                    "UPDATE timesheets SET payroll_run_id=$1 WHERE id=$2",
                    run_id, r["timesheet_id"],
                )
                total_gross += gross
                total_tds += tds
                total_pf += pf

            await conn.execute(
                """UPDATE payroll_runs
                   SET total_gross=$1, total_tds=$2, total_pf=$3
                   WHERE id=$4""",
                total_gross, total_tds, total_pf, run_id,
            )
            await events.write_outbox(
                conn, actor.tenant_id, "payroll_run.created",
                {"payroll_run_id": str(run_id), "payslips_generated": len(rows)},
                f"payroll_run_created:{run_id}",
            )
            await events.write_audit(
                conn, actor.tenant_id, actor.user_id, "payroll_run.created",
                "payroll_run", str(run_id),
                after={"period_start": body.pay_period_start, "period_end": body.pay_period_end,
                       "total_gross": total_gross, "payslips_generated": len(rows)},
            )
    return {"payroll_run_id": str(run_id), "payslips_generated": len(rows),
            "total_gross": total_gross, "total_net": total_gross - total_tds - total_pf}


@router.get("/payroll-runs/{run_id}/payslips")
async def list_payslips(run_id: str, actor: Actor = Depends(_FINANCE_ROLES)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            """SELECT ps.id, ps.candidate_id, c.full_name AS candidate_name,
                      ps.gross_pay, ps.tds_amount, ps.pf_amount, ps.net_pay,
                      ps.hours_worked, ps.pay_rate
               FROM payslips ps
               JOIN candidates c ON c.id = ps.candidate_id
               WHERE ps.payroll_run_id = $1
               ORDER BY c.full_name""",
            run_id,
        )
    return [dict(r) for r in rows]
