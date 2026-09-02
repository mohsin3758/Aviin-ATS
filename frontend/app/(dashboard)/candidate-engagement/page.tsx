'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { Users2, Gift, Smile, Plus, Copy } from 'lucide-react';

const TABS = [
  { key: 'talent', label: 'Talent Pool', icon: Users2 },
  { key: 'referrals', label: 'Referrals', icon: Gift },
  { key: 'nps', label: 'NPS Surveys', icon: Smile },
];

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };

function TalentPoolTab() {
  const { data, refetch } = useFetch<any>('/talent-pool/');
  const rows = data?.candidates || [];
  const [toggling, setToggling] = useState<string | null>(null);
  const toggle = async (id: string) => {
    setToggling(id);
    try { await apiFetch('/talent-pool/' + id + '/toggle', { method: 'PATCH' }); refetch(); }
    finally { setToggling(null); }
  };
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Subscribers ({rows.length})</div>
      {rows.map((r: any) => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
          <span style={{ flex: 1, fontWeight: 600 }}>{r.name || r.email}</span>
          <span style={{ color: '#64748B' }}>{(r.job_categories || []).join(', ')}</span>
          <span style={{ color: '#94A3B8' }}>{r.preferred_location}</span>
          <button onClick={() => toggle(r.id)} disabled={toggling === r.id} title="Click to toggle active/inactive"
            style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, border: 'none', cursor: toggling === r.id ? 'default' : 'pointer', background: r.is_active ? '#F0FDF4' : '#F1F5F9', color: r.is_active ? '#16A34A' : '#94A3B8', opacity: toggling === r.id ? 0.6 : 1 }}>
            {toggling === r.id ? '…' : (r.is_active ? 'active' : 'inactive')}
          </button>
        </div>
      ))}
      {!rows.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No subscribers yet — the public /careers page can offer a "Join our Talent Community" signup that posts to POST /talent-pool/subscribe.</div>}
    </div>
  );
}

function ReferralsTab() {
  const { data, refetch } = useFetch<any>('/referrals/');
  const [creating, setCreating] = useState(false);
  const [payingId, setPayingId] = useState('');
  const rows = data?.referrals || [];
  // Real gap-audit fix (2026-09-02): the click->candidate half of this
  // funnel already worked; nothing surfaced whether a referral ever
  // actually turned into a hire, or whether the bonus was paid. Real,
  // deferred role read so a plain recruiter never sees the Mark Paid
  // action (server-side gated too — this is display-layer only).
  const [canMarkPaid, setCanMarkPaid] = useState(false);
  useEffect(() => {
    const role = getTokenPayload()?.role;
    setCanMarkPaid(role === 'admin' || role === 'super_admin' || role === 'manager');
  }, []);

  const create = async () => {
    setCreating(true);
    try { await apiFetch('/referrals', { method: 'POST', body: JSON.stringify({}) }); refetch(); }
    finally { setCreating(false); }
  };
  const copy = (url: string) => navigator.clipboard.writeText(url);
  const markPaid = async (id: string) => {
    setPayingId(id);
    try { await apiFetch(`/referrals/${id}/mark-bonus-paid`, { method: 'PATCH' }); refetch(); }
    catch (e: any) { alert(e?.message || 'Failed to mark as paid'); }
    finally { setPayingId(''); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={create} disabled={creating} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> {creating ? 'Generating…' : 'Generate Referral Link'}
      </button>
      <div style={card}>
        {rows.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>{r.requisition_title || 'General referral'}</span>
              <span style={{ color: '#64748B' }}>{r.click_count} clicks · {(r.candidate_ids || []).length} referred</span>
              <button onClick={() => copy(`${location.origin}/r/${r.unique_code}`)} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer' }}>
                <Copy size={12} /> Copy link
              </button>
            </div>
            {r.hired_candidate_id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#DCFCE7', color: '#166534' }}>✓ Hired{r.placement_value ? ` · ₹${Number(r.placement_value).toLocaleString('en-IN')}` : ''}</span>
                {r.bonus_paid ? (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#E0E7FF', color: '#3730A3' }}>Bonus Paid</span>
                ) : r.bonus_eligible ? (
                  canMarkPaid ? (
                    <button onClick={() => markPaid(r.id)} disabled={payingId === r.id} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', border: 'none', cursor: 'pointer' }}>
                      {payingId === r.id ? 'Marking…' : 'Bonus Eligible — Mark Paid'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FEF3C7', color: '#92400E' }}>Bonus Eligible</span>
                  )
                ) : null}
              </div>
            )}
          </div>
        ))}
        {!rows.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No referral links yet.</div>}
      </div>
    </div>
  );
}

function NpsTab() {
  const { data, refetch } = useFetch<any>('/nps/status');
  const { data: candidates } = useFetch<any>('/candidates?limit=200');
  const [showForm, setShowForm] = useState(false);
  const [candidateId, setCandidateId] = useState('');
  const [sending, setSending] = useState(false);
  const candList = candidates?.items || [];

  const send = async () => {
    if (!candidateId) return;
    setSending(true);
    try { await apiFetch('/nps/request', { method: 'POST', body: JSON.stringify({ candidate_id: candidateId }) }); setShowForm(false); setCandidateId(''); refetch(); }
    finally { setSending(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Send NPS Survey
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>CANDIDATE</label>
          <select value={candidateId} onChange={e => setCandidateId(e.target.value)} style={input}>
            <option value="">-- Select --</option>
            {candList.map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <button onClick={send} disabled={sending} style={btn}>{sending ? 'Sending…' : 'Send Survey'}</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...card, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#2563EB' }}>{data?.nps_score ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>NPS Score</div>
        </div>
        <div style={{ ...card, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A' }}>{data?.responses ?? 0}/{data?.sent ?? 0}</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>Responses</div>
        </div>
        <div style={{ ...card, flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#16A34A' }}>{data?.avg_score ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#64748B' }}>Avg Score /10</div>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recent Feedback</div>
        {(data?.recent || []).map((r: any, i: number) => (
          <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <strong>{r.full_name}</strong> — score {r.nps_score}/10
            {r.what_went_well && <div style={{ color: '#64748B' }}>👍 {r.what_went_well}</div>}
            {r.what_could_improve && <div style={{ color: '#64748B' }}>💡 {r.what_could_improve}</div>}
          </div>
        ))}
        {!data?.recent?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No responses yet. Send a survey from a candidate's profile.</div>}
      </div>
    </div>
  );
}

export default function CandidateEngagementPage() {
  const [tab, setTab] = useState('talent');
  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Candidate Engagement</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>Talent community subscribers, employee referrals, and candidate NPS feedback.</p>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === t.key ? '#2563EB' : '#64748B', borderBottom: tab === t.key ? '2px solid #2563EB' : '2px solid transparent' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'talent' && <TalentPoolTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'nps' && <NpsTab />}
    </div>
  );
}
