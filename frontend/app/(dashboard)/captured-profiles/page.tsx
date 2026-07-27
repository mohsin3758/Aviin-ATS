'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { UserPlus, ExternalLink } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };

export default function CapturedProfilesPage() {
  const { data: captures, refetch } = useFetch<any[]>('/extension/captures?converted=false');
  const { data: linkedin } = useFetch<any[]>('/extension/linkedin');
  const [converting, setConverting] = useState<string | null>(null);

  const convert = async (id: string) => {
    setConverting(id);
    try { await apiFetch(`/extension/captures/${id}/convert`, { method: 'POST' }); refetch(); }
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
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1, fontWeight: 700 }}>{c.name}</span>
            <span style={{ color: '#64748B' }}>{c.current_title} {c.current_company ? `@ ${c.current_company}` : ''}</span>
            {c.profile_url && <a href={c.profile_url} target="_blank" rel="noreferrer" style={{ color: '#2563EB' }}><ExternalLink size={12} /></a>}
            <button onClick={() => convert(c.id)} disabled={converting === c.id}
              style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: '#2563EB', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
              <UserPlus size={12} /> {converting === c.id ? 'Converting…' : 'Convert to Candidate'}
            </button>
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
