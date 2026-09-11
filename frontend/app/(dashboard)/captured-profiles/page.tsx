'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { UserPlus, ExternalLink } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };

export default function CapturedProfilesPage() {
  const { data: captures, refetch } = useFetch<any[]>('/extension/captures?converted=false');
  const { data: linkedin } = useFetch<any[]>('/extension/linkedin');
  const [converting, setConverting] = useState<string | null>(null);
  const [dupeNotice, setDupeNotice] = useState<{ id: string; name: string; candidateId: string } | null>(null);

  const convert = async (id: string) => {
    setConverting(id);
    setDupeNotice(null);
    try {
      await apiFetch(`/extension/captures/${id}/convert`, { method: 'POST' });
      refetch();
    } catch (e: any) {
      // Real gap fix: convert() now runs a real duplicate check and
      // returns 409 with match details instead of creating a second
      // record for someone already in the database — previously this
      // just failed silently (the button spun, nothing visibly
      // happened, refetch() never ran because the throw skipped it).
      const detail = e?.body?.detail;
      if (detail?.matched_candidate_id) {
        setDupeNotice({ id, name: detail.matched_candidate_name || 'this candidate', candidateId: detail.matched_candidate_id });
      }
    }
    finally { setConverting(null); }
  };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Captured Profiles</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>Profiles captured via the browser extension / LinkedIn scraping, pending review before becoming candidates.</p>
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Pending Conversion ({captures?.length || 0})</div>
        {(captures || []).map((c: any) => (
          <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <span style={{ flex: 1, fontWeight: 700 }}>{c.name}</span>
              <span style={{ color: '#64748B' }}>{c.current_title} {c.current_company ? `@ ${c.current_company}` : ''}</span>
              {c.profile_url && <a href={c.profile_url} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}><ExternalLink size={12} /></a>}
              <button onClick={() => convert(c.id)} disabled={converting === c.id}
                style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: '#2563EB', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
                <UserPlus size={12} /> {converting === c.id ? 'Converting…' : 'Convert to Candidate'}
              </button>
            </div>
            {dupeNotice && dupeNotice.id === c.id && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '6px 10px' }}>
                Matches an existing candidate: <strong>{dupeNotice.name}</strong> —{' '}
                <a href={`/candidates/${dupeNotice.candidateId}`} target="_blank" rel="noreferrer" style={{ color: '#B45309', textDecoration: 'underline' }}>
                  View existing
                </a>
              </div>
            )}
          </div>
        ))}
        {!captures?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No pending captures.</div>}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Raw LinkedIn Captures ({linkedin?.length || 0})</div>
        {(linkedin || []).map((l: any) => (
          <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <a href={l.linkedin_url} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}>{l.linkedin_url}</a>
            <span style={{ color: '#94A3B8', marginLeft: 8 }}>{new Date(l.created_at).toLocaleDateString()}</span>
          </div>
        ))}
        {!linkedin?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No raw captures yet.</div>}
      </div>
    </div>
  );
}
