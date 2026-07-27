'use client';
import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api';

export default function NpsSurveyPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<{ full_name: string; submitted_at: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [wellText, setWellText] = useState('');
  const [improveText, setImproveText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/nps/public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.detail) setError(d.detail); else { setData(d); if (d.submitted_at) setDone(true); } })
      .catch(() => setError('Unable to load this survey.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (score === null) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/nps/public/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, nps_score: score, what_went_well: wellText, what_could_improve: improveText }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Center>Loading…</Center>;
  if (error) return <Center><p style={{ color: '#DC2626' }}>{error}</p></Center>;
  if (done) return <Center><h2>Thanks for your feedback!</h2></Center>;

  return (
    <div style={{ maxWidth: 480, margin: '60px auto', padding: '0 20px', fontFamily: 'system-ui', textAlign: 'center' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Hi {data?.full_name}</h1>
      <p style={{ color: '#64748B', fontSize: 13, marginBottom: 20 }}>How likely are you to recommend us to a friend or colleague?</p>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {Array.from({ length: 11 }).map((_, n) => (
          <button key={n} onClick={() => setScore(n)}
            style={{ width: 34, height: 34, borderRadius: 8, border: score === n ? '2px solid #2563EB' : '1px solid #E2E8F0', background: score === n ? '#EEF2FF' : '#fff', fontWeight: 700, cursor: 'pointer' }}>
            {n}
          </button>
        ))}
      </div>
      <textarea placeholder="What went well? (optional)" value={wellText} onChange={e => setWellText(e.target.value)}
        style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, border: '1px solid #E2E8F0', marginBottom: 8, fontFamily: 'inherit' }} />
      <textarea placeholder="What could we improve? (optional)" value={improveText} onChange={e => setImproveText(e.target.value)}
        style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, border: '1px solid #E2E8F0', marginBottom: 16, fontFamily: 'inherit' }} />
      <button onClick={submit} disabled={score === null || submitting} style={{ padding: '10px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', opacity: score === null ? 0.5 : 1 }}>
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui' }}>{children}</div>;
}
