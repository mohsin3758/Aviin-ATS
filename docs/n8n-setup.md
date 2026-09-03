# n8n Webhook Setup for AVIIN ATS

Access n8n at: https://ats.aviintech.com/n8n/ or http://187.127.179.128:5678
(dashboard basic auth: see docker-compose.yml `WAHA_API_KEY`-style secrets —
ask the team, not committed here)

## Real, currently-registered webhooks (verified live 2026-08-10)

All of these return `{"message":"Workflow was started"}` / HTTP 200 on a
direct `POST http://n8n:5678/webhook/<path>` — confirmed by direct testing,
not by trusting a dashboard screenshot. Each mirrors the same shape (a
Webhook trigger node → a Set node that logs the payload); replace the Set
node with real logic (Slack post, email, etc.) as needed per workflow.

Tracked in `automation_workflows` (Settings > Automations shows real
fire_count/last_fired_at for these):
- `sla-breach-warning` — fired by `scheduler.py::process_sla_escalations()`
- `stale-requisitions` — same
- `new-application` — fired by `applications.py::create_application()`
- `offer-accepted` — fired by `offers.py::respond_offer()` (accept branch)
- `offer-dropped` — fired by `offers.py::respond_offer()` (decline branch)
- `placement-congrats` — fired alongside `offer-accepted`, same event
- `weekly-kpi` — fired by `scheduler.py::send_weekly_kpi_summary()`
- `interview-reminder-candidate` — fired by `scheduler.py::send_interview_reminders()`
- `interview-reminder-recruiter` — same job, interviewer side

Fired by `scheduler.py` but NOT tracked in `automation_workflows` (no
fire_count bookkeeping — these predate that table's convention):
- `retention-bank-released` — fired by `process_retention_bank_releases()`
- `loyalty-milestone-achieved` — fired by `check_loyalty_milestones()`
- `monthly-incentive-summary` — fired by `send_monthly_incentive_summary()`

Not registered here at all, but the single most-used real workflow in the
whole system — also not in `automation_workflows` (a known, documented
gap, not yet fixed):
- `aviin-stage-change` — fired from 4 call sites in `applications.py`/
  `pipeline_p2.py` on pipeline stage changes. 500+ real executions.

## Not buildable without new data capture

- `candidate-engagement` (Candidate Birthday/Anniversary) was removed from
  `automation_workflows` (`sql/40_offer_hitl_audit_backfill_and_cleanup.sql`)
  — no DOB/anniversary field exists anywhere in this schema. Re-add only
  alongside real data capture for that field, don't just re-register the
  webhook path with nothing feeding it.

## Re-registering a workflow after a fresh n8n volume / lost workflow

No REST API credentials are configured for this n8n instance, so workflows
are managed via its CLI, not the API:

```
# Build a workflow JSON matching the shape above (Webhook trigger -> Set
# node), copy it into the container, then:
docker exec aviin_n8n n8n import:workflow --input=/tmp/<file>.json --projectId=ngUWjYHU6zM1ncOQ
docker exec aviin_n8n n8n publish:workflow --id=<workflow-id>
docker compose restart n8n   # publish alone does not take effect while n8n is running
```

Verify with a direct webhook POST, not by trusting the CLI's own success
message — n8n's SQLite backend runs in WAL mode, so if you're inspecting
its database file directly, copy the `-wal`/`-shm` sidecar files alongside
the main `.sqlite` file or recent writes will look invisible.

```
curl -X POST http://localhost:5678/webhook/<path> -H "Content-Type: application/json" -d '{}'
# real: {"message":"Workflow was started"}  |  unregistered: 404
```

## If an n8n API key does get configured later

Settings → API → Enable n8n API → Generate API key, then a script driving
the REST API directly would be more ergonomic than the CLI import/publish/
restart cycle above for bulk changes — no such script exists in this repo
yet (the workflows above were all built via the CLI method).
