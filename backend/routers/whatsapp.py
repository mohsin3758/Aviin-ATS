"""P11 — WhatsApp outreach via WAHA (self-hosted).

HARD RULE #7: WhatsApp ALWAYS requires a consent record first (India DPDP 2023).
Every send endpoint checks consent before calling WAHA. No consent → 403.

HARD RULE #12: Consent record must exist for the candidate + channel='whatsapp'
with consent_given=true BEFORE any WhatsApp message is dispatched.
"""

import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db
from deps import Actor, get_actor

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])

WAHA_BASE = os.getenv("WAHA_URL", "http://waha:3000")
WAHA_KEY = os.getenv("WAHA_API_KEY", "")
WAHA_SESSION = "default"

# 14 India-first language templates (Tier-0, zero-token — plain text lookup)
MSG_TEMPLATES: dict[str, dict[str, str]] = {
    "job_opportunity": {
        "en": "Hi {name}, we have an exciting opportunity for a {role} at {client}. Interested? Reply YES.",
        "hi": "नमस्ते {name}, {client} में {role} के लिए एक शानदार अवसर है। रुचि है? YES जवाब दें।",
        "ta": "வணக்கம் {name}, {client}ல் {role} பதவிக்கு வாய்ப்பு உள்ளது. ஆர்வம் உள்ளதா? YES என்று பதிலளிக்கவும்.",
        "te": "హలో {name}, {client}లో {role} కు అవకాశం ఉంది. ఆసక్తి ఉందా? YES అని రిప్లై ఇవ్వండి.",
        "kn": "ಹಲೋ {name}, {client}ನಲ್ಲಿ {role} ಗಾಗಿ ಅವಕಾಶ ಇದೆ. ಆಸಕ್ತಿ ಇದ್ಯಾ? YES ಎಂದು ರಿಪ್ಲೈ ಮಾಡಿ.",
        "ml": "ഹലോ {name}, {client}ൽ {role} ഒഴിവ് ഉണ്ട്. താൽപ്പര്യം ഉണ്ടോ? YES എന്ന് മറുപടി ഇടൂ.",
        "mr": "नमस्ते {name}, {client} मध्ये {role} साठी संधी आहे. स्वारस्य आहे का? YES उत्तर द्या.",
        "gu": "નમસ્તે {name}, {client}માં {role} માટે તક છે. રુચિ છે? YES જવાબ આપો.",
        "pa": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {name}, {client} ਵਿੱਚ {role} ਦਾ ਮੌਕਾ ਹੈ। ਦਿਲਚਸਪੀ ਹੈ? YES ਦਾ ਜਵਾਬ ਦਿਓ।",
        "bn": "হ্যালো {name}, {client}তে {role} সুযোগ আছে। আগ্রহী? YES জবাব দিন।",
        "or": "ନମସ୍କାର {name}, {client}ରେ {role} ସୁଯୋଗ ଅଛି। ଆଗ୍ରହ ଅଛି? YES ଉତ୍ତର ଦିଅନ୍ତୁ।",
        "as": "নমস্কাৰ {name}, {client}ত {role} সুযোগ আছে। আগ্ৰহ আছে? YES উত্তৰ দিয়ক।",
        "ur": "سلام {name}، {client} میں {role} کا موقع ہے۔ دلچسپی ہے؟ YES جواب دیں۔",
        "kok": "नमस्कार {name}, {client}ांत {role} संधी आसा. आवड आसा? YES उत्तर दी.",
    },
    "interview_invitation": {
        "en": "Hi {name}, you've been shortlisted for {role} at {client}. Interview on {date}. Please confirm.",
        "hi": "नमस्ते {name}, {client} में {role} के लिए आपका चयन हुआ है। इंटरव्यू {date} को है। कृपया पुष्टि करें।",
        "ta": "வணக்கம் {name}, {client}ல் {role} க்கு தேர்வு ஆனீர்கள். நேர்காணல் {date}. உறுதிப்படுத்தவும்.",
        "te": "హలో {name}, {client}లో {role} కి మీరు షార్ట్ లిస్ట్ అయ్యారు. ఇంటర్వ్యూ {date}. దయచేసి నిర్ధారించండి.",
        "kn": "ಹಲೋ {name}, {client}ನಲ್ಲಿ {role}ಗೆ ನಿಮ್ಮನ್ನು ಶಾರ್ಟ್‌ಲಿಸ್ಟ್ ಮಾಡಲಾಗಿದೆ. ಸಂದರ್ಶನ {date}. ದಯವಿಟ್ಟು ದೃಢೀಕರಿಸಿ.",
        "ml": "ഹലോ {name}, {client}ൽ {role} ക്ക് തിരഞ്ഞെടുക്കപ്പെട്ടു. ഇൻ്റർവ്യൂ {date}. ദയവായി സ്ഥിരീകരിക്കുക.",
        "mr": "नमस्ते {name}, {client}मध्ये {role}साठी तुमची निवड झाली. मुलाखत {date}. कृपया पुष्टी करा.",
        "gu": "નમસ્તે {name}, {client}માં {role} માટે તમારી પસંદ થઈ. ઇન્ટરવ્યૂ {date}. કૃપા કરી ખાતરી કરો.",
        "pa": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {name}, {client}ਵਿੱਚ {role} ਲਈ ਤੁਹਾਡੀ ਚੋਣ ਹੋਈ। ਇੰਟਰਵਿਊ {date}। ਕਿਰਪਾ ਪੁਸ਼ਟੀ ਕਰੋ।",
        "bn": "হ্যালো {name}, {client}তে {role} এর জন্য শর্টলিস্ট হয়েছেন। ইন্টারভিউ {date}. নিশ্চিত করুন।",
        "or": "ନମସ୍କାର {name}, {client}ରେ {role} ପାଇଁ ଆପଣ ଶଟ୍‌ଲିଷ୍ଟ ହୋଇଛନ୍ତି। ଇଣ୍ଟରଭ୍ୟୁ {date}. ନିଶ୍ଚିତ କରନ୍ତୁ।",
        "as": "নমস্কাৰ {name}, {client}ত {role} পদৰ বাবে শ্বর্টলিষ্ট হৈছে। সাক্ষাৎকাৰ {date}. নিশ্চিত কৰক।",
        "ur": "سلام {name}، {client} میں {role} کے لیے آپ شارٹ لسٹ ہوئے۔ انٹرویو {date}۔ تصدیق کریں۔",
        "kok": "नमस्कार {name}, {client}ांत {role} खातीर तुमची निवड जाली. मुलाखत {date}. कृपा खात्री करा.",
    },
    "offer_letter": {
        "en": "Congratulations {name}! We are pleased to offer you the {role} position at {client}. Check your email for details.",
        "hi": "बधाई हो {name}! {client} में {role} पद के लिए आपको ऑफर देते हुए खुशी हो रही है। विवरण के लिए ईमेल देखें।",
        "ta": "வாழ்த்துக்கள் {name}! {client}ல் {role} பதவிக்கு உங்களை வாழ்த்துகிறோம். மின்னஞ்சலில் விவரங்களை பாருங்கள்.",
        "te": "అభినందనలు {name}! {client}లో {role} కు ఆఫర్ ఇస్తున్నాం. వివరాలకు ఇమెయిల్ చూడండి.",
        "kn": "ಅಭಿನಂದನೆಗಳು {name}! {client}ನಲ್ಲಿ {role} ಹುದ್ದೆಗೆ ಆಫರ್ ನೀಡಲು ಸಂತೋಷ. ವಿವರಗಳಿಗೆ ಇಮೇಲ್ ನೋಡಿ.",
        "ml": "അഭിനന്ദനങ്ങൾ {name}! {client}ൽ {role} ഒഴിവ് ഓഫർ ചെയ്യുന്നു. വിശദാംശങ്ങൾ ഇമെയിലിൽ നോക്കൂ.",
        "mr": "अभिनंदन {name}! {client} मध्ये {role} पदासाठी ऑफर देण्यात आनंद आहे. तपशीलांसाठी ईमेल पहा.",
        "gu": "અભિનંદન {name}! {client}માં {role} પદ ઓફર કરતાં ખુશ છીએ. વિગત માટે ઈ-મેઈલ જુઓ.",
        "pa": "ਵਧਾਈਆਂ {name}! {client} ਵਿੱਚ {role} ਅਹੁਦੇ ਲਈ ਆਫਰ ਦੇ ਕੇ ਖੁਸ਼ ਹਾਂ। ਵੇਰਵੇ ਲਈ ਈਮੇਲ ਦੇਖੋ।",
        "bn": "অভিনন্দন {name}! {client}তে {role} পদে অফার করতে পেরে খুশি। বিস্তারিত ইমেইল দেখুন।",
        "or": "ଅଭିନନ୍ଦନ {name}! {client}ରେ {role} ପଦ ଅଫର୍ ଦେଇ ଆମେ ଖୁସି। ବିବରଣ ପାଇଁ ଇ-ମେଲ ଦେଖନ୍ତୁ।",
        "as": "অভিনন্দন {name}! {client}ত {role} পদত অফাৰ কৰিবলৈ আনন্দিত। বিৱৰণৰ বাবে ইমেইল চাওক।",
        "ur": "مبارک ہو {name}! {client} میں {role} عہدے پر آفر کرتے خوشی ہے۔ تفصیل کے لیے ای میل دیکھیں۔",
        "kok": "अभिनंदन {name}! {client}ांत {role} पदा खातीर ऑफर दिवपाक आनंद. विवरणाखातीर ईमेल पळयात.",
    },
    "status_update": {
        "en": "Hi {name}, update on your application for {role} at {client}: {status}. Questions? Reply here.",
        "hi": "नमस्ते {name}, {client} में {role} के लिए आपके आवेदन की स्थिति: {status}। प्रश्न हों तो यहां जवाब दें।",
        "ta": "வணக்கம் {name}, {client}ல் {role} விண்ணப்பத்தின் நிலை: {status}. கேள்வி இருந்தால் இங்கே பதிலளிக்கவும்.",
        "te": "హలో {name}, {client}లో {role} దరఖాస్తు స్థితి: {status}. ప్రశ్నలు ఉంటే ఇక్కడ రిప్లై ఇవ్వండి.",
        "kn": "ಹಲೋ {name}, {client}ನಲ್ಲಿ {role}ಗೆ ನಿಮ್ಮ ಅರ್ಜಿ ಸ್ಥಿತಿ: {status}. ಪ್ರಶ್ನೆ ಇದ್ದರೆ ಇಲ್ಲಿ ರಿಪ್ಲೈ ಮಾಡಿ.",
        "ml": "ഹലോ {name}, {client}ൽ {role} ക്ക് നിങ്ങളുടെ അപേക്ഷ നില: {status}. ചോദ്യങ്ങൾ ഉണ്ടോ? ഇവിടെ മറുപടി ഇടൂ.",
        "mr": "नमस्ते {name}, {client}मध्ये {role}साठी अर्जाची स्थिती: {status}. प्रश्न असल्यास येथे उत्तर द्या.",
        "gu": "નમસ્તે {name}, {client}માં {role} ની અરજીની સ્થિતિ: {status}. પ્રશ્ન છે? અહીં જવાબ આપો.",
        "pa": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ {name}, {client}ਵਿੱਚ {role} ਲਈ ਤੁਹਾਡੀ ਅਰਜ਼ੀ ਦੀ ਸਥਿਤੀ: {status}। ਸਵਾਲ ਹਨ? ਇੱਥੇ ਜਵਾਬ ਦਿਓ।",
        "bn": "হ্যালো {name}, {client}তে {role} এর আবেদনের অবস্থা: {status}. প্রশ্ন আছে? এখানে উত্তর দিন।",
        "or": "ନମସ୍କାର {name}, {client}ରେ {role} ଆବେଦନ ସ୍ଥିତି: {status}. ପ୍ରଶ୍ନ ଅଛି? ଏଠାରେ ଉତ୍ତର ଦିଅନ୍ତୁ।",
        "as": "নমস্কাৰ {name}, {client}ত {role} আবেদনৰ স্থিতি: {status}. প্ৰশ্ন আছে? ইয়াত উত্তৰ দিয়ক।",
        "ur": "سلام {name}، {client} میں {role} کی درخواست کی حیثیت: {status}۔ سوال ہے؟ یہاں جواب دیں۔",
        "kok": "नमस्कार {name}, {client}ांत {role} अर्जाची स्थिती: {status}. प्रश्न आसात? हांगा उत्तर दी.",
    },
}

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "ta": "Tamil", "te": "Telugu",
    "kn": "Kannada", "ml": "Malayalam", "mr": "Marathi", "gu": "Gujarati",
    "pa": "Punjabi", "bn": "Bengali", "or": "Odia", "as": "Assamese",
    "ur": "Urdu", "kok": "Konkani",
}


