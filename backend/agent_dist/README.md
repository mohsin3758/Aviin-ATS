# AVIIN Device Monitoring Agent

Windows agent for company-issued laptops. Base scope: reports
active-window/idle time and browser URL history (Chrome/Edge) to the
ATS. See the in-app policy text at `/device-monitoring` for exactly
what's collected.

Never installs or runs without the device owner enrolling it themselves:
they consent in the ATS web UI, generate a one-time code, then run this
agent and paste that code in. There is no admin-push path.

## Extended scope (opt-in per device)

A device owner can separately consent to an extended scope, which
unlocks (still all controlled per-device from the ATS web UI, never
locally by the agent itself):

- Periodic screenshots + an on-demand live-view capture
- Keystroke/mouse activity **intensity** — the rate/count of keys
  pressed and clicks made, never the actual keys typed or click
  targets. This agent contains no keylogger.
- DLP detection — visits to a blocked-website list, USB storage
  connection. Alert-only; this agent never blocks anything.
- A silent tracking mode (no tray icon)

Every one of these is OFF by default and only activates once the
backend confirms the extended consent record is on file for that user.

## Setup (per laptop)

```
pip install -r requirements.txt
python aviin_device_agent.py enroll https://ats.aviintech.com/api <CODE>
python aviin_device_agent.py run
```

To start automatically at login:

```
python aviin_device_agent.py install-autostart
```

This adds a per-user (`HKEY_CURRENT_USER`) autostart entry — it does not
require admin rights and only affects the account that runs it.

## Packaging as a standalone .exe

For real deployment (so recruiters don't need Python installed), build
with [PyInstaller](https://pyinstaller.org/):

```
pip install pyinstaller
pyinstaller --onefile --windowed --name AviinDeviceAgent aviin_device_agent.py
```

The `--windowed` flag suppresses the console window; the tray icon (when
not in silent mode) is the visible indicator instead. Distribute the
resulting `dist/AviinDeviceAgent.exe` plus a short internal doc pointing
recruiters at the `/device-monitoring` page to consent and get their
enrollment code.

## What it does NOT do, ever, at any consent level

- No personal devices — company-issued laptops only, by policy, not a
  technical restriction the agent enforces itself.
- No keystroke *content* logging — intensity tracking (if enabled)
  counts events, never records which key or where a click landed.
- No window-content, OCR, or clipboard capture — screenshots (if
  enabled) are a periodic still image of the screen only.
- No DLP *enforcement* — blocked-website and USB detection are
  alert-only; nothing is ever blocked by this agent.
