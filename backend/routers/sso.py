"""SSO — Google OAuth2 login."""
import os, httpx, secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
import jwt as pyjwt
import db
from deps import get_actor

router = APIRouter(prefix="/auth/sso", tags=["sso"])

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://187.127.179.128/api/auth/sso/google/callback")
JWT_SECRET   = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
FRONTEND_URL  = os.getenv("FRONTEND_URL", "http://187.127.179.128")

def is_configured(): return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

@router.get("/google")
async def google_login():
    """Redirect to Google OAuth consent screen."""
    if not is_configured():
        raise HTTPException(503, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set in .env")
    state = secrets.token_urlsafe(16)
    params = (f"client_id={GOOGLE_CLIENT_ID}&redirect_uri={REDIRECT_URI}"
              f"&response_type=code&scope=openid+email+profile&state={state}")
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")

@router.get("/google/callback")
async def google_callback(code: str, state: str = ""):
    """Handle Google OAuth callback."""
    if not is_configured():
        raise HTTPException(503, "Google OAuth not configured")
    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
        token_r = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code, "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": REDIRECT_URI, "grant_type": "authorization_code"
        })
        tokens = token_r.json()
        if "error" in tokens:
            raise HTTPException(400, f"OAuth error: {tokens['error']}")
        # Get user info
        user_r = await client.get("https://www.googleapis.com/oauth2/v3/userinfo",
                                   headers={"Authorization": f"Bearer {tokens['access_token']}"})
        guser = user_r.json()
    email = guser.get("email", "")
    google_id = guser.get("sub", "")
    name = guser.get("name", email.split("@")[0])
    avatar = guser.get("picture", "")
    async with db.system_conn() as conn:
        # Find or create user
        user = await conn.fetchrow(
            "SELECT u.*, t.id AS t_id FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=$1 LIMIT 1",
            email)
        if not user:
            # Auto-create as recruiter in first tenant
            tenant = await conn.fetchrow("SELECT id FROM tenants LIMIT 1")
            if not tenant:
                raise HTTPException(404, "No tenant found")
            user = await conn.fetchrow("""
                INSERT INTO users (tenant_id,email,password_hash,full_name,role,google_id,avatar_url,auth_provider)
                VALUES ($1,$2,'sso-google',$3,'recruiter',$4,$5,'google')
                RETURNING *, $1 AS t_id
            """, tenant["id"], email, name, google_id, avatar)
        else:
            await conn.execute("UPDATE users SET google_id=$1, avatar_url=$2 WHERE id=$3",
                               google_id, avatar, user["id"])
    # Issue JWT
    import datetime
    payload = {"sub": str(user["id"]), "tenant_id": str(user["t_id"] or user["tenant_id"]),
               "role": user["role"], "email": user["email"], "full_name": user["full_name"],
               "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=8)}
    token = pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return RedirectResponse(f"{FRONTEND_URL}/sso-callback?token={token}")

@router.get("/status")
async def sso_status():
    return {"google_sso": is_configured(),
            "setup_url": "/auth/sso/google",
            "config_needed": [] if is_configured() else ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]}
