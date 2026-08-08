"""Free job-board distribution: LinkedIn/Naukri/Indeed links plus the full
70+ portal directory (services/job_portals.py) for one-click sharing."""
import os
from urllib.parse import urlencode, quote
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import db
from deps import Actor, get_actor
from services.job_portals import get_all_portals, build_share_links, portal_count, INTEGRATION_LABELS

router = APIRouter(prefix="/job-sharing", tags=["job-sharing"])
# Matches the convention already used in routers/offers.py and routers/nda.py.
BASE_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "https://ats.aviinjobs.com")

# Real Facebook Graph API posting (not the sharer.php dialog trick, which
# never lets a URL pre-fill post text - Meta anti-spam policy, unrelated
# to this key). Same pgcrypto pattern HARD RULE #11 already requires for
# Aadhaar/PAN/bank fields (see erp.py) - a Page Access Token is a real
# secret credential.
FB_ENCRYPT_KEY = os.getenv("FB_ENCRYPT_KEY", os.getenv("ERP_ENCRYPT_KEY", "erp_demo_key_change_in_prod"))
FB_GRAPH_VERSION = "v23.0"


async def _set_encrypt_key(conn) -> None:
    await conn.execute("SELECT set_config('app.encrypt_key', $1, true)", FB_ENCRYPT_KEY)


@router.get("/portals")
async def list_portals():
    """Full 70+ portal catalog, no requisition context - used for the
    directory/category browser before a job is selected."""
    return {"count": portal_count(), "portals": get_all_portals()}


# ─── Facebook Page: real automatic posting ────────────────────────────────────
class FacebookConnectBody(BaseModel):
    page_id: str
    page_access_token: str


@router.post("/facebook/connect")
async def facebook_connect(body: FacebookConnectBody, actor: Actor = Depends(get_actor)):
    """Validates the token against the Page it claims (a bad/expired token
    or wrong Page ID fails here, not silently at post-time) and stores it
    encrypted. One connection per tenant - reconnecting overwrites it."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"https://graph.facebook.com/{FB_GRAPH_VERSION}/{body.page_id}",
            params={"fields": "name", "access_token": body.page_access_token})
    if r.status_code != 200:
        detail = r.json().get("error", {}).get("message", "Facebook rejected this Page ID/token")
        raise HTTPException(400, f"Could not verify this Page: {detail}")
    page_name = r.json().get("name", body.page_id)

    async with db.tenant_conn(actor.tenant_id) as conn:
        await _set_encrypt_key(conn)
        await conn.execute("""
            INSERT INTO facebook_page_connections
              (tenant_id, page_id, page_name, page_access_token_enc, connected_by, is_active)
            VALUES ($1, $2, $3, pgp_sym_encrypt($4, current_setting('app.encrypt_key', true)), $5, TRUE)
            ON CONFLICT (tenant_id) DO UPDATE SET
              page_id=EXCLUDED.page_id, page_name=EXCLUDED.page_name,
              page_access_token_enc=EXCLUDED.page_access_token_enc,
              connected_by=EXCLUDED.connected_by, is_active=TRUE, updated_at=now()
        """, actor.tenant_id, body.page_id, page_name, body.page_access_token, actor.user_id)
    return {"connected": True, "page_id": body.page_id, "page_name": page_name}


@router.get("/facebook/status")
async def facebook_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT page_id, page_name, is_active, updated_at
            FROM facebook_page_connections WHERE tenant_id=$1
        """, actor.tenant_id)
    if not row or not row["is_active"]:
        return {"connected": False}
    return {"connected": True, "page_id": row["page_id"], "page_name": row["page_name"],
            "connected_at": row["updated_at"].isoformat()}


@router.delete("/facebook/disconnect")
async def facebook_disconnect(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE facebook_page_connections SET is_active=FALSE, updated_at=now() WHERE tenant_id=$1",
            actor.tenant_id)
    return {"disconnected": True}


class FacebookPostBody(BaseModel):
    req_id: str