def _waha_headers() -> dict:
    return {"X-Api-Key": WAHA_KEY, "Content-Type": "application/json"}


async def _check_waha() -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{WAHA_BASE}/api/sessions/{WAHA_SESSION}", headers=_waha_headers())
        if r.status_code == 200:
            return r.json()
        return {"status": "STOPPED"}


async def _ensure_consent(conn, tenant_id: str, candidate_id: str) -> bool:
    """HARD RULE #7/#12: returns True only if whatsapp consent exists."""
    row = await conn.fetchrow(
        """SELECT id FROM consent_records
           WHERE candidate_id = $1 AND channel = 'whatsapp' AND consent_given = true
           LIMIT 1""",
        candidate_id,
    )
    return row is not None


# ─── Session endpoints ─────────────────────────────────────────────────────────

@router.get("/session/status")
async def session_status(actor: Actor = Depends(get_actor)):
    info = await _check_waha()
    return {"session": WAHA_SESSION, "status": info.get("status", "STOPPED"), "info": info}


@router.post("/session/start")
async def session_start(actor: Actor = Depends(get_actor)):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{WAHA_BASE}/api/sessions",
            headers=_waha_headers(),
            json={"name": WAHA_SESSION, "config": {"webhooks": []}},
        )
        if r.status_code not in (200, 201):
            # Session may already exist — try starting it
            pass
        # Start the session
        await client.post(
            f"{WAHA_BASE}/api/sessions/{WAHA_SESSION}/start",
            headers=_waha_headers()
        )
        return {"status": "starting"}


