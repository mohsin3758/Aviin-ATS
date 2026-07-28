# AVIIN Device Monitoring Agent

Windows agent for company-issued laptops. Reports active-window/idle time
and browser URL history (Chrome/Edge) to the ATS. No keystrokes, no
screenshots, no screen content — see the in-app policy text at
`/device-monitoring` for exactly what it collects.

Never installs or runs without the device owner enrolling it themselves:
they consent in the ATS web UI, generate a one-time code, then run this
agent and paste that code in. There is no admin-push path.

## Setup (per laptop)

```
pip install -r requirements.txt
python aviin_device_agent.py enroll https://ats.aviinjobs.com/api <CODE>
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

The `--windowed` flag suppresses the console window; the tray icon is the
visible indicator instead. Distribute the resulting `dist/AviinDeviceAgent.exe`
plus a short internal doc pointing recruiters at the `/device-monitoring`
page to consent and get their enrollment code.

## What it does NOT do

- No personal devices — company-issued laptops only, by policy, not a
  technical restriction the agent enforces itself.
- No keystroke logging.
- No screenshots or screen-content capture.
- No covert operation — the tray icon is always present while running.
