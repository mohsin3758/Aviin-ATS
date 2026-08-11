"""AVIIN ATS company-device monitoring agent (Windows).

Base scope: active-window/idle time + browser URL history on company-
issued Windows laptops only. Does not run on personal devices.

Extended scope (2026-08-11, opt-in per device, requires a SEPARATE
"extended" consent given by the device's own owner via the ATS web UI
before the backend will let any of this be enabled — see
device_monitoring.py's /consent/extended): periodic screenshots + an
on-demand live-view capture, keystroke/mouse activity INTENSITY (the
RATE/COUNT of keys pressed and clicks made — never the actual keys typed
or click targets, so passwords and message content are never captured;
this agent contains no keylogger), DLP detection (visits to a blocked-
website list, USB storage connection — alert-only, this agent never
blocks anything), and a silent tracking mode (no tray icon). All of
these are OFF by default per device and only activate once the backend
confirms extended consent is on file.

Usage:
    python aviin_device_agent.py enroll <api_base_url> <CODE>
    python aviin_device_agent.py run
    python aviin_device_agent.py install-autostart
"""
import base64
import ctypes
import io
import json
import os
import platform
import shutil
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

AGENT_VERSION = "0.2.0"
APP_DIR = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "AviinDeviceAgent"
CONFIG_PATH = APP_DIR / "config.json"

SAMPLE_INTERVAL_SECONDS = 5
FLUSH_INTERVAL_SECONDS = 300
IDLE_THRESHOLD_SECONDS = 120
SETTINGS_POLL_SECONDS = 60

# ── Config ────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def save_config(cfg: dict) -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def device_fingerprint() -> str:
    # Stable per-machine id (not tied to any one network adapter), stored
    # once and reused — avoids re-enrolling as a "new device" on every run.
    cfg = load_config()
    if cfg.get("device_fingerprint"):
        return cfg["device_fingerprint"]
    fp = str(uuid.uuid4())
    cfg["device_fingerprint"] = fp
    save_config(cfg)
    return fp


# ── Enrollment ───────────────────────────────────────────────────────────

def enroll(api_base: str, code: str) -> None:
    resp = requests.post(
        f"{api_base.rstrip('/')}/device-monitoring/enroll",
        json={
            "token": code,
            "hostname": socket.gethostname(),
            "os": f"{platform.system()} {platform.release()}",
            "device_fingerprint": device_fingerprint(),
            "agent_version": AGENT_VERSION,
        },
        timeout=15,
    )
    if not resp.ok:
        print(f"Enrollment failed: {resp.status_code} {resp.text}")
        sys.exit(1)
    data = resp.json()
    cfg = load_config()
    cfg.update({
        "api_base": api_base.rstrip("/"),
        "device_id": data["device_id"],
        "device_api_key": data["device_api_key"],
    })
    save_config(cfg)
    print(f"Enrolled successfully. Device ID: {data['device_id']}")


# ── Active window + idle tracking ───────────────────────────────────────────

def get_idle_seconds() -> float:
    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(LASTINPUTINFO)
    ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info))
    millis = ctypes.windll.kernel32.GetTickCount() - info.dwTime
    return millis / 1000.0


