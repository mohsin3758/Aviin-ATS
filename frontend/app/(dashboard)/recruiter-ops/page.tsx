'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { Circle, ListChecks, Target, Flame, Plus, X, Clock, Sparkles, CalendarOff } from 'lucide-react';

const TABS = [
  { key: 'autoassign', label: 'Auto-Assign', icon: Sparkles },
  { key: 'presence', label: 'Presence', icon: Circle },
  { key: 'sessions', label: 'Work Sessions', icon: Clock },
  { key: 'tasks', label: 'Tasks', icon: ListChecks },
  { key: 'targets', label: 'Targets', icon: Target },
  { key: 'hotlist', label: 'Hotlist', icon: Flame },
  { key: 'leave', label: 'Leave', icon: CalendarOff },
];

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

function AutoAssignTab() {
  const { data: reqs, loading: reqsLoading } = useFetch<any[]>('/requisitions?status=open');
  const { data: assignments, loading: assignLoading, refetch } = useFetch<any[]>('/assignments');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const activeReqIds = new Set((assignments || []).filter((a: any) => a.status === 'active').map((a: any) => a.requisition_id));
  const unassigned = (reqs || []).filter((r: any) => !activeReqIds.has(r.id) && !results[r.id]);

  const autoAssign = async (reqId: string) => {
    setBusyId(reqId);
    setErrors(e => ({ ...e, [reqId]: '' }));
    try {
      const result = await apiFetch(`/requisitions/${reqId}/assign`, { method: 'POST' });
      setResults(r => ({ ...r, [reqId]: result }));
      refetch();
    } catch (e: any) {
      setErrors(er => ({ ...er, [reqId]: e?.message || 'Auto-assign failed' }));
    } finally { setBusyId(null); }
  };

  const loading = reqsLoading || assignLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Unassigned Open Requisitions</div>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
          Auto-Assign picks the top-ranked recruiter via <code>assign_with_explanation()</code> (skill match + capacity), same as the button on each requisition's detail page — surfaced here so nothing needing a recruiter goes unnoticed.
        </p>
        {loading && <div style={{ fontSize: 12, color: '#94A3B8' }}>Loading…</div>}
        {!loading && !unassigned.length && (
          <div style={{ fontSize: 12, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 6 }}>✓ Every open requisition has an active recruiter assigned.</div>
        )}
        {unassigned.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#1E293B' }}>{r.title}</div>
              <div style={{ color: '#64748B' }}>{r.location || 'Remote'} · {r.positions_count} opening{r.positions_count > 1 ? 's' : ''}</div>
              {errors[r.id] && <div style={{ color: '#DC2626', marginTop: 4 }}>{errors[r.id]}</div>}
            </div>
            <button onClick={() => autoAssign(r.id)} disabled={busyId === r.id}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: '1px solid #C7D2FE', background: '#EEF2FF', fontSize: 11, fontWeight: 700, color: '#4338CA', cursor: busyId === r.id ? 'default' : 'pointer', flexShrink: 0 }}>
              <Sparkles size={12} /> {busyId === r.id ? 'Assigning…' : 'Auto-Assign (AI)'}
            </button>
          </div>
        ))}
      </div>
      {Object.keys(results).length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Just Assigned</div>
          {Object.entries(results).map(([reqId, result]: [string, any]) => (
            <div key={reqId} style={{ fontSize: 12, color: '#4338CA', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.6 }}>
              <strong>{result.recruiter_name}</strong> auto-assigned (match score {Math.round((result.match_score || 0) * 100) / 100}%).
              {result.explanation?.skill_match_count != null && (
                <> {result.explanation.skill_match_count} skill match(es), {result.explanation.available_capacity} slot(s) free.</>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PresenceTab() {
  const { data } = useFetch<any>('/recruiter-tracking/presence');
  const { data: activity } = useFetch<any>('/recruiter-tracking/activity');
  const colors: any = { online: '#16A34A', away: '#D97706', offline: '#94A3B8' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {['online', 'away', 'offline'].map(k => (
          <div key={k} style={{ ...card, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: colors[k] }}>{data?.[k] ?? 0}</div>
            <div style={{ fontSize: 11, color: '#64748B', textTransform: 'capitalize' }}>{k}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recruiters</div>
        {(data?.recruiters || []).map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <Circle size={8} fill={colors[r.presence]} color={colors[r.presence]} />
            <span style={{ flex: 1 }}>{r.full_name}</span>
            <span style={{ color: '#94A3B8' }}>{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : 'never seen'}</span>
          </div>
        ))}
        {!data?.recruiters?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No recruiters found.</div>}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recent Activity</div>
        {(activity?.activity || []).map((a: any) => (
          <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
            <strong>{a.actor_name}</strong> {a.action} {a.entity_type} · <span style={{ color: '#94A3B8' }}>{new Date(a.created_at).toLocaleString()}</span>
          </div>
        ))}
        {!activity?.activity?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No recent activity.</div>}
      </div>
    </div>
  );
}

function LeaveTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: leave, refetch } = useFetch<any[]>('/recruiter-leave?upcoming_only=true');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', leave_type: 'vacation', start_date: '', end_date: '', notes: '' });
  const [err, setErr] = useState('');

  const add = async () => {
    if (!form.recruiter_id || !form.start_date || !form.end_date) { setErr('Recruiter, start date, and end date are required'); return; }
    setErr('');
    try {
      await apiFetch('/recruiter-leave', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false); setForm({ recruiter_id: '', leave_type: 'vacation', start_date: '', end_date: '', notes: '' }); refetch();
    } catch (e: any) { setErr(e?.message || 'Failed to add leave'); }
  };
  const remove = async (id: string) => { await apiFetch(`/recruiter-leave/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#64748B' }}>Recruiters on leave are excluded from Auto-Assign scoring for the duration of their leave.</p>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Log Leave
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>TYPE</label>
          <select value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })} style={input}>
            <option value="vacation">Vacation</option><option value="sick">Sick</option>
            <option value="personal">Personal</option><option value="other">Other</option>
          </select>
          <label style={label}>START DATE</label>
          <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} style={input} />
          <label style={label}>END DATE</label>
          <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} style={input} />
          {err && <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 8 }}>{err}</div>}
          <button onClick={add} style={btn}>Save</button>
        </div>
      )}
      <div style={card}>
        {(leave || []).map((l: any) => {
          const today = new Date().toISOString().slice(0, 10);
          const active = l.start_date <= today && l.end_date >= today;
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l.recruiter_name}</span>
              <span style={{ color: '#64748B', textTransform: 'capitalize' }}>{l.leave_type}</span>
              <span style={{ color: '#94A3B8' }}>{l.start_date} → {l.end_date}</span>
              {active && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626' }}>ON LEAVE NOW</span>}
              <button onClick={() => remove(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
            </div>
          );
        })}
        {!leave?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No upcoming or active leave logged.</div>}
      </div>
    </div>
  );
}

function WorkSessionsTab() {
  const { data, refetch } = useFetch<any>('/work-sessions');
  const [busy, setBusy] = useState(false);

  const clockIn = async () => { setBusy(true); try { await apiFetch('/work-sessions/clock-in', { method: 'POST' }); refetch(); } finally { setBusy(false); } };
  const clockOut = async () => { setBusy(true); try { await apiFetch('/work-sessions/clock-out', { method: 'POST' }); refetch(); } finally { setBusy(false); } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
        {data?.open_session ? (
          <>
            <div style={{ flex: 1, fontSize: 13 }}>Clocked in since <strong>{new Date(data.open_session.clock_in).toLocaleTimeString()}</strong></div>
            <button onClick={clockOut} disabled={busy} style={{ ...btn, background: '#DC2626' }}>{busy ? '…' : 'Clock Out'}</button>
          </>
        ) : (
          <>
            <div style={{ flex: 1, fontSize: 13, color: '#64748B' }}>Not currently clocked in.</div>
            <button onClick={clockIn} disabled={busy} style={{ ...btn, background: '#16A34A' }}>{busy ? '…' : 'Clock In'}</button>
          </>
        )}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recent Sessions</div>
        {(data?.sessions || []).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1 }}>{new Date(s.clock_in).toLocaleString()}</span>
            <span style={{ color: '#64748B' }}>{s.clock_out ? `${s.duration_mins} min` : 'in progress'}</span>
          </div>
        ))}
        {!data?.sessions?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No sessions logged yet.</div>}
      </div>
    </div>
  );
}

function TasksTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: tasks, refetch } = useFetch<any[]>('/recruiter-tasks');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', title: '', task_type: 'general', priority: 'medium', due_at: '' });
  const userMap = Object.fromEntries((users || []).map((u: any) => [u.id, u.full_name]));

  const create = async () => {
    if (!form.recruiter_id || !form.title) return;
    await apiFetch('/recruiter-tasks', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false); setForm({ recruiter_id: '', title: '', task_type: 'general', priority: 'medium', due_at: '' }); refetch();
  };
  const setStatus = async (id: string, status: string) => {
    await apiFetch(`/recruiter-tasks/${id}?status=${status}`, { method: 'PATCH' }); refetch();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> New Task
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>TITLE</label>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={input} />
          <label style={label}>PRIORITY</label>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={input}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <label style={label}>DUE DATE</label>
          <input type="date" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} style={input} />
          <button onClick={create} style={btn}>Create</button>
        </div>
      )}
      <div style={card}>
        {(tasks || []).map((t: any) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1, textDecoration: t.status === 'completed' ? 'line-through' : 'none', color: t.status === 'completed' ? '#94A3B8' : '#1E293B' }}>{t.title}</span>
            <span style={{ color: '#64748B' }}>{userMap[t.recruiter_id] || '—'}</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: t.priority === 'high' ? '#FEF2F2' : '#F1F5F9', color: t.priority === 'high' ? '#DC2626' : '#64748B' }}>{t.priority}</span>
            <select value={t.status} onChange={e => setStatus(t.id, e.target.value)} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
              <option value="pending">Pending</option><option value="in_progress">In Progress</option>
              <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
        ))}
        {!tasks?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No tasks yet.</div>}
      </div>
    </div>
  );
}

function TargetsTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const now = new Date();
  const { data: targets, refetch } = useFetch<any[]>(`/recruiter-targets?period_year=${now.getFullYear()}`);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', target_submissions: 10, target_interviews: 5, target_placements: 2, target_work_hours: 160 });
  const role = getTokenPayload()?.role || '';
  const canManage = ['admin', 'super_admin', 'manager'].includes(role);

  const create = async () => {
    if (!form.recruiter_id) return;
    await apiFetch('/recruiter-targets', { method: 'POST', body: JSON.stringify({ ...form, period_month: now.getMonth() + 1, period_year: now.getFullYear() }) });
    setShowForm(false); refetch();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Plus size={14} /> Set Target
        </button>
      )}
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>TARGET SUBMISSIONS (this month)</label>
          <input type="number" value={form.target_submissions} onChange={e => setForm({ ...form, target_submissions: +e.target.value })} style={input} />
          <label style={label}>TARGET INTERVIEWS</label>
          <input type="number" value={form.target_interviews} onChange={e => setForm({ ...form, target_interviews: +e.target.value })} style={input} />
          <label style={label}>TARGET PLACEMENTS</label>
          <input type="number" value={form.target_placements} onChange={e => setForm({ ...form, target_placements: +e.target.value })} style={input} />
          <button onClick={create} style={btn}>Save</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        {(targets || []).map((t: any) => {
          const pct = t.target_submissions ? Math.min(100, Math.round((t.actual_submissions / t.target_submissions) * 100)) : 0;
          return (
            <div key={t.id} style={card}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.recruiter_name}</div>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>{t.period_month}/{t.period_year}</div>
              <div style={{ fontSize: 11, color: '#374151', marginBottom: 4 }}>Submissions: {t.actual_submissions}/{t.target_submissions}</div>
              <div style={{ height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#16A34A' : '#2563EB', borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
        {!targets?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No targets set for this year.</div>}
      </div>
    </div>
  );
}

function HotlistTab() {
  const { data: candidates } = useFetch<any>('/candidates?limit=200');
  const { data: hotlist, refetch } = useFetch<any[]>('/hotlist');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ candidate_id: '', available_from: '', reason: '', notes: '' });
  const candList = candidates?.items || [];

  const add = async () => {
    if (!form.candidate_id) return;
    await apiFetch('/hotlist', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false); setForm({ candidate_id: '', available_from: '', reason: '', notes: '' }); refetch();
  };
  const remove = async (id: string) => { await apiFetch(`/hotlist/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Add to Hotlist
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>CANDIDATE</label>
          <select value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {candList.slice(0, 200).map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <label style={label}>AVAILABLE FROM</label>
          <input type="date" value={form.available_from} onChange={e => setForm({ ...form, available_from: e.target.value })} style={input} />
          <label style={label}>REASON</label>
          <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            <option value="bench">On bench (available now)</option>
            <option value="contract_ending">Contract ending soon</option>
            <option value="other">Other</option>
          </select>
          <button onClick={add} disabled={!form.candidate_id || !form.reason} style={btn}>Add</button>
        </div>
      )}
      <div style={card}>
        {(hotlist || []).map((h: any) => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{h.full_name}</span>
            <span style={{ color: '#64748B' }}>{h.reason}</span>
            <span style={{ color: '#94A3B8' }}>{h.available_from ? `from ${h.available_from}` : ''}</span>
            <button onClick={() => remove(h.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
          </div>
        ))}
        {!hotlist?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>Hotlist is empty.</div>}
      </div>
    </div>
  );
}

export default function RecruiterOpsPage() {
  const [tab, setTab] = useState('autoassign');
  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Recruiter Ops</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>AI auto-assignment, presence, tasks, monthly targets, and the candidate hotlist.</p>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === t.key ? '#2563EB' : '#64748B', borderBottom: tab === t.key ? '2px solid #2563EB' : '2px solid transparent' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'autoassign' && <AutoAssignTab />}
      {tab === 'presence' && <PresenceTab />}
      {tab === 'sessions' && <WorkSessionsTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'hotlist' && <HotlistTab />}
      {tab === 'leave' && <LeaveTab />}
    </div>
  );
}