@router.post("/facebook/post")
async def facebook_post(body: FacebookPostBody, actor: Actor = Depends(get_actor)):
    """The real thing: POST /{page-id}/feed with a fully custom message,
    genuinely automatic, no dialog, no paste. Requires facebook/connect
    to have been called first (own-Page Standard Access token - see
    sql/19_facebook_page_connection.sql for why no App Review is needed
    for this specific case)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _set_encrypt_key(conn)
        conn_row = await conn.fetchrow("""
            SELECT page_id, pgp_sym_decrypt(page_access_token_enc, current_setting('app.encrypt_key', true)) AS token
            FROM facebook_page_connections WHERE tenant_id=$1 AND is_active=TRUE
        """, actor.tenant_id)
        if not conn_row:
            raise HTTPException(400, "No Facebook Page connected - go to Settings to connect one first")

        req = await conn.fetchrow(
            "SELECT * FROM requisitions WHERE id=$1 AND tenant_id=$2", body.req_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")

    title = req["title"]
    loc = req["location"] or "Bengaluru"
    skills = list(req["skills_required"] or [])
    desc = (req["description"] or f"{title} opportunity")[:400]
    job_url = f"{BASE_URL}/careers/{body.req_id}"
    message = f"We're hiring: {title}\n\nLocation: {loc} | {req['employment_type'] or 'Full-time'}\n{desc}\n\nSkills: {', '.join(skills[:8])}\n\nApply now: {job_url}"

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"https://graph.facebook.com/{FB_GRAPH_VERSION}/{conn_row['page_id']}/feed",
            data={"message": message, "link": job_url, "access_token": conn_row["token"]})
    if r.status_code != 200:
        detail = r.json().get("error", {}).get("message", "Facebook post failed")
        raise HTTPException(502, f"Facebook rejected the post: {detail}")

    post_id = r.json().get("id", "")  # format: {page_id}_{post_id}
    post_url = f"https://www.facebook.com/{post_id}" if post_id else f"https://www.facebook.com/{conn_row['page_id']}"

    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO job_shares (tenant_id,requisition_id,platform,posted_by,share_url)
            VALUES ($1,$2,'facebook',$3,$4) ON CONFLICT DO NOTHING
        """, actor.tenant_id, body.req_id, actor.user_id, post_url)

    return {"posted": True, "post_url": post_url}


# ─── Telegram channel: real automatic posting ─────────────────────────────────
# Same "zero-approval, zero-cost" tier as the Facebook Page integration
# above (sql/31_telegram_channel.sql) — a Telegram bot token has no
# review process at all, and posting to a channel the bot administers is
# a single Bot API call.
class TelegramConnectBody(BaseModel):
    bot_token: str
    chat_id: str


@router.post("/telegram/connect")
async def telegram_connect(body: TelegramConnectBody, actor: Actor = Depends(get_actor)):
    """Validates the bot token is real (via getMe) and that it can actually
    post to the given chat_id (via a real sendMessage) before storing
    anything — a bad token or a chat the bot isn't an admin of fails here,
    not silently at post-time."""
    async with httpx.AsyncClient(timeout=15) as client:
        me = await client.get(f"https://api.telegram.org/bot{body.bot_token}/getMe")
    if me.status_code != 200 or not me.json().get("ok"):
        raise HTTPException(400, "Telegram rejected this bot token")

    async with httpx.AsyncClient(timeout=15) as client:
        test = await client.post(
            f"https://api.telegram.org/bot{body.bot_token}/sendMessage",
            data={"chat_id": body.chat_id, "text": "✅ AVIIN ATS connected — job posts will appear here."})
    if test.status_code != 200 or not test.json().get("ok"):
        detail = test.json().get("description", "Telegram rejected this Channel/Chat ID — make sure the bot is added as an admin of the channel")
        raise HTTPException(400, detail)
    chat_info = test.json().get("result", {}).get("chat", {})
    channel_name = chat_info.get("title") or chat_info.get("username") or body.chat_id

    async with db.tenant_conn(actor.tenant_id) as conn:
        await _set_encrypt_key(conn)
        await conn.execute("""
            INSERT INTO telegram_channel_connections
              (tenant_id, chat_id, channel_name, bot_token_enc, connected_by, is_active)
            VALUES ($1, $2, $3, pgp_sym_encrypt($4, current_setting('app.encrypt_key', true)), $5, TRUE)
            ON CONFLICT (tenant_id) DO UPDATE SET
              chat_id=EXCLUDED.chat_id, channel_name=EXCLUDED.channel_name,
              bot_token_enc=EXCLUDED.bot_token_enc,
              connected_by=EXCLUDED.connected_by, is_active=TRUE, updated_at=now()
        """, actor.tenant_id, body.chat_id, channel_name, body.bot_token, actor.user_id)
    return {"connected": True, "chat_id": body.chat_id, "channel_name": channel_name}


