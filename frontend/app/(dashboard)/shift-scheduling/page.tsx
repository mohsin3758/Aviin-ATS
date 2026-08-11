'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { CalendarClock, Plus, Trash2, RefreshCw, Check, X } from 'lucide-react';

const inputStyle: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '7px 10px', fontSize: '12.5px', outline: 'none', color: '#1e293b', background: 'white', boxSizing: 'border-box' };

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px' }}>{children}</div>;
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function fmtDate(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function TemplatesPanel({ canManage }: { canManage: boolean }) {
  const { data: templates, refetch } = useFetch<any[]>('/shift-scheduling/templates');
  const [form, setForm] = useState({ name: '', start_time: '09:00', end_time: '18:00', color: '#2563eb' });
  async function create() {
    if (!form.name) return;
    await apiFetch('/shift-scheduling/templates', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', start_time: '09:00', end_time: '18:00', color: '#2563eb' });
    refetch();
  }
  async function remove(id: string) {
    await apiFetch(`/shift-scheduling/templates/${id}`, { method: 'DELETE' });
    refetch();
  }
  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>Shift Templates</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {(templates || []).filter((t: any) => t.is_active).map((t: any) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#f8fafc', borderRadius: 7 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: t.color }} />
            <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{t.name}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{t.start_time?.slice(0, 5)}–{t.end_time?.slice(0, 5)}</div>
            {canManage && <button onClick={() => remove(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={12} style={{ color: '#dc2626' }} /></button>}
          </div>
        ))}
        {(!templates || templates.filter((t: any) => t.is_active).length === 0) && <div style={{ fontSize: 12, color: '#94a3b8' }}>No templates yet.</div>}
      </div>
      {canManage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input style={inputStyle} placeholder="Template name (e.g. Day 9-6)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="time" style={{ ...inputStyle, flex: 1 }} value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            <input type="time" style={{ ...inputStyle, flex: 1 }} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: 34, height: 32, border: '1px solid #e2e8f0', borderRadius: 6, padding: 2 }} />
          </div>
          <button onClick={create} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e40af', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={12} style={{ verticalAlign: 'text-bottom' }} /> Add Template
          </button>
        </div>
      )}
    </Card>
  );
}

function TeamCalendar({ canManage }: { canManage: boolean }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: templates } = useFetch<any[]>('/shift-scheduling/templates');
  const { data: shifts, refetch } = useFetch<any[]>(`/shift-scheduling/shifts?date_from=${fmtDate(days[0])}&date_to=${fmtDate(days[6])}`);
  const [picking, setPicking] = useState<{ userId: string; date: string } | null>(null);

  const userList = Array.isArray(users) ? users : (users as any)?.items || [];
  const shiftFor = (userId: string, date: string) => (shifts || []).find((s: any) => s.user_id === userId && s.shift_date === date);

  async function assign(userId: string, date: string, templateId: string) {
    if (!templateId) return;
    await apiFetch('/shift-scheduling/shifts', { method: 'POST', body: JSON.stringify({ user_id: userId, template_id: templateId, shift_date: date }) });
    setPicking(null); refetch();
  }
  async function remove(shiftId: string) {
    await apiFetch(`/shift-scheduling/shifts/${shiftId}`, { method: 'DELETE' });
    refetch();
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtDate(days[0])} → {fmtDate(days[6])}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12 }}>← Prev</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12 }}>Today</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 12 }}>Next →</button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10.5, color: '#64748b', textTransform: 'uppercase' }}>Staff</th>
              {days.map(d => (
                <th key={fmtDate(d)} style={{ padding: '6px 8px', fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', minWidth: 90 }}>
                  {d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {userList.map((u: any) => (
              <tr key={u.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{u.full_name}</td>
                {days.map(d => {
                  const dstr = fmtDate(d);
                  const s = shiftFor(u.id, dstr);
                  const isPicking = picking?.userId === u.id && picking?.date === dstr;
                  return (
                    <td key={dstr} style={{ padding: '4px 6px', textAlign: 'center' }}>
                      {isPicking ? (
                        <select autoFocus style={{ ...inputStyle, fontSize: 11, padding: '3px 4px' }} onChange={e => assign(u.id, dstr, e.target.value)} onBlur={() => setPicking(null)}>
                          <option value="">Pick…</option>
                          {(templates || []).filter((t: any) => t.is_active).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      ) : s ? (
                        <div onClick={() => canManage && remove(s.id)} title={canManage ? 'Click to remove' : ''} style={{
                          fontSize: 10.5, fontWeight: 700, padding: '4px 6px', borderRadius: 6, cursor: canManage ? 'pointer' : 'default',
                          background: (s.template_color || '#2563eb') + '18', color: s.template_color || '#2563eb',
                        }}>
                          {s.template_name || `${s.start_time?.slice(0, 5)}-${s.end_time?.slice(0, 5)}`}
                        </div>
                      ) : canManage ? (
                        <button onClick={() => setPicking({ userId: u.id, date: dstr })} style={{ width: '100%', padding: '4px', border: '1px dashed #cbd5e1', borderRadius: 6, background: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}>+</button>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SwapRequestsPanel({ canManage }: { canManage: boolean }) {
  const { data: requests, refetch } = useFetch<any[]>('/shift-scheduling/swap-requests?status=pending');
  async function approve(id: string) { await apiFetch(`/shift-scheduling/swap-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }); refetch(); }
  async function reject(id: string) { await apiFetch(`/shift-scheduling/swap-requests/${id}/reject`, { method: 'POST', body: JSON.stringify({}) }); refetch(); }
  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>Pending Swap Requests</div>
      {(!requests || requests.length === 0) ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No pending swap requests.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map((r: any) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', background: '#f8fafc', borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.requested_by_name} · {r.shift_date}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{r.reason || 'No reason given'}{r.target_user_name ? ` → ${r.target_user_name}` : ''}</div>
              </div>
              {canManage && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => approve(r.id)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', cursor: 'pointer' }}><Check size={13} style={{ color: '#15803d' }} /></button>
                  <button onClick={() => reject(r.id)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', cursor: 'pointer' }}><X size={13} style={{ color: '#dc2626' }} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MyShiftsPanel() {
  const today = fmtDate(new Date());
  const { data: shifts } = useFetch<any[]>(`/shift-scheduling/my-shifts?date_from=${today}`);
  const [reqShift, setReqShift] = useState<any>(null);
  const [reason, setReason] = useState('');
  async function requestSwap() {
    if (!reqShift) return;
    await apiFetch('/shift-scheduling/swap-requests', { method: 'POST', body: JSON.stringify({ shift_id: reqShift.id, reason }) });
    setReqShift(null); setReason('');
  }
  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 10 }}>My Upcoming Shifts</div>
      {(!shifts || shifts.length === 0) ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No upcoming shifts scheduled.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shifts.slice(0, 10).map((s: any) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
              <div style={{ fontSize: 12.5 }}>
                <strong>{s.shift_date}</strong> · {s.template_name || `${s.start_time?.slice(0, 5)}-${s.end_time?.slice(0, 5)}`}
              </div>
              <button onClick={() => setReqShift(s)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer' }}>Request Swap</button>
            </div>
          ))}
        </div>
      )}
      {reqShift && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setReqShift(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 20, width: 360 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Request swap — {reqShift.shift_date}</div>
            <textarea style={{ ...inputStyle, width: '100%', minHeight: 60 }} placeholder="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={() => setReqShift(null)} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={requestSwap} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e40af', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function ShiftSchedulingPage() {
  const [canManage, setCanManage] = useState(false);
  useEffect(() => { setCanManage(['admin', 'super_admin', 'manager'].includes(getTokenPayload()?.role || '')); }, []);

  return (
    <div className="anim-fade-up">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarClock size={20} style={{ color: '#2563eb' }} /> Shift Scheduling
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Internal shift scheduling for your own team — separate from a requisition's own shift_type field.</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: canManage ? '1fr 280px' : '1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <TeamCalendar canManage={canManage} />
          <MyShiftsPanel />
          <SwapRequestsPanel canManage={canManage} />
        </div>
        {canManage && <TemplatesPanel canManage={canManage} />}
      </div>
    </div>
  );
}