@router.get("/session/qr")
async def session_qr(actor: Actor = Depends(get_actor)):
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            f"{WAHA_BASE}/api/sessions/{WAHA_SESSION}/auth/qr",
            headers=_waha_headers(),
            params={"format": "image"},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=503, detail="QR not available — session not ready")
        return {"qr_data_url": f"data:image/png;base64,{r.content.decode()}"}


# ─── Templates ────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(actor: Actor = Depends(get_actor)):
    return [
        {
            "template_key": key,
            "languages": list(LANG_NAMES.keys()),
            "sample_en": templates["en"],
        }
        for key, templates in MSG_TEMPLATES.items()
    ]


# ─── Send message (consent-gated) ─────────────────────────────────────────────

class SendRequest(BaseModel):
    candidate_id: str
    phone: str          # E.164 format, e.g. "+919876543210"
    template_key: str
    lang: str = "en"
    vars: dict = {}


@router.post("/send")
async def send_whatsapp(body: SendRequest, actor: Actor = Depends(get_actor)):
    """HARD RULE #7/#12: consent check runs BEFORE every send."""
    async with db.tenant_conn(actor.tenant_id) as conn:
        if not await _ensure_consent(conn, actor.tenant_id, body.candidate_id):
            raise HTTPException(
                status_code=403,
                detail="WhatsApp consent not recorded for this candidate (HARD RULE #7/#12 — DPDP 2023). "
                       "Create a consent_records row with channel='whatsapp' and consent_given=true first.",
            )

    template_map = MSG_TEMPLATES.get(body.template_key)
    if not template_map:
        raise HTTPException(status_code=400, detail=f"Unknown template_key: {body.template_key}")
    lang = body.lang if body.lang in template_map else "en"
    text = template_map[lang].format(**body.vars)

    session_info = await _check_waha()
    if session_info.get("status") not in ("WORKING", "CONNECTED"):
        raise HTTPException(
            status_code=503,
            detail=f"WhatsApp session not connected (status={session_info.get('status')}). Scan QR to link phone.",
        )

    chat_id = body.phone.replace("+", "") + "@c.us"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{WAHA_BASE}/api/sendText",
            headers=_waha_headers(),
            json={"session": WAHA_SESSION, "chatId": chat_id, "text": text},
        )
        if r.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail=f"WAHA error: {r.text}")

    return {"status": "sent", "chat_id": chat_id, "lang": lang, "text": text}