@router.get("/telegram/status")
async def telegram_status(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            SELECT chat_id, channel_name, is_active, updated_at
            FROM telegram_channel_connections WHERE tenant_id=$1
        """, actor.tenant_id)
    if not row or not row["is_active"]:
        return {"connected": False}
    return {"connected": True, "chat_id": row["chat_id"], "channel_name": row["channel_name"],
            "connected_at": row["updated_at"].isoformat()}


@router.delete("/telegram/disconnect")
async def telegram_disconnect(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "UPDATE telegram_channel_connections SET is_active=FALSE, updated_at=now() WHERE tenant_id=$1",
            actor.tenant_id)
    return {"disconnected": True}


class TelegramPostBody(BaseModel):
    req_id: str


@router.post("/telegram/post")
async def telegram_post(body: TelegramPostBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        await _set_encrypt_key(conn)
        conn_row = await conn.fetchrow("""
            SELECT chat_id, pgp_sym_decrypt(bot_token_enc, current_setting('app.encrypt_key', true)) AS token
            FROM telegram_channel_connections WHERE tenant_id=$1 AND is_active=TRUE
        """, actor.tenant_id)
        if not conn_row:
            raise HTTPException(400, "No Telegram channel connected - go to Settings to connect one first")

        req = await conn.fetchrow(
            "SELECT * FROM requisitions WHERE id=$1 AND tenant_id=$2", body.req_id, actor.tenant_id)
        if not req:
            raise HTTPException(404, "Requisition not found")

    title = req["title"]
    loc = req["location"] or "Bengaluru"
    skills = list(req["skills_required"] or [])
    desc = (req["description"] or f"{title} opportunity")[:400]
    job_url = f"{BASE_URL}/careers/{body.req_id}"
    # Telegram's Markdown parse mode needs its own reserved characters
    # escaped, distinct from HTML/reportlab escaping used elsewhere in
    # this codebase — a literal '.', '-', '(' etc. in a job title breaks
    # the whole message silently (Telegram just 400s) if left unescaped.
    def _md_escape(s: str) -> str:
        s = s.replace("\\", "\\\\")  # must run first, or later escapes get double-escaped
        for ch in r"_*[]()~`>#+-=|{}.!":
            s = s.replace(ch, f"\\{ch}")
        return s
    message = (
        f"*{_md_escape(title)}*\n\n"
        f"📍 {_md_escape(loc)} · {_md_escape(req['employment_type'] or 'Full-time')}\n"
        f"{_md_escape(desc)}\n\n"
        f"*Skills:* {_md_escape(', '.join(skills[:8]))}\n\n"
        f"[Apply now]({job_url})"
    )

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"https://api.telegram.org/bot{conn_row['token']}/sendMessage",
            data={"chat_id": conn_row["chat_id"], "text": message, "parse_mode": "MarkdownV2",
                  "disable_web_page_preview": "false"})
    if r.status_code != 200 or not r.json().get("ok"):
        detail = r.json().get("description", "Telegram post failed")
        raise HTTPException(502, f"Telegram rejected the post: {detail}")

    msg_id = r.json().get("result", {}).get("message_id", "")
    raw_chat_id = str(conn_row["chat_id"])
    if raw_chat_id.startswith("-100"):
        # Private channel numeric ID - Telegram's own deep-link format
        # strips exactly this literal 4-char prefix (str.lstrip() strips
        # any of a *set* of characters, not a literal prefix, and would
        # mangle a ...100... ID that happens to contain a "1"/"0" run).
        post_url = f"https://t.me/c/{raw_chat_id[4:]}/{msg_id}"
    elif raw_chat_id.startswith("@"):
        post_url = f"https://t.me/{raw_chat_id[1:]}/{msg_id}"
    else:
        post_url = f"https://t.me/{raw_chat_id}/{msg_id}"

    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO job_shares (tenant_id,requisition_id,platform,posted_by,share_url)
            VALUES ($1,$2,'telegram',$3,$4) ON CONFLICT DO NOTHING
        """, actor.tenant_id, body.req_id, actor.user_id, post_url)

    return {"posted": True, "post_url": post_url}


