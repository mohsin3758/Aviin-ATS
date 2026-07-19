"""User email signatures — manage and assign per-account"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/signatures", tags=["signatures"])


class SigBody(BaseModel):
    name: str = "My Signature"
    html: str = ""


class SigDefaults(BaseModel):
    sig_new_mail: Optional[str] = None   # signature id or null
    sig_reply: Optional[str] = None      # signature id or null


@router.get("")
async def list_sigs(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT id, name, html, created_at, updated_at "
            "FROM user_signatures WHERE user_id=$1 AND tenant_id=$2 ORDER BY updated_at DESC",
            actor.user_id, actor.tenant_id)
        return [dict(r) for r in rows]


@router.post("")
async def create_sig(body: SigBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "INSERT INTO user_signatures (user_id,tenant_id,name,html) VALUES($1,$2,$3,$4) RETURNING id",
            actor.user_id, actor.tenant_id, body.name, body.html)
        return {"id": str(row["id"]), "created": True}


@router.put("/{sig_id}")
async def update_sig(sig_id: str, body: SigBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            "UPDATE user_signatures SET name=$1,html=$2,updated_at=NOW() "
            "WHERE id=$3 AND user_id=$4 AND tenant_id=$5 RETURNING id",
            body.name, body.html, sig_id, actor.user_id, actor.tenant_id)
        if not r:
            raise HTTPException(404, "Signature not found")
        return {"updated": True}


@router.delete("/{sig_id}")
async def delete_sig(sig_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        # Clear references in accounts first
        await conn.execute(
            "UPDATE user_email_accounts SET sig_new_mail=NULL WHERE sig_new_mail=$1 AND user_id=$2",
            sig_id, actor.user_id)
        await conn.execute(
            "UPDATE user_email_accounts SET sig_reply=NULL WHERE sig_reply=$1 AND user_id=$2",
            sig_id, actor.user_id)
        await conn.execute(
            "DELETE FROM user_signatures WHERE id=$1 AND user_id=$2 AND tenant_id=$3",
            sig_id, actor.user_id, actor.tenant_id)
        return {"deleted": True}


@router.patch("/accounts/{acc_id}/defaults")
async def set_account_sig_defaults(acc_id: str, body: SigDefaults, actor: Actor = Depends(get_actor)):
    """Set which signature is used for new mail vs replies for a specific account"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        r = await conn.fetchrow(
            "UPDATE user_email_accounts SET sig_new_mail=$1, sig_reply=$2 "
            "WHERE id=$3 AND user_id=$4 AND tenant_id=$5 RETURNING id",
            body.sig_new_mail or None, body.sig_reply or None,
            acc_id, actor.user_id, actor.tenant_id)
        if not r:
            raise HTTPException(404, "Account not found")
        return {"updated": True}


@router.get("/for-account/{acc_id}")
async def get_account_sigs(acc_id: str, actor: Actor = Depends(get_actor)):
    """Get the signatures assigned to a specific account (for compose auto-fill)"""
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            """SELECT a.sig_new_mail, a.sig_reply,
               s1.html AS new_mail_html, s1.name AS new_mail_name,
               s2.html AS reply_html, s2.name AS reply_name
               FROM user_email_accounts a
               LEFT JOIN user_signatures s1 ON s1.id=a.sig_new_mail
               LEFT JOIN user_signatures s2 ON s2.id=a.sig_reply
               WHERE a.id=$1 AND a.user_id=$2""",
            acc_id, actor.user_id)
        if not row:
            return {"new_mail": None, "reply": None}
        return {
            "new_mail": {"id": str(row["sig_new_mail"]), "html": row["new_mail_html"], "name": row["new_mail_name"]} if row["sig_new_mail"] else None,
            "reply": {"id": str(row["sig_reply"]), "html": row["reply_html"], "name": row["reply_name"]} if row["sig_reply"] else None,
        }
