'use client';
import { useState, useEffect, useRef } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Shield, CheckCircle, Clock, AlertTriangle, Search, X, Plus } from 'lucide-react';

interface CandidateHit { id: string; full_name: string; email?: string; phone?: string; }

function CandidatePicker({ value, onChange }: { value: CandidateHit | null; onChange: (c: CandidateHit | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CandidateHit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apiFetch(`/candidates?search=${encodeURIComponent(q)}&limit=8`)
        .then(d => setResults(Array.isArray(d) ? d : d.items || []))
        .catch(() => setResults([]));
    }, 300);
  }, [q]);

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>{value.full_name}</span>
        <button onClick={() => onChange(null)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: '#64748b' }}><X size={14} /></button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <Search size={13} style={{ color: '#94a3b8' }} />
        <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder="Search candidate by name..." style={{ border: 'none', outline: 'none', fontSize: 13, flex: 1 }} />
      </div>
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
          {results.map(c => (
            <button key={c.id} onClick={() => { onChange(c); setOpen(false); setQ(''); }}
              style={{ width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontWeight: 600, color: '#1e293b' }}>{c.full_name}</div>
              {c.email && <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.email}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CHECK_TYPES = ['identity', 'education', 'employment', 'criminal', 'credit', 'address', 'reference', 'digilocker'];
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#f1f5f9', fg: '#64748b' },
  in_progress: { bg: '#fefce8', fg: '#ca8a04' },
  completed: { bg: '#f0fdf4', fg: '#16a34a' },
  failed: { bg: '#fef2f2', fg: '#dc2626' },
  expired: { bg: '#f1f5f9', fg: '#94a3b8' },
};

export default function BgvPage() {
  const [bgvTab, setBgvTab] = useState('overview');

  return (
    <div className="anim-fade-up space-y-6">
      <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
        <button onClick={()=>setBgvTab('overview')} data-tab="overview" style={{padding:'8px 16px',background:bgvTab==='overview'?'#4f46e5':'#e5e7eb',color:bgvTab==='overview'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>Overview</button>
        <button onClick={()=>setBgvTab('checks')} data-tab="checks" style={{padding:'8px 16px',background:bgvTab==='checks'?'#4f46e5':'#e5e7eb',color:bgvTab==='checks'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>Checks</button>
        <button onClick={()=>setBgvTab('india-verify')} data-tab="india-verify" style={{padding:'8px 16px',background:bgvTab==='india-verify'?'#4f46e5':'#e5e7eb',color:bgvTab==='india-verify'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>India Verify</button>
      </div>

      <div data-testid="trust-overview" style={{display: bgvTab === 'overview' ? 'block' : 'none'}}>
        <OverviewTab />
      </div>

      <div data-testid="bgv-checks-panel" style={{display: bgvTab === 'checks' ? 'block' : 'none'}}>
        <ChecksTab />
      </div>

      <div data-testid="india-verify-panel" style={{display: bgvTab === 'india-verify' ? 'block' : 'none'}}>
        <IndiaVerifyTab />
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data: stats, loading } = useFetch<any>('/bgv/stats');
  const [lookupCand, setLookupCand] = useState<CandidateHit | null>(null);
  const [trustScore, setTrustScore] = useState<any>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  useEffect(() => {
    if (!lookupCand) { setTrustScore(null); return; }
    setLookupErr(null);
    apiFetch(`/bgv/trust-score/${lookupCand.id}`).then(setTrustScore).catch(e => setLookupErr(e.message));
  }, [lookupCand?.id]);

  return (
    <div style={{ padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0' }}>
      <div style={{display:'flex',gap:'12px',alignItems:'center'}}>
        <Shield size={24} style={{color:'#4f46e5'}} />
        <div>
          <div style={{fontWeight:'700',fontSize:'16px',color:'#0f172a'}}>BGV Trust Overview</div>
          <div style={{fontSize:'13px',color:'#64748b',marginTop:'4px'}}>
            Background verification dashboard for all candidates.
          </div>
        </div>
      </div>

      <div style={{marginTop:'16px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
        <div style={{padding:'14px',background:'#f0fdf4',borderRadius:'10px',border:'1px solid #bbf7d0',textAlign:'center'}}>
          <CheckCircle size={20} style={{color:'#16a34a',margin:'0 auto 6px'}} />
          <div style={{fontWeight:'700',fontSize:'18px',color:'#16a34a'}}>{loading ? '—' : (stats?.verified ?? 0)}</div>
          <div style={{fontSize:'12px',color:'#64748b'}}>Verified</div>
        </div>
        <div style={{padding:'14px',background:'#fefce8',borderRadius:'10px',border:'1px solid #fef08a',textAlign:'center'}}>
          <Clock size={20} style={{color:'#ca8a04',margin:'0 auto 6px'}} />
          <div style={{fontWeight:'700',fontSize:'18px',color:'#ca8a04'}}>{loading ? '—' : (stats?.in_progress ?? 0)}</div>
          <div style={{fontSize:'12px',color:'#64748b'}}>In Progress</div>
        </div>
        <div style={{padding:'14px',background:'#f8fafc',borderRadius:'10px',border:'1px solid #e2e8f0',textAlign:'center'}}>
          <Shield size={20} style={{color:'#64748b',margin:'0 auto 6px'}} />
          <div style={{fontWeight:'700',fontSize:'18px',color:'#475569'}}>{loading ? '—' : (stats?.pending ?? 0)}</div>
          <div style={{fontSize:'12px',color:'#64748b'}}>Pending</div>
        </div>
        <div style={{padding:'14px',background:'#fef2f2',borderRadius:'10px',border:'1px solid #fecaca',textAlign:'center'}}>
          <AlertTriangle size={20} style={{color:'#dc2626',margin:'0 auto 6px'}} />
          <div style={{fontWeight:'700',fontSize:'18px',color:'#dc2626'}}>{loading ? '—' : (stats?.flagged ?? 0)}</div>
          <div style={{fontSize:'12px',color:'#64748b'}}>Flagged</div>
        </div>
      </div>

      {stats?.by_type?.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>By Check Type</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {stats.by_type.map((t: any) => (
              <div key={t.check_type} style={{ padding: '6px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: '#374151', textTransform: 'capitalize' }}>{t.check_type}</span>
                <span style={{ color: '#94a3b8', marginLeft: 6 }}>{t.verified}/{t.total} clear</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8 }}>Trust Score Lookup</div>
        <div style={{ maxWidth: 360 }}>
          <CandidatePicker value={lookupCand} onChange={setLookupCand} />
        </div>
        {lookupErr && <div style={{ marginTop: 10, fontSize: 12, color: '#dc2626' }}>{lookupErr}</div>}
        {trustScore && (
          <div style={{ marginTop: 12, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', display: 'flex', gap: 20, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1e293b' }}>{trustScore.total_score}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Total Score</div>
            </div>
            <div style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
              background: trustScore.trust_rating === 'Excellent' || trustScore.trust_rating === 'Good' ? '#f0fdf4' : trustScore.trust_rating === 'Fair' ? '#fefce8' : '#fef2f2',
              color: trustScore.trust_rating === 'Excellent' || trustScore.trust_rating === 'Good' ? '#16a34a' : trustScore.trust_rating === 'Fair' ? '#ca8a04' : '#dc2626' }}>
              {trustScore.trust_rating}
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>BGV: {trustScore.bgv_score} · Trust Graph: {trustScore.trust_graph_score} · Checks Clear: {trustScore.checks_clear}/{trustScore.total_checks}
              {trustScore.fraud_flags > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> · {trustScore.fraud_flags} fraud flag(s)</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChecksTab() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data: checks, loading, refetch } = useFetch<any[]>(`/bgv/checks${statusFilter ? `?status=${statusFilter}` : ''}`);
  const [showNew, setShowNew] = useState(false);
  const [newCand, setNewCand] = useState<CandidateHit | null>(null);
  const [newType, setNewType] = useState('identity');
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);

  async function createCheck() {
    if (!newCand) return;
    setCreating(true);
    try {
      await apiFetch('/bgv/checks', { method: 'POST', body: JSON.stringify({ candidate_id: newCand.id, check_type: newType }) });
      setShowNew(false); setNewCand(null); setNewType('identity');
      refetch();
    } finally { setCreating(false); }
  }

  async function resolveCheck(id: string, status: 'completed' | 'failed', result: string) {
    setUpdating(id);
    try {
      await apiFetch(`/bgv/checks/${id}`, { method: 'PATCH', body: JSON.stringify({ status, result }) });
      refetch();
    } finally { setUpdating(null); }
  }

  return (
    <div style={{ padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h3 style={{ fontSize:'16px',fontWeight:'700',color:'#0f172a' }}>Background Verification Checks</h3>
          <p style={{ fontSize:'13px',color:'#64748b', marginTop: 2 }}>Education, Employment, Criminal, Address, and Reference checks.</p>
        </div>
        <button onClick={() => setShowNew(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={13} /> New Check
        </button>
      </div>

      {showNew && (
        <div style={{ padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>CANDIDATE</div>
            <CandidatePicker value={newCand} onChange={setNewCand} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>CHECK TYPE</div>
            <select value={newType} onChange={e => setNewType(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}>
              {CHECK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button onClick={createCheck} disabled={!newCand || creating} style={{ padding: '8px 16px', background: newCand ? '#16a34a' : '#e2e8f0', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: newCand ? 'pointer' : 'default' }}>
            {creating ? 'Starting…' : 'Start Check'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['', 'pending', 'in_progress', 'completed', 'failed'].map(s => (
          <button key={s || 'all'} onClick={() => setStatusFilter(s)}
            style={{ padding: '5px 12px', borderRadius: 999, border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: statusFilter === s ? '#1e293b' : '#fff', color: statusFilter === s ? '#fff' : '#64748b' }}>
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ fontSize: 13, color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading…</div>}
        {!loading && (checks || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', padding: 20, textAlign: 'center' }}>No checks yet.</div>}
        {(checks || []).map((c: any) => {
          const sc = STATUS_COLOR[c.status] || STATUS_COLOR.pending;
          return (
            <div key={c.id} style={{ display:'flex',alignItems:'center',gap:'10px',padding:'10px 14px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0' }}>
              <Clock size={14} style={{color:'#94a3b8'}} />
              <span style={{ fontSize:'13px',color:'#374151', fontWeight: 600 }}>{c.candidate_name}</span>
              <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{c.check_type}</span>
              {c.vendor && <span style={{ fontSize: 11, color: '#cbd5e1' }}>via {c.vendor}</span>}
              <span style={{marginLeft:'auto',fontSize:'11px',padding:'2px 8px',background:sc.bg,borderRadius:'4px',color:sc.fg, fontWeight: 700, textTransform: 'capitalize'}}>{c.status.replace('_',' ')}</span>
              {c.result && <span style={{ fontSize: 11, color: c.result === 'clear' ? '#16a34a' : c.result === 'flagged' ? '#dc2626' : '#64748b', fontWeight: 700 }}>{c.result}</span>}
              {c.status === 'in_progress' && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button disabled={updating === c.id} onClick={() => resolveCheck(c.id, 'completed', 'clear')} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', cursor: 'pointer', fontWeight: 700 }}>Clear</button>
                  <button disabled={updating === c.id} onClick={() => resolveCheck(c.id, 'completed', 'flagged')} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>Flag</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndiaVerifyTab() {
  const [cand, setCand] = useState<CandidateHit | null>(null);
  const [aadhaar, setAadhaar] = useState('');
  const [mobileLast4, setMobileLast4] = useState('');
  const [txnId, setTxnId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [aadhaarResult, setAadhaarResult] = useState<any>(null);
  const [docType, setDocType] = useState('degree');
  const [dlResult, setDlResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function initiateAadhaar() {
    if (!cand || aadhaar.length < 4 || mobileLast4.length !== 4) return;
    setBusy(true);
    try {
      const r = await apiFetch('/bgv/aadhaar/initiate', { method: 'POST', body: JSON.stringify({ candidate_id: cand.id, aadhaar_number: aadhaar, mobile_last4: mobileLast4 }) });
      setTxnId(r.transaction_id);
    } finally { setBusy(false); }
  }

  async function verifyOtp() {
    if (!cand || !txnId || !otp) return;
    setBusy(true);
    try {
      const r = await apiFetch('/bgv/aadhaar/verify-otp', { method: 'POST', body: JSON.stringify({ candidate_id: cand.id, transaction_id: txnId, otp }) });
      setAadhaarResult(r);
    } finally { setBusy(false); }
  }

  async function initiateDigiLocker() {
    if (!cand) return;
    setBusy(true);
    try {
      const r = await apiFetch('/bgv/digilocker/initiate', { method: 'POST', body: JSON.stringify({ candidate_id: cand.id, document_type: docType }) });
      setDlResult(r);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0' }}>
      <h3 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',marginBottom:'4px'}}>India Verify Integration</h3>
      <p style={{fontSize:'13px',color:'#64748b', marginBottom: 16}}>Aadhaar, PAN, Driving License, and Voter ID verification. Demo mode — production requires UIDAI/DigiLocker partner credentials.</p>

      <div style={{ maxWidth: 360, marginBottom: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>CANDIDATE</div>
        <CandidatePicker value={cand} onChange={c => { setCand(c); setTxnId(null); setAadhaarResult(null); setDlResult(null); }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ padding: 16, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Shield size={14} style={{color:'#94a3b8'}} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Aadhaar Verification</span>
          </div>
          {!aadhaarResult ? (
            <>
              <input value={aadhaar} onChange={e => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))} placeholder="Aadhaar number"
                disabled={!cand} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 6 }} />
              <input value={mobileLast4} onChange={e => setMobileLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Last 4 digits of mobile"
                disabled={!cand} style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 8 }} />
              {!txnId ? (
                <button onClick={initiateAadhaar} disabled={!cand || busy || aadhaar.length < 4 || mobileLast4.length !== 4}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', background: cand ? '#4f46e5' : '#e2e8f0', color: '#fff', fontSize: 12, fontWeight: 700, cursor: cand ? 'pointer' : 'default' }}>
                  Send OTP (demo)
                </button>
              ) : (
                <>
                  <div style={{ fontSize: 11, color: '#16a34a', marginBottom: 6 }}>OTP sent. Transaction: {txnId}</div>
                  <input value={otp} onChange={e => setOtp(e.target.value)} placeholder="Enter OTP (any value works in demo)"
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 8 }} />
                  <button onClick={verifyOtp} disabled={busy || !otp}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Verify OTP
                  </button>
                </>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
              <CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Aadhaar verified (demo). Identity check logged as clear.
            </div>
          )}
        </div>

        <div style={{ padding: 16, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Shield size={14} style={{color:'#94a3b8'}} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>DigiLocker Document Pull</span>
          </div>
          <select value={docType} onChange={e => setDocType(e.target.value)} disabled={!cand}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 8 }}>
            {['degree', 'pan_card', 'driving_licence', 'voter_id'].map(d => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
          </select>
          <button onClick={initiateDigiLocker} disabled={!cand || busy}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: 'none', background: cand ? '#4f46e5' : '#e2e8f0', color: '#fff', fontSize: 12, fontWeight: 700, cursor: cand ? 'pointer' : 'default' }}>
            Initiate Pull (demo)
          </button>
          {dlResult && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', wordBreak: 'break-all' }}>
              Demo auth URL: <span style={{ color: '#4f46e5' }}>{dlResult.auth_url}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