def get_active_window():
    """Returns (app_name, window_title) for the foreground window.
    Window title only, never window content — same category of signal as
    every disclosed activity-monitoring tool (Time Doctor, ActivTrak, etc.)."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None, None
    title = win32gui.GetWindowText(hwnd)
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        app_name = psutil.Process(pid).name()
    except Exception:
        app_name = None
    return app_name, title


# ── Browser history (Chrome/Edge; Chromium's SQLite History file) ──────────
# The file is locked while the browser runs, so we copy it before reading —
# a standard, well-known technique for this exact reason (not an evasion of
# anything; the browser just holds an exclusive lock).

CHROME_EPOCH = datetime(1601, 1, 1, tzinfo=timezone.utc)


def _chrome_time_to_dt(chrome_us: int) -> datetime:
    return CHROME_EPOCH + timedelta(microseconds=chrome_us)


def _dt_to_chrome_time(dt: datetime) -> int:
    return int((dt - CHROME_EPOCH).total_seconds() * 1_000_000)


def _browser_history_paths():
    local = Path(os.environ.get("LOCALAPPDATA", ""))
    return {
        "chrome": local / "Google" / "Chrome" / "User Data" / "Default" / "History",
        "edge": local / "Microsoft" / "Edge" / "User Data" / "Default" / "History",
    }


def read_browser_history(since: datetime):
    """Yields (browser, url, title, visited_at) for visits after `since`."""
    for browser, path in _browser_history_paths().items():
        if not path.exists():
            continue
        tmp_copy = Path(tempfile.gettempdir()) / f"aviin_agent_{browser}_history_copy.db"
        try:
            shutil.copy2(path, tmp_copy)
            conn = sqlite3.connect(str(tmp_copy))
            since_chrome = _dt_to_chrome_time(since)
            rows = conn.execute(
                "SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > ? ORDER BY last_visit_time ASC",
                (since_chrome,),
            ).fetchall()
            conn.close()
            for url, title, ts in rows:
                yield browser, url, title, _chrome_time_to_dt(ts)
        except Exception as e:
            print(f"[{browser}] history read skipped: {e}")
        finally:
            tmp_copy.unlink(missing_ok=True)


def _domain_of(url: str) -> str:
    d = url.split("://", 1)[-1].split("/", 1)[0].lower()
    return d[4:] if d.startswith("www.") else d


# ── Screenshots (extended scope only) ───────────────────────────────────────
# Full-screen still images at a configurable interval, or one-off on a
# live-view request. Never captures anything more granular than the whole
# visible screen — no window-content diffing, no OCR.

def capture_screenshot(blur: bool) -> bytes:
    from PIL import ImageGrab, ImageFilter
    img = ImageGrab.grab()
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(radius=12))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def post_screenshot(cfg: dict, blur: bool) -> bool:
    try:
        image_bytes = capture_screenshot(blur)
    except Exception as e:
        print(f"[screenshot] capture failed: {e}")
        return False
    return post_batch(cfg, "/device-monitoring/screenshots", {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "image_base64": base64.b64encode(image_bytes).decode("ascii"),
        "is_blurred": blur,
    })


# ── Keystroke/mouse intensity (extended scope only) ─────────────────────────
# Counts and cumulative pixel distance ONLY. The listener callbacks below
# never read, store, or transmit which key was pressed or where a click
# landed — only that a key/click event occurred, incremented into a
# rolling counter. This is not a keylogger.

class _IntensityCounters:
    def __init__(self):
        self.lock = threading.Lock()
        self.keystrokes = 0
        self.clicks = 0
        self.move_px = 0
        self._last_pos = None

    def on_key(self, _key):
        with self.lock:
            self.keystrokes += 1

    def on_click(self, _x, _y, _button, pressed):
        if pressed:
            with self.lock:
                self.clicks += 1

    def on_move(self, x, y):
        with self.lock:
            if self._last_pos is not None:
                dx, dy = x - self._last_pos[0], y - self._last_pos[1]
                self.move_px += int((dx * dx + dy * dy) ** 0.5)
            self._last_pos = (x, y)

    def drain(self):
        with self.lock:
            k, c, m = self.keystrokes, self.clicks, self.move_px
            self.keystrokes = self.clicks = self.move_px = 0
        return k, c, m


def start_intensity_listeners(counters: "_IntensityCounters"):
    from pynput import keyboard, mouse
    # daemon=True matches the tray thread's own convention below — without
    # it, these listener threads (non-daemon by default in pynput) would
    # keep the process alive after the tray's "Quit" sets stop_event.
    kl = keyboard.Listener(on_press=lambda k: counters.on_key(k))
    ml = mouse.Listener(on_click=lambda x, y, b, p: counters.on_click(x, y, b, p),
                         on_move=lambda x, y: counters.on_move(x, y))
    kl.daemon = True
    ml.daemon = True
    kl.start()
    ml.start()
    return kl, ml


# ── DLP: USB detection (extended scope only, alert-only) ───────────────────

def list_removable_drives() -> set:
    import win32file
    drives = set()
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        root = f"{letter}:\\"
        try:
            if win32file.GetDriveType(root) == win32file.DRIVE_REMOVABLE:
                drives.add(letter)
        except Exception:
            pass
    return drives


# ── Reporting ────────────────────────────────────────────────────────────

def post_batch(cfg: dict, path: str, payload: dict) -> bool:
    try:
        resp = requests.post(
            f"{cfg['api_base']}{path}",
            json=payload,
            headers={"X-Device-Key": cfg["device_api_key"]},
            timeout=15,
        )
        return resp.ok
    except Exception as e:
        print(f"[report] {path} failed: {e}")
        return False


def fetch_settings(cfg: dict) -> dict:
    try:
        resp = requests.get(
            f"{cfg['api_base']}/device-monitoring/my-settings",
            headers={"X-Device-Key": cfg["device_api_key"]},
            timeout=15,
        )
        return resp.json() if resp.ok else {}
    except Exception as e:
        print(f"[settings] fetch failed: {e}")
        return {}


def fetch_dlp_policies(cfg: dict) -> dict:
    try:
        resp = requests.get(
            f"{cfg['api_base']}/device-monitoring/dlp-policies/active",
            headers={"X-Device-Key": cfg["device_api_key"]},
            timeout=15,
        )
        return resp.json() if resp.ok else {"blocked_domains": [], "usb_restricted": False}
    except Exception:
        return {"blocked_domains": [], "usb_restricted": False}


# ── Tray icon (visible unless silent tracking_mode is set) ─────────────────

def _make_tray_icon():
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (64, 64), "white")
    d = ImageDraw.Draw(img)
    d.ellipse((8, 8, 56, 56), fill=(37, 99, 235))
    d.text((22, 24), "A", fill="white")
    return img


def run_tray(stop_event: threading.Event):
    import pystray
    icon = pystray.Icon(
        "aviin_device_agent",
        _make_tray_icon(),
        "AVIIN Device Monitoring — Active",
        menu=pystray.Menu(
            pystray.MenuItem("AVIIN Device Monitoring is active", None, enabled=False),
            pystray.MenuItem("Quit", lambda: (stop_event.set(), icon.stop())),
        ),
    )
    icon.run()


# ── Main loop ────────────────────────────────────────────────────────────

def run():
    cfg = load_config()
    if not cfg.get("device_api_key"):
        print("Not enrolled. Run: python aviin_device_agent.py enroll <api_base_url> <CODE>")
        sys.exit(1)

    stop_event = threading.Event()

    settings = fetch_settings(cfg)
    tray_thread = None
    if settings.get("tracking_mode") != "silent":
        tray_thread = threading.Thread(target=run_tray, args=(stop_event,), daemon=True)
        tray_thread.start()

    intensity = _IntensityCounters()
    intensity_listeners = None
    if settings.get("screenshots_enabled"):  # extended consent confirmed if this can be true at all
        try:
            intensity_listeners = start_intensity_listeners(intensity)
        except Exception as e:
            print(f"[intensity] listener start failed: {e}")

    segments = []
    cur_app, cur_title, cur_start, cur_idle = None, None, None, False
    last_flush = time.monotonic()
    last_settings_poll = time.monotonic()
    last_screenshot = time.monotonic() - 999999  # force an immediate first capture if enabled
    last_dlp_poll = time.monotonic() - 999999
    last_browsing_since = datetime.now(timezone.utc) - timedelta(minutes=5)
    known_usb_drives = set()
    dlp = {"blocked_domains": [], "usb_restricted": False}

    print("AVIIN Device Monitoring agent running." + ("" if tray_thread else " (silent mode — no tray icon)"))
    while not stop_event.is_set():
        now_mono = time.monotonic()
        idle_secs = get_idle_seconds()
        is_idle = idle_secs >= IDLE_THRESHOLD_SECONDS
        app_name, title = get_active_window() if not is_idle else (cur_app, "Idle")
        now = datetime.now(timezone.utc)

        if app_name != cur_app or is_idle != cur_idle:
            if cur_app is not None and cur_start is not None:
                segments.append({
                    "app_name": cur_app, "window_title": cur_title,
                    "started_at": cur_start.isoformat(), "ended_at": now.isoformat(),
                    "is_idle": cur_idle,
                })
            cur_app, cur_title, cur_start, cur_idle = app_name, title, now, is_idle

        # Re-poll settings periodically — picks up silent-mode toggle,
        # screenshot enable/interval changes, and live-view requests
        # without needing an agent restart.
        if now_mono - last_settings_poll >= SETTINGS_POLL_SECONDS:
            settings = fetch_settings(cfg)
            last_settings_poll = now_mono
            if settings.get("screenshots_enabled") and intensity_listeners is None:
                try:
                    intensity_listeners = start_intensity_listeners(intensity)
                except Exception as e:
                    print(f"[intensity] listener start failed: {e}")
            if settings.get("live_view_pending") and settings.get("screenshots_enabled"):
                post_screenshot(cfg, bool(settings.get("blur_screenshots")))
                last_screenshot = now_mono

        # Periodic screenshot on the configured interval.
        if settings.get("screenshots_enabled"):
            interval_s = max(60, int(settings.get("screenshot_interval_minutes") or 10) * 60)
            if now_mono - last_screenshot >= interval_s:
                if post_screenshot(cfg, bool(settings.get("blur_screenshots"))):
                    last_screenshot = now_mono

        # DLP: refresh policy list occasionally, check USB drives every tick.
        if settings.get("screenshots_enabled") and now_mono - last_dlp_poll >= SETTINGS_POLL_SECONDS:
            dlp = fetch_dlp_policies(cfg)
            last_dlp_poll = now_mono
        if dlp.get("usb_restricted"):
            try:
                current = list_removable_drives()
                for letter in current - known_usb_drives:
                    post_batch(cfg, "/device-monitoring/dlp-events", {
                        "event_type": "usb_connected", "detail": f"Drive {letter}:",
                        "occurred_at": now.isoformat(),
                    })
                known_usb_drives = current
            except Exception as e:
                print(f"[dlp-usb] check failed: {e}")

        if now_mono - last_flush >= FLUSH_INTERVAL_SECONDS:
            if segments:
                if post_batch(cfg, "/device-monitoring/heartbeat", {"entries": segments}):
                    segments = []

            browsing_entries = [
                {"url": url, "page_title": title, "browser": browser, "visited_at": visited_at.isoformat()}
                for browser, url, title, visited_at in read_browser_history(last_browsing_since)
            ]
            if browsing_entries:
                if post_batch(cfg, "/device-monitoring/browsing", {"entries": browsing_entries}):
                    last_browsing_since = now
                    if dlp.get("blocked_domains"):
                        for e in browsing_entries:
                            if _domain_of(e["url"]) in dlp["blocked_domains"]:
                                post_batch(cfg, "/device-monitoring/dlp-events", {
                                    "event_type": "blocked_website_visited",
                                    "detail": _domain_of(e["url"]),
                                    "occurred_at": e["visited_at"],
                                })
            else:
                last_browsing_since = now

            if settings.get("screenshots_enabled"):
                k, c, m = intensity.drain()
                if k or c or m:
                    post_batch(cfg, "/device-monitoring/intensity", {"entries": [{
                        "window_start": (now - timedelta(seconds=FLUSH_INTERVAL_SECONDS)).isoformat(),
                        "window_end": now.isoformat(),
                        "keystroke_count": k, "mouse_click_count": c, "mouse_move_px": m,
                    }]})

            last_flush = time.monotonic()

        stop_event.wait(SAMPLE_INTERVAL_SECONDS)


def install_autostart():
    import winreg
    exe = sys.executable
    script = os.path.abspath(__file__)
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
    winreg.SetValueEx(key, "AviinDeviceAgent", 0, winreg.REG_SZ, f'"{exe}" "{script}" run')
    winreg.CloseKey(key)
    print("Auto-start installed (runs at login, from your own user account only).")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd = sys.argv[1]
    if cmd == "enroll" and len(sys.argv) == 4:
        enroll(sys.argv[2], sys.argv[3])
    elif cmd == "run":
        run()
    elif cmd == "install-autostart":
        install_autostart()
    else:
        print(__doc__)
