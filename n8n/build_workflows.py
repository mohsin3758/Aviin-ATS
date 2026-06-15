#!/usr/bin/env python3
"""Generate n8n/workflows/wN_*.json for P2 (W1-W9).

Every Postgres node executes ONE multi-statement query with NO `$`
parameters (simple query protocol) so `SELECT set_config('app.tenant_id',
'<uuid>', false)` (HARD RULE #8) scopes RLS for the statements that
follow it in the same call. Free-text values (candidate names, job
titles, etc) are escaped with esc() (doubles single quotes) by the
preceding Code node before being interpolated into SQL text.

Re-run after editing this file:
  python3 n8n/build_workflows.py
then re-import via scripts/n8n_deploy.sh (see n8n/README.md).
"""
import json
import os

CRED = {"postgres": {"id": "pgAppUserAts0001", "name": "Postgres app_user (ats)"}}
OUTDIR = os.path.join(os.path.dirname(__file__), "workflows")

GET_TENANTS = {
    "id": "getTenants",
    "name": "Get tenants",
    "type": "n8n-nodes-base.postgres",
    "typeVersion": 2.5,
    "position": [220, 0],
    "parameters": {"operation": "executeQuery", "query": "SELECT id FROM tenants;", "options": {}},
    "credentials": CRED,
}


def schedule(rule):
    return {
        "id": "trigger",
        "name": "Schedule Trigger",
        "type": "n8n-nodes-base.scheduleTrigger",
        "typeVersion": 1.2,
        "position": [0, 0],
        "parameters": {"rule": {"interval": [rule]}},
    }


def pg_node(node_id, name, x, query_expr):
    return {
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.5,
        "position": [x, 0],
        "parameters": {"operation": "executeQuery", "query": query_expr, "options": {}},
        "credentials": CRED,
    }


def code_node(node_id, name, x, js):
    return {
        "id": node_id,
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [x, 0],
        "parameters": {"mode": "runOnceForEachItem", "language": "javaScript", "jsCode": js},
    }


def linear_connections(names):
    conns = {}
    for a, b in zip(names, names[1:]):
        conns[a] = {"main": [[{"node": b, "type": "main", "index": 0}]]}
    return conns


def workflow(wf_id, name, nodes, order):
    return {
        "id": wf_id,
        "name": name,
        "active": False,
        "nodes": nodes,
        "connections": linear_connections(order),
    }


def write(wf_id, name, nodes, order, filename):
    wf = workflow(wf_id, name, nodes, order)
    path = os.path.join(OUTDIR, filename)
    with open(path, "w") as f:
        json.dump(wf, f, indent=2)
        f.write("\n")
    print("wrote", path)


# ESC helper, prepended to every Code node's jsCode.
ESC = "const esc = (s) => String(s).replace(/'/g, \"''\");\n"

# GUARD: every "Get ..." Postgres node runs a two-statement query
# (`SELECT set_config(...); SELECT ...;`). n8n's Postgres node
# concatenates the result rows of BOTH statements into its output
# items, so the first item for each tenant is the 1-row/1-column
# `{set_config: "<uuid>"}` result of statement 1, not a real data
# row. GUARD detects that phantom row (by its unique `set_config`
# column) and short-circuits to a harmless `SELECT 1;` instead of
# building SQL from `undefined` fields. Prepended (after ESC) to
# every Code node's jsCode.
GUARD = "const row = $input.item.json;\nif (Object.prototype.hasOwnProperty.call(row, 'set_config')) { return { json: { sql: 'SELECT 1;' } }; }\n"


# ---------------------------------------------------------------
# W1 — Event Outbox Dispatcher (generic catch-all). Owns
# event_outbox.processed_at for every event_type NOT claimed by
# W2-W5 below. Writes a generic admin-facing notification.
# ---------------------------------------------------------------
CLAIMED = "'candidate.created','requisition.created','application.stage_changed','offer.created','offer.issued','offer.accepted','offer.declined'"

