"""SSO — Google OAuth2 login."""
import os, httpx, secrets, datetime
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
    """Redirect to Google OAuth consent screen.

    Real, previously-live gap found and fixed (2026-09-02 QA sweep,
    token audit): a real `state` value was generated for the standard
    OAuth2 CSRF-protection parameter, but the callback below never
    validated it against anything - there was nowhere to check it
    against, since it was never stored anywhere. Without this, the flow
    is exploitable as a genuine login-CSRF: an attacker can capture a
    real, unused authorization code for THEIR OWN Google account, get a
    victim to click a link carrying that code, and the victim's browser
    would complete the exchange and receive a real JWT logged in AS the
    attacker's account - not a theoretical risk, since this callback
    both auto-creates a user and issues a session token directly.
    Confirmed via the real, live .env that Google SSO is currently
    unconfigured in production (GOOGLE_CLIENT_ID absent, this whole
    router 503s immediately) - not currently exploitable, but a real,
    foreseeable gap the moment SSO is ever turned on, fixed now rather
    than left for that day. Standard, stateless fix: the state value is
    embedded in a short-lived (10 min), signed JWT set as an httponly
    cookie on this redirect, then verified against the query-param
    state the callback receives back from Google - reusing this app's
    own existing JWT_SECRET/pyjwt infrastructure rather than adding a
    new dependency or a server-side session store.
    """
    if not is_configured():
        raise HTTPException(503, "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set in .env")
    state = secrets.token_urlsafe(16)
    state_jwt = pyjwt.encode(
        {"state": state, "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=10)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    params = (f"client_id={GOOGLE_CLIENT_ID}&redirect_uri={REDIRECT_URI}"
              f"&response_type=code&scope=openid+email+profile&state={state}")
    redirect = RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
    redirect.set_cookie("sso_state", state_jwt, max_age=600, httponly=True, samesite="lax")
    return redirect

@router.get("/google/callback")
async def google_callback(code: str, request: Request, state: str = ""):
    """Handle Google OAuth callback.

    Note on the fix below: this function returns its own RedirectResponse
    on success — a FastAPI gotcha means a directly-returned Response
    object bypasses any header/cookie change made via an injected
    `response: Response` dependency parameter, so the state cookie is
    cleared on the actual object being returned (below), not via an
    injected one. The cookie's own real 600s max_age is what cleans it
    up on any of the early-exit error paths here, which is sufficient —
    those paths reject the request before any state is trusted either
    way, so there is nothing further to protect by also deleting it.
    """
    if not is_configured():
        raise HTTPException(503, "Google OAuth not configured")
    cookie_jwt = request.cookies.get("sso_state")
    if not cookie_jwt:
        raise HTTPException(400, "Missing or expired OAuth state - please retry sign-in")
    try:
        cookie_payload = pyjwt.decode(cookie_jwt, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.PyJWTError:
        raise HTTPException(400, "Invalid or expired OAuth state - please retry sign-in")
    if not state or cookie_payload.get("state") != state:
        raise HTTPException(400, "OAuth state mismatch - please retry sign-in")
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
    payload = {"sub": str(user["id"]), "tenant_id": str(user["t_id"] or user["tenant_id"]),
               "role": user["role"], "email": user["email"], "full_name": user["full_name"],
               "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=8)}
    token = pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    redirect = RedirectResponse(f"{FRONTEND_URL}/sso-callback?token={token}")
    redirect.delete_cookie("sso_state")
    return redirect

@router.get("/status")
async def sso_status():
    return {"google_sso": is_configured(),
            "setup_url": "/auth/sso/google",
            "config_needed": [] if is_configured() else ["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REDIRECT_URI"]}
