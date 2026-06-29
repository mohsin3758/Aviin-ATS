"""2FA — TOTP via pyotp."""
import io, base64, secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor

router = APIRouter(prefix="/2fa", tags=["2fa"])

class TokenIn(BaseModel):
    token: str

@router.post("/setup")
async def setup(actor: Actor = Depends(get_actor)):
    try: import pyotp
    except ImportError: raise HTTPException(503, "pyotp not installed")
    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(name=actor.email, issuer_name="AVIIN ATS")
    qr_b64 = None
    try:
        import qrcode
        buf = io.BytesIO()
        qrcode.make(uri).save(buf, format="PNG")
        qr_b64 = base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        pass
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("UPDATE users SET totp_secret=$1 WHERE id=$2", secret, actor.user_id)
    return {"secret": secret, "otp_uri": uri, "qr_base64": qr_b64,
            "steps": ["1. Scan QR in Google Authenticator", "2. Enter 6-digit code below", "3. POST /2fa/enable"]}

@router.post("/enable")
async def enable(body: TokenIn, actor: Actor = Depends(get_actor)):
    try: import pyotp
    except ImportError: raise HTTPException(503, "pyotp not installed")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT totp_secret FROM users WHERE id=$1", actor.user_id)
        if not row or not row["totp_secret"]: raise HTTPException(400, "Run /2fa/setup first")
        if not pyotp.TOTP(row["totp_secret"]).verify(body.token, valid_window=1):
            raise HTTPException(400, "Invalid token")
        codes = [secrets.token_hex(4).upper() for _ in range(8)]
        await conn.execute("UPDATE users SET totp_enabled=true, totp_backup_codes=$1 WHERE id=$2",
                           codes, actor.user_id)
    return {"enabled": True, "backup_codes": codes, "warning": "Save these — shown once only"}

@router.post("/disable")
async def disable(body: TokenIn, actor: Actor = Depends(get_actor)):
    try: import pyotp
    except ImportError: raise HTTPException(503, "pyotp not installed")
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("SELECT totp_secret FROM users WHERE id=$1", actor.user_id)
        if not row or not row["totp_secret"]: raise HTTPException(400, "2FA not enabled")
        if not pyotp.TOTP(row["totp_secret"]).verify(body.token, valid_window=1):
            raise HTTPException(400, "Invalid token")
        await conn.execute(
            "UPDATE users SET totp_enabled=false, totp_secret=NULL, totp_backup_codes='{}' WHERE id=$1",
            actor.user_id)
    return {"disabled": True}

@router.post("/verify")
async def verify(body: TokenIn, actor: Actor = Depends(get_actor)):
    try: import pyotp
    except ImportError: return {"valid": True, "note": "pyotp not installed"}
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT totp_secret, totp_enabled, totp_backup_codes FROM users WHERE id=$1",
            actor.user_id)
        if not row or not row["totp_enabled"]: return {"valid": True, "note": "2FA not enabled"}
        if pyotp.TOTP(row["totp_secret"]).verify(body.token, valid_window=1):
            return {"valid": True}
        codes = list(row["totp_backup_codes"] or [])
        if body.token.upper() in codes:
            codes.remove(body.token.upper())
            await conn.execute("UPDATE users SET totp_backup_codes=$1 WHERE id=$2", codes, actor.user_id)
            return {"valid": True, "used_backup": True, "remaining": len(codes)}
        raise HTTPException(401, "Invalid 2FA token")

@router.get("/status")
async def status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow(
            "SELECT totp_enabled, array_length(totp_backup_codes,1) backup_count FROM users WHERE id=$1",
            actor.user_id)
    pyotp_ok = True
    try: import pyotp
    except ImportError: pyotp_ok = False
    return {"enabled": bool(row["totp_enabled"]) if row else False,
            "backup_codes_remaining": row["backup_count"] or 0,
            "pyotp_installed": pyotp_ok}