w1_get_events = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT id, tenant_id, event_type, payload FROM event_outbox WHERE processed_at IS NULL AND event_type NOT IN (""" + CLAIMED + """) ORDER BY created_at LIMIT 50;" }}"""

w1_build_sql = ESC + GUARD + """const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
const tenant = row.tenant_id;
const prefix = row.event_type.split('.')[0];
const idField = prefix + '_id';
const entityId = payload[idField] || null;
const title = 'Event: ' + row.event_type;
const body = esc(JSON.stringify(payload));
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, recipient_role, channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', 'admin', 'inapp', '" + esc(title) + "', '" + body + "', " + (entityId ? "'" + prefix + "'" : "NULL") + ", " + (entityId ? "'" + entityId + "'" : "NULL") + "); ";
sql += "UPDATE event_outbox SET processed_at = now() WHERE id = " + row.id + ";";
return { json: { sql } };
"""

write(
    "wfP2W1Dispatch00", "P2-W1 Event Outbox Dispatcher",
    [
        schedule({"field": "seconds", "secondsInterval": 60}),
        GET_TENANTS,
        pg_node("getEvents", "Get unhandled events", 440, w1_get_events),
        code_node("buildSql", "Build notification SQL", 660, w1_build_sql),
        pg_node("write", "Write notification + mark processed", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get unhandled events", "Build notification SQL", "Write notification + mark processed"],
    "w1_event_outbox_dispatcher.json",
)


# ---------------------------------------------------------------
# W2 — New Candidate Alert (candidate.created -> recruiters)
# ---------------------------------------------------------------
w2_get_events = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT id, tenant_id, payload FROM event_outbox WHERE processed_at IS NULL AND event_type='candidate.created' ORDER BY created_at LIMIT 50;" }}"""

w2_build_sql = ESC + GUARD + """const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
const tenant = row.tenant_id;
const name = payload.full_name || 'Unknown';
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, recipient_role, channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', 'recruiter', 'inapp', 'New candidate added', '" + esc(name) + " has been added to the candidate pool.', 'candidate', '" + payload.candidate_id + "'); ";
sql += "UPDATE event_outbox SET processed_at = now() WHERE id = " + row.id + ";";
return { json: { sql } };
"""

write(
    "wfP2W2NewCandid0", "P2-W2 New Candidate Alert",
    [
        schedule({"field": "seconds", "secondsInterval": 60}),
        GET_TENANTS,
        pg_node("getEvents", "Get candidate.created events", 440, w2_get_events),
        code_node("buildSql", "Build notification SQL", 660, w2_build_sql),
        pg_node("write", "Write notification + mark processed", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get candidate.created events", "Build notification SQL", "Write notification + mark processed"],
    "w2_new_candidate_alert.json",
)


# ---------------------------------------------------------------
# W3 — New Requisition Alert (requisition.created -> managers)
# ---------------------------------------------------------------
w3_get_events = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT id, tenant_id, payload FROM event_outbox WHERE processed_at IS NULL AND event_type='requisition.created' ORDER BY created_at LIMIT 50;" }}"""

w3_build_sql = ESC + GUARD + """const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
const tenant = row.tenant_id;
const title = payload.title || 'Untitled';
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, recipient_role, channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', 'manager', 'inapp', 'New requisition opened', '\\"" + esc(title) + "\\" is open and needs a recruiter assigned.', 'requisition', '" + payload.requisition_id + "'); ";
sql += "UPDATE event_outbox SET processed_at = now() WHERE id = " + row.id + ";";
return { json: { sql } };
"""

write(
    "wfP2W3NewReq0000", "P2-W3 New Requisition Alert",
    [
        schedule({"field": "seconds", "secondsInterval": 60}),
        GET_TENANTS,
        pg_node("getEvents", "Get requisition.created events", 440, w3_get_events),
        code_node("buildSql", "Build notification SQL", 660, w3_build_sql),
        pg_node("write", "Write notification + mark processed", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get requisition.created events", "Build notification SQL", "Write notification + mark processed"],
    "w3_new_requisition_alert.json",
)


# ---------------------------------------------------------------
# W4 — Pipeline Stage Change Alert (application.stage_changed ->
# assigned recruiter, fallback manager)
# ---------------------------------------------------------------
w4_get_events = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT eo.id, eo.tenant_id, eo.payload, a.assigned_recruiter_id, c.full_name AS candidate_name, r.title AS req_title FROM event_outbox eo JOIN applications a ON a.id = (eo.payload->>'application_id')::uuid JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id WHERE eo.processed_at IS NULL AND eo.event_type='application.stage_changed' ORDER BY eo.created_at LIMIT 50;" }}"""

w4_build_sql = ESC + GUARD + """const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
const tenant = row.tenant_id;
const recruiterId = row.assigned_recruiter_id;
const title = 'Pipeline update: ' + esc(row.candidate_name);
let body = esc(row.candidate_name) + ' moved from ' + esc(payload.from) + ' to ' + esc(payload.to) + ' on \\"' + esc(row.req_title) + '\\"';
if (payload.reason) body += ' (' + esc(payload.reason) + ')';
body += '.';
const recipientCol = recruiterId ? 'recipient_user_id' : 'recipient_role';
const recipientVal = recruiterId ? "'" + recruiterId + "'" : "'manager'";
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, " + recipientCol + ", channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', " + recipientVal + ", 'inapp', '" + title + "', '" + body + "', 'application', '" + payload.application_id + "'); ";
sql += "UPDATE event_outbox SET processed_at = now() WHERE id = " + row.id + ";";
return { json: { sql } };
"""

write(
    "wfP2W4StageChg00", "P2-W4 Pipeline Stage Change Alert",
    [
        schedule({"field": "seconds", "secondsInterval": 60}),
        GET_TENANTS,
        pg_node("getEvents", "Get application.stage_changed events", 440, w4_get_events),
        code_node("buildSql", "Build notification SQL", 660, w4_build_sql),
        pg_node("write", "Write notification + mark processed", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get application.stage_changed events", "Build notification SQL", "Write notification + mark processed"],
    "w4_pipeline_stage_change_alert.json",
)


# ---------------------------------------------------------------
# W5 — Offer Lifecycle Alert (offer.created -> manager;
# offer.issued/accepted/declined -> assigned recruiter, fallback manager)
# ---------------------------------------------------------------
w5_get_events = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT eo.id, eo.tenant_id, eo.event_type, eo.payload, a.assigned_recruiter_id, c.full_name AS candidate_name, r.title AS req_title FROM event_outbox eo JOIN applications a ON a.id = (eo.payload->>'application_id')::uuid JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id WHERE eo.processed_at IS NULL AND eo.event_type IN ('offer.created','offer.issued','offer.accepted','offer.declined') ORDER BY eo.created_at LIMIT 50;" }}"""

w5_build_sql = ESC + GUARD + """const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
const tenant = row.tenant_id;
const recruiterId = row.assigned_recruiter_id;
const candidate = esc(row.candidate_name);
const reqTitle = esc(row.req_title);
let recipientCol, recipientVal, title, body;
if (row.event_type === 'offer.created') {
  recipientCol = 'recipient_role';
  recipientVal = "'manager'";
  title = 'Offer needs approval';
  body = 'Offer drafted for ' + candidate + ' on \\"' + reqTitle + '\\" \\u2014 submit for approval.';
} else {
  const status = row.event_type.split('.')[1];
  recipientCol = recruiterId ? 'recipient_user_id' : 'recipient_role';
  recipientVal = recruiterId ? "'" + recruiterId + "'" : "'manager'";
  title = 'Offer ' + status + ': ' + candidate;
  body = 'Offer for ' + candidate + ' on \\"' + reqTitle + '\\" is now ' + status + '.';
}
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, " + recipientCol + ", channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', " + recipientVal + ", 'inapp', '" + title + "', '" + body + "', 'offer', '" + payload.offer_id + "'); ";
sql += "UPDATE event_outbox SET processed_at = now() WHERE id = " + row.id + ";";
return { json: { sql } };
"""

write(
    "wfP2W5OfferLfc00", "P2-W5 Offer Lifecycle Alert",
    [
        schedule({"field": "seconds", "secondsInterval": 60}),
        GET_TENANTS,
        pg_node("getEvents", "Get offer.* events", 440, w5_get_events),
        code_node("buildSql", "Build notification SQL", 660, w5_build_sql),
        pg_node("write", "Write notification + mark processed", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get offer.* events", "Build notification SQL", "Write notification + mark processed"],
    "w5_offer_lifecycle_alert.json",
)


# ---------------------------------------------------------------
# W6 — HITL Approval Reminder (offers stuck in pending_approval >4h
# -> managers). NEVER auto-approves (HARD RULE #10).
# ---------------------------------------------------------------
w6_get_stale = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT '" + $json.id + "' AS tenant_id, o.id AS offer_id, c.full_name AS candidate_name, r.title AS req_title, ROUND(EXTRACT(EPOCH FROM (now()-o.updated_at))/3600,1) AS hours_pending FROM offers o JOIN applications a ON a.id=o.application_id JOIN candidates c ON c.id=a.candidate_id JOIN requisitions r ON r.id=a.requisition_id WHERE o.status='pending_approval' AND o.updated_at < now() - interval '4 hours' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.related_entity_type='offer' AND n.related_entity_id=o.id AND n.title='Offer pending approval' AND n.created_at > now() - interval '4 hours') LIMIT 50;" }}"""

w6_build_sql = ESC + GUARD + """const tenant = row.tenant_id;
const title = 'Offer pending approval';
const body = 'Offer for ' + esc(row.candidate_name) + ' on \\"' + esc(row.req_title) + '\\" has been pending approval for ' + row.hours_pending + ' hours.';
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, recipient_role, channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', 'manager', 'inapp', '" + title + "', '" + body + "', 'offer', '" + row.offer_id + "');";
return { json: { sql } };
"""

write(
    "wfP2W6HitlRemd00", "P2-W6 HITL Approval Reminder",
    [
        schedule({"field": "minutes", "minutesInterval": 15}),
        GET_TENANTS,
        pg_node("getStale", "Get stale pending_approval offers", 440, w6_get_stale),
        code_node("buildSql", "Build notification SQL", 660, w6_build_sql),
        pg_node("write", "Write notification", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get stale pending_approval offers", "Build notification SQL", "Write notification"],
    "w6_hitl_approval_reminder.json",
)


# ---------------------------------------------------------------
# W7 — Stalled Assignment Monitor (find_stalled_assignments, 72h ->
# managers). Flags for human review only, never auto-reassigns
# (HARD RULE #10).
# ---------------------------------------------------------------
w7_get_stalled = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT '" + $json.id + "' AS tenant_id, f.* FROM find_stalled_assignments(72) f WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.related_entity_type='assignment' AND n.related_entity_id=f.assignment_id AND n.created_at > now() - interval '24 hours') LIMIT 50;" }}"""

w7_build_sql = ESC + GUARD + """const tenant = row.tenant_id;
const title = 'Assignment stalled';
const body = esc(row.recruiter_name) + ' has had no activity on \\"' + esc(row.requisition_title) + '\\" for ' + row.hours_since_update + ' hours (assigned ' + row.assigned_at + ').';
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, recipient_role, channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', 'manager', 'inapp', '" + title + "', '" + body + "', 'assignment', '" + row.assignment_id + "');";
return { json: { sql } };
"""

write(
    "wfP2W7Stalled000", "P2-W7 Stalled Assignment Monitor",
    [
        schedule({"field": "hours", "hoursInterval": 6}),
        GET_TENANTS,
        pg_node("getStalled", "Get stalled assignments", 440, w7_get_stalled),
        code_node("buildSql", "Build notification SQL", 660, w7_build_sql),
        pg_node("write", "Write notification", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get stalled assignments", "Build notification SQL", "Write notification"],
    "w7_stalled_assignment_monitor.json",
)


# ---------------------------------------------------------------
# W8 — SLA Breach Monitor (find_sla_breaches -> managers)
# ---------------------------------------------------------------
w8_get_breaches = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT '" + $json.id + "' AS tenant_id, f.* FROM find_sla_breaches() f WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.related_entity_type='requisition' AND n.related_entity_id=f.requisition_id AND n.title='Requisition SLA breached' AND n.created_at > now() - interval '24 hours') LIMIT 50;" }}"""

w8_build_sql = ESC + GUARD + """const tenant = row.tenant_id;
const title = 'Requisition SLA breached';
const body = '\\"' + esc(row.title) + '\\" has been open ' + row.hours_open + ' hours (SLA ' + row.sla_hours + 'h) with ' + row.placements_count + '/' + row.positions_count + ' positions filled.';
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
sql += "INSERT INTO notifications (tenant_id, recipient_role, channel, title, body, related_entity_type, related_entity_id) VALUES ('" + tenant + "', 'manager', 'inapp', '" + title + "', '" + body + "', 'requisition', '" + row.requisition_id + "');";
return { json: { sql } };
"""

write(
    "wfP2W8SlaBreach0", "P2-W8 SLA Breach Monitor",
    [
        schedule({"field": "hours", "hoursInterval": 1}),
        GET_TENANTS,
        pg_node("getBreaches", "Get SLA breaches", 440, w8_get_breaches),
        code_node("buildSql", "Build notification SQL", 660, w8_build_sql),
        pg_node("write", "Write notification", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get SLA breaches", "Build notification SQL", "Write notification"],
    "w8_sla_breach_monitor.json",
)


# ---------------------------------------------------------------
# W9 — Job-Board Distribution Queue. Queues (board, status='queued')
# rows for open requisitions; NO external Naukri/Indeed/LinkedIn API
# calls (no credentials exist, zero-token scaffold for a future
# delivery worker).
# ---------------------------------------------------------------
w9_get_open = '=' + """{{ "SELECT set_config('app.tenant_id','" + $json.id + "', false); SELECT '" + $json.id + "' AS tenant_id, r.id AS requisition_id, r.title FROM requisitions r WHERE r.status='open' AND NOT EXISTS (SELECT 1 FROM job_board_postings jb WHERE jb.requisition_id=r.id) LIMIT 50;" }}"""

w9_build_sql = GUARD + """const tenant = row.tenant_id;
const boards = ['naukri','indeed','linkedin'];
let sql = "SELECT set_config('app.tenant_id','" + tenant + "', false); ";
for (const b of boards) {
  sql += "INSERT INTO job_board_postings (tenant_id, requisition_id, board, status) VALUES ('" + tenant + "', '" + row.requisition_id + "', '" + b + "', 'queued') ON CONFLICT (tenant_id, requisition_id, board) DO NOTHING; ";
}
return { json: { sql } };
"""

write(
    "wfP2W9JobBoard00", "P2-W9 Job-Board Distribution Queue",
    [
        schedule({"field": "minutes", "minutesInterval": 5}),
        GET_TENANTS,
        pg_node("getOpenReqs", "Get open reqs needing posting", 440, w9_get_open),
        code_node("buildSql", "Build queue-insert SQL", 660, w9_build_sql),
        pg_node("write", "Queue job-board postings", 880, "={{ $json.sql }}"),
    ],
    ["Schedule Trigger", "Get tenants", "Get open reqs needing posting", "Build queue-insert SQL", "Queue job-board postings"],
    "w9_job_board_distribution_queue.json",
)
