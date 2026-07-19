"""SMS Service — MSG91 (graceful fallback when unconfigured)."""
import os, httpx
MSG91_API_KEY    = os.getenv("MSG91_API_KEY", "")
MSG91_SENDER_ID  = os.getenv("MSG91_SENDER_ID", "AVIINJ")
MSG91_TEMPLATE_ID = os.getenv("MSG91_TEMPLATE_ID", "")

def is_configured() -> bool:
    return bool(MSG91_API_KEY)

async def send_sms(to_phone: str, message: str, template: str = "general") -> dict:
    if not is_configured():
        return {"status": "log_only", "provider_id": None, "error": "MSG91_API_KEY not set"}
    phone = to_phone.replace("+91","").replace(" ","").replace("-","")
    if not phone.startswith("91"):
        phone = f"91{phone}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.msg91.com/api/v5/flow/",
                headers={"authkey": MSG91_API_KEY, "content-type": "application/json"},
                json={"template_id": MSG91_TEMPLATE_ID,
                      "recipients": [{"mobiles": phone, "var1": message[:160]}]}
            )
            data = r.json()
            if data.get("type") == "success":
                return {"status": "sent", "provider_id": data.get("request_id")}
            return {"status": "failed", "error": str(data)}
    except Exception as e:
        return {"status": "failed", "error": str(e)}

SMS_TEMPLATES = {
    "interview_reminder": "Hi {name}, interview for {role} on {date} at {time}. Link: {link}. -AVIIN Jobs",
    "shortlist": "Hi {name}, you are shortlisted for {role} at {company}. Team will contact you. -AVIIN Jobs",
    "offer": "Congratulations {name}! Offer for {role} at {company}. CTC: Rs.{ctc}. -AVIIN Jobs",
    "placement_confirm": "Hi {name}, joining confirmed on {date} at {company}. HR: {hr_phone}. -AVIIN Jobs",
}

def render_template(name: str, vars: dict) -> str:
    tpl = SMS_TEMPLATES.get(name, vars.get("message", ""))
    for k, v in vars.items():
        tpl = tpl.replace(f"{{{k}}}", str(v))
    return tpl
