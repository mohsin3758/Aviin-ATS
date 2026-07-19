"""SSE Router - Server-Sent Events for real-time recruiter monitoring."""
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
import asyncio, json, time

sse_router = APIRouter(prefix="/sse", tags=["sse"])

@sse_router.get("/recruiter-monitor")
async def recruiter_monitor_stream(request: Request):
    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                data = json.dumps({"type": "ping", "ts": int(time.time())})
                yield f"data: {data}\n\n"
                await asyncio.sleep(30)
        except asyncio.CancelledError:
            pass
    return StreamingResponse(event_generator(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@sse_router.get("/health")
async def sse_health():
    return {"status": "ok"}