@router.get("/feed-info")
async def feed_info(actor: Actor = Depends(get_actor)):
    """The actual free, automatic distribution mechanism: a standing XML
    feed (Indeed's documented free organic-feed format, also accepted by
    Jooble and most aggregators) that publishes every open requisition.
    Register the URL once with each aggregator's free publisher program
    and every future job gets picked up on their next crawl with zero
    further action - this is what genuinely free "auto-post everywhere"
    looks like; it is not a one-click button because the one-time
    registration step requires the agency's own account with each
    aggregator, which no backend call can do on their behalf."""
    feed_url = f"{BASE_URL}/api/public/jobs/feed.xml?tenant_id={actor.tenant_id}"
    careers_url = f"{BASE_URL}/careers"
    return {
        "feed_url": feed_url,
        "careers_url": careers_url,
        "google_for_jobs": "Fully automatic, zero setup - the careers page already carries schema.org/JobPosting structured data, so Google's own crawler indexes every open job into Google for Jobs on its normal schedule.",
        "registration_steps": [
            {"platform": "Indeed (free organic listings)", "how": "Indeed Employer Center → Post a job → \"Import via XML feed\" (or Publisher Program signup), paste the Feed URL below.", "url": "https://employers.indeed.com"},
            {"platform": "Jooble", "how": "Jooble Publisher Program signup, submit the Feed URL for automatic crawling.", "url": "https://jooble.org/publishers"},
        ],
    }


@router.get("/requisition/{req_id}")
async def share_links(req_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        req = await conn.fetchrow(
            "SELECT * FROM requisitions WHERE id=$1 AND tenant_id=$2", req_id, actor.tenant_id)
        if not req: raise HTTPException(404, "Not found")
    # /careers is the actual public, unauthenticated job-board route (see
    # frontend/app/(public)/careers/page.tsx) - /jobs/{id} is the internal
    # admin view under (dashboard) and requires login, so a candidate
    # clicking a shared link there would just hit the login wall.
    # /careers/{id} (a path, not ?job=) is a real server-rendered route
    # with per-job Open Graph metadata - see careers/[jobId]/page.tsx -
    # so link-preview cards on Facebook/LinkedIn/WhatsApp show the actual
    # job title/description instead of a blank/generic card (those
    # crawlers don't execute JS, so a query param on the client-rendered
    # list page was invisible to them).
    job_url = f"{BASE_URL}/careers/{req_id}"
    title   = req["title"]
    loc     = req["location"] or "Bengaluru"
    skills  = list(req["skills_required"] or [])
    desc    = (req["description"] or f"{title} opportunity")[:300]
    # No emoji here - WhatsApp's own wa.me -> api.whatsapp.com redirect has
    # been observed mangling supplementary-plane emoji (📍, 🎯) into the
    # Unicode replacement character on some paths, confirmed NOT a bug in
    # this backend (verified correct UTF-8 bytes at every stage up to the
    # HTTP response) - it happens on WhatsApp's own infrastructure during
    # the redirect, outside anything fixable here. Plain text is reliable.
    wa_msg  = f"*{title}*\nLocation: {loc} | {req['employment_type']}\nSkills: {', '.join(skills[:4])}\nApply: {job_url}\n\n_AVIIN Jobs - AI Staffing_"
    share = build_share_links(job_url, title, desc, loc, skills, wa_msg)
    return {
        "job_url": job_url,
        # Legacy top-level fields, kept for any existing callers.
        "linkedin_share":  share["linkedin"],
        "whatsapp_share":  share["whatsapp"],
        "email_share":     share["email"],
        "naukri_post":     "https://www.naukri.com",
        "indeed_post":     "https://www.indeed.com",
        "whatsapp_message": wa_msg,
        "linkedin_post": f"{title}\n\n{desc}\n\nLocation: {loc}\nSkills: {', '.join(skills[:5])}\n\nApply: {job_url}",
        "job_description_text": f"{title}\n\nLocation: {loc}\nType: {req['employment_type'] or 'Full-time'}\n\n{desc}\n\nSkills: {', '.join(skills[:8])}\n\nApply: {job_url}",
        # Full 70+ portal catalog with per-requisition computed links -
        # share_intent ones get a pre-filled compose URL, the rest get the
        # portal's own homepage (no public posting API exists for them).
        "portals": get_all_portals(job_url, title, desc, loc, skills, wa_msg),
    }

class LogShareBody(BaseModel):
    req_id: str
    platform: str
    share_url: str | None = None


@router.post("/log")
async def log_share(body: LogShareBody, actor: Actor = Depends(get_actor)):
    # Was previously (req_id: str, platform: str) with no Body() - FastAPI
    # binds bare scalar params on a POST to the QUERY string, but the
    # frontend has always sent these as a JSON body, so every call 422'd
    # silently (fire-and-forget, error never surfaced) - job_shares has
    # essentially never recorded anything and /stats has always been empty.
    # share_url was also never captured even after that fix, even though
    # the column has existed all along - the frontend has the exact link it
    # just opened at the moment it calls this, so there's no reason not to
    # keep it for "what did I actually post" lookups later.
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute("""
            INSERT INTO job_shares (tenant_id,requisition_id,platform,posted_by,share_url)
            VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
        """, actor.tenant_id, body.req_id, body.platform, actor.user_id, body.share_url)
    return {"logged": True, "platform": body.platform}


@router.get("/shared/{req_id}")
async def already_shared(req_id: str, actor: Actor = Depends(get_actor)):
    """Which portals this requisition has already been shared to - lets the
    UI restore the green checkmarks on reload instead of losing them the
    moment the page refreshes (previously pure client-side state)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT platform FROM job_shares WHERE tenant_id=$1 AND requisition_id=$2",
            actor.tenant_id, req_id)
    return {"platforms": [r["platform"] for r in rows]}


@router.post("/clear/{req_id}")
async def clear_shares(req_id: str, actor: Actor = Depends(get_actor)):
    """Reset the shared/posted state for a requisition so it can be
    re-shared from scratch (e.g. after fixing a broken link)."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        await conn.execute(
            "DELETE FROM job_shares WHERE tenant_id=$1 AND requisition_id=$2",
            actor.tenant_id, req_id)
    return {"cleared": True}