# ─── Bulk outreach (consent-gated per candidate) ──────────────────────────────

class BulkOutreachRow(BaseModel):
    candidate_id: str
    phone: str
    vars: dict = {}


class BulkRequest(BaseModel):
    template_key: str
    lang: str = "en"
    recipients: list[BulkOutreachRow]


@router.post("/bulk-send")
async def bulk_send(body: BulkRequest, actor: Actor = Depends(get_actor)):
    """Sends to each consented recipient; skips non-consented with a reason."""
    template_map = MSG_TEMPLATES.get(body.template_key)
    if not template_map:
        raise HTTPException(status_code=400, detail=f"Unknown template_key: {body.template_key}")
    lang = body.lang if body.lang in template_map else "en"

    session_info = await _check_waha()
    connected = session_info.get("status") in ("WORKING", "CONNECTED")

    results = []
    async with db.tenant_conn(actor.tenant_id) as conn:
        for rec in body.recipients:
            has_consent = await _ensure_consent(conn, actor.tenant_id, rec.candidate_id)
            if not has_consent:
                results.append({"candidate_id": rec.candidate_id, "status": "skipped", "reason": "no_consent"})
                continue
            if not connected:
                results.append({"candidate_id": rec.candidate_id, "status": "skipped", "reason": "session_not_connected"})
                continue
            text = template_map[lang].format(**rec.vars)
            chat_id = rec.phone.replace("+", "") + "@c.us"
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    f"{WAHA_BASE}/api/sendText",
                    headers=_waha_headers(),
                    json={"session": WAHA_SESSION, "chatId": chat_id, "text": text},
                )
                results.append({
                    "candidate_id": rec.candidate_id,
                    "status": "sent" if r.status_code in (200, 201) else "error",
                    "chat_id": chat_id,
                    "waha_status": r.status_code,
                })
    return {"sent": sum(1 for r in results if r["status"] == "sent"),
            "skipped": sum(1 for r in results if r["status"] == "skipped"),
            "errors": sum(1 for r in results if r["status"] == "error"),
            "results": results}


# Alias: Meta sometimes hits /whatsapp/webhook instead of /whatsapp-bot/webhook
from fastapi import Request as _Request
@router.post('/webhook')
@router.get('/webhook')
async def webhook_alias(request: _Request):
    """Redirect alias so Meta WebHook GETs (verification) and POSTs (messages) don't 404."""
    try:
        from .whatsapp_bot import webhook as _bot_webhook
        return await _bot_webhook(request)
    except Exception:
        return {'ok': True}