@router.get("/stats")
async def stats(actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT platform, COUNT(*) shares, SUM(click_count) clicks
            FROM job_shares WHERE tenant_id=$1
            GROUP BY platform ORDER BY shares DESC
        """, actor.tenant_id)
    return [dict(r) for r in rows]


class IssueBody(BaseModel):
    req_id: str | None = None
    portal_key: str
    portal_name: str
    issue_type: str = 'other'
    note: str | None = None


@router.post("/issues")
async def report_issue(body: IssueBody, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            INSERT INTO job_portal_issues
              (tenant_id, requisition_id, portal_key, portal_name, issue_type, note, reported_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id, portal_key, portal_name, issue_type, note, status, created_at
        """, actor.tenant_id, body.req_id, body.portal_key, body.portal_name,
             body.issue_type, body.note, actor.user_id)
    return dict(row)


@router.get("/issues")
async def list_issues(status: str = 'open', actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        rows = await conn.fetch("""
            SELECT i.id, i.requisition_id, i.portal_key, i.portal_name, i.issue_type,
                   i.note, i.status, i.created_at, r.title AS requisition_title
            FROM job_portal_issues i
            LEFT JOIN requisitions r ON r.id = i.requisition_id
            WHERE i.tenant_id=$1 AND ($2='' OR i.status=$2)
            ORDER BY i.created_at DESC
        """, actor.tenant_id, status)
    return [dict(r) for r in rows]


@router.get("/dashboard")
async def dashboard(actor: Actor = Depends(get_actor)):
    """Consolidated status view: for every portal in the directory, how it's
    integrated (auto-share / auto-feed / auto-indexed / manual - these mean
    different things and shouldn't be conflated as one "posted" checkbox),
    how many times it's actually been posted to across all requisitions, and
    whether it currently has an open reported issue."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        share_rows = await conn.fetch("""
            SELECT platform, COUNT(*) AS times_posted,
                   COUNT(DISTINCT requisition_id) AS jobs_posted_to,
                   MAX(posted_at) AS last_posted_at
            FROM job_shares WHERE tenant_id=$1 GROUP BY platform
        """, actor.tenant_id)
        issue_rows = await conn.fetch("""
            SELECT portal_key, COUNT(*) AS open_issues
            FROM job_portal_issues WHERE tenant_id=$1 AND status='open'
            GROUP BY portal_key
        """, actor.tenant_id)
        recent_rows = await conn.fetch("""
            SELECT js.id, js.platform, js.share_url, js.posted_at,
                   r.id AS requisition_id, r.title, r.location, r.description,
                   r.skills_required, r.employment_type,
                   u.full_name AS posted_by_name
            FROM job_shares js
            JOIN requisitions r ON r.id = js.requisition_id
            LEFT JOIN users u ON u.id = js.posted_by
            WHERE js.tenant_id=$1
            ORDER BY js.posted_at DESC LIMIT 50
        """, actor.tenant_id)
        fb_connected = await conn.fetchval(
            "SELECT is_active FROM facebook_page_connections WHERE tenant_id=$1", actor.tenant_id)
        tg_connected = await conn.fetchval(
            "SELECT is_active FROM telegram_channel_connections WHERE tenant_id=$1", actor.tenant_id)

    share_by_platform = {r["platform"]: r for r in share_rows}
    issues_by_portal = {r["portal_key"]: r["open_issues"] for r in issue_rows}

    portals = get_all_portals()
    if fb_connected:
        # Facebook is auto_share (share-dialog link) by default in the
        # static catalog, but this tenant has a real Page connected -
        # /facebook/post genuinely posts with zero user interaction, a
        # different (better) guarantee than "opens a dialog to click
        # through", so the dashboard should say so.
        for p in portals:
            if p["key"] == "facebook":
                p["integration_type"] = "auto_api"
    if tg_connected:
        for p in portals:
            if p["key"] == "telegram":
                p["integration_type"] = "auto_api"
    portal_status = []
    integration_counts: dict[str, int] = {}
    total_shares = 0
    for p in portals:
        integration_counts[p["integration_type"]] = integration_counts.get(p["integration_type"], 0) + 1
        s = share_by_platform.get(p["key"])
        times_posted = int(s["times_posted"]) if s else 0
        total_shares += times_posted
        portal_status.append({
            "key": p["key"], "name": p["name"], "category": p["category"],
            "integration_type": p["integration_type"],
            "integration_label": INTEGRATION_LABELS[p["integration_type"]],
            "times_posted": times_posted,
            "jobs_posted_to": int(s["jobs_posted_to"]) if s else 0,
            "last_posted_at": s["last_posted_at"].isoformat() if s and s["last_posted_at"] else None,
            "open_issues": issues_by_portal.get(p["key"], 0),
            "status": "flagged" if issues_by_portal.get(p["key"], 0) > 0 else ("posted" if times_posted > 0 else "not_posted"),
        })

    portal_by_key = {p["key"]: p for p in portals}
    recent_posts = []
    for r in recent_rows:
        link = r["share_url"]
        if not link:
            # Rows logged before share_url was captured (or a manual portal
            # whose homepage link doesn't carry a per-job URL) - regenerate
            # the same link deterministically from the requisition data so
            # "View Post" still works instead of showing a dead entry.
            job_url = f"{BASE_URL}/careers/{r['requisition_id']}"
            title = r["title"]; loc = r["location"] or "Bengaluru"
            skills = list(r["skills_required"] or [])
            desc = (r["description"] or f"{title} opportunity")[:300]
            wa_msg = f"*{title}*\nLocation: {loc} | {r['employment_type']}\nApply: {job_url}"
            share = build_share_links(job_url, title, desc, loc, skills, wa_msg)
            p = portal_by_key.get(r["platform"])
            link = share.get(r["platform"]) or (p["link"] if p else job_url)
        recent_posts.append({
            "id": str(r["id"]), "platform": r["platform"],
            "portal_name": portal_by_key.get(r["platform"], {}).get("name", r["platform"]),
            "requisition_id": str(r["requisition_id"]), "requisition_title": r["title"],
            "posted_at": r["posted_at"].isoformat() if r["posted_at"] else None,
            "posted_by_name": r["posted_by_name"],
            "link": link,
        })

    return {
        "summary": {
            "total_portals": len(portals),
            "total_shares": total_shares,
            "open_issues": sum(issues_by_portal.values()),
            "portals_never_posted": sum(1 for p in portal_status if p["times_posted"] == 0),
        },
        "integration_breakdown": [
            {"type": t, "label": INTEGRATION_LABELS[t], "count": c}
            for t, c in integration_counts.items()
        ],
        "portals": sorted(portal_status, key=lambda p: (-p["times_posted"], p["name"])),
        "recent_posts": recent_posts,
    }


@router.patch("/issues/{issue_id}/resolve")
async def resolve_issue(issue_id: str, actor: Actor = Depends(get_actor)):
    async with db.tenant_conn(actor.tenant_id) as conn:
        row = await conn.fetchrow("""
            UPDATE job_portal_issues
            SET status='resolved', resolved_by=$1, resolved_at=now()
            WHERE id=$2 AND tenant_id=$3
            RETURNING id
        """, actor.user_id, issue_id, actor.tenant_id)
    if not row:
        raise HTTPException(404, "Issue not found")
    return {"resolved": True}
