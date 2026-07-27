'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, Star, Video, Copy } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export default function VideoScreeningPage() {
  const { data: candidates } = useFetch<any>('/candidates?limit=200');
  const { data: questions, refetch: refetchQ } = useFetch<any[]>('/video/questions');
  const { data: responses, refetch: refetchR } = useFetch<any[]>('/video/responses');
  const [showQ, setShowQ] = useState(false);
  const [qForm, setQForm] = useState({ title: '', question_text: '', time_limit_secs: 90 });
  const [showToken, setShowToken] = useState(false);
  const [tForm, setTForm] = useState({ candidate_id: '', question_ids: [] as string[] });
  const [genLink, setGenLink] = useState('');
  const candList = candidates?.items || [];

  const createQuestion = async () => {
    if (!qForm.title || !qForm.question_text) return;
    await apiFetch('/video/questions', { method: 'POST', body: JSON.stringify(qForm) });
    setShowQ(false); setQForm({ title: '', question_text: '', time_limit_secs: 90 }); refetchQ();
  };

  const createToken = async () => {
    if (!tForm.candidate_id || !tForm.question_ids.length) return;
    const r = await apiFetch('/video/tokens', { method: 'POST', body: JSON.stringify(tForm) });
    setGenLink(r.link); setShowToken(false);
  };

  const toggleQ = (id: string) => {
    setTForm(f => ({ ...f, question_ids: f.question_ids.includes(id) ? f.question_ids.filter(x => x !== id) : [...f.question_ids, id] }));
  };

  const review = async (id: string, rating: number) => {
    await apiFetch(`/video/responses/${id}/review`, { method: 'PATCH', body: JSON.stringify({ recruiter_rating: rating }) });
    refetchR();
  };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Async Video Screening</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>Send candidates a link to record short video answers before the interview.</p>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setShowQ(v => !v)} style={{ ...btn, display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> Add Question</button>
        <button onClick={() => setShowToken(v => !v)} style={{ ...btn, background: '#4338CA', display: 'flex', gap: 6, alignItems: 'center' }}><Video size={14} /> Send Screening Link</button>
      </div>

      {genLink && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, background: '#EEF2FF' }}>
          <span style={{ flex: 1, fontSize: 12 }}>{genLink}</span>
          <button onClick={() => navigator.clipboard.writeText(genLink)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><Copy size={14} /></button>
        </div>
      )}

      {showQ && (
        <div style={card}>
          <label style={label}>TITLE</label>
          <input value={qForm.title} onChange={e => setQForm({ ...qForm, title: e.target.value })} style={input} />
          <label style={label}>QUESTION</label>
          <textarea value={qForm.question_text} onChange={e => setQForm({ ...qForm, question_text: e.target.value })} style={{ ...input, minHeight: 60 }} />
          <label style={label}>TIME LIMIT (SECS)</label>
          <input type="number" value={qForm.time_limit_secs} onChange={e => setQForm({ ...qForm, time_limit_secs: +e.target.value })} style={input} />
          <button onClick={createQuestion} style={btn}>Save Question</button>
        </div>
      )}

      {showToken && (
        <div style={card}>
          <label style={label}>CANDIDATE</label>
          <select value={tForm.candidate_id} onChange={e => setTForm({ ...tForm, candidate_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {candList.map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <label style={label}>QUESTIONS</label>
          {(questions || []).map((q: any) => (
            <label key={q.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
              <input type="checkbox" checked={tForm.question_ids.includes(q.id)} onChange={() => toggleQ(q.id)} /> {q.title}
            </label>
          ))}
          <button onClick={createToken} style={{ ...btn, marginTop: 8 }}>Generate & Email Link</button>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Question Bank ({questions?.length || 0})</div>
        {(questions || []).map((q: any) => (
          <div key={q.id} style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <strong>{q.title}</strong> — {q.question_text} ({q.time_limit_secs}s)
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Responses to Review</div>
        {(responses || []).map((r: any) => (
          <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1, fontWeight: 700 }}>{r.candidate_name} — {r.question_text}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: r.status === 'reviewed' ? '#F0FDF4' : '#FFFBEB', color: r.status === 'reviewed' ? '#16A34A' : '#D97706' }}>{r.status}</span>
            </div>
            {r.file_path && <a href={`${API_BASE}${r.file_path}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2563EB' }}>View clip</a>}
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} size={14} onClick={() => review(r.id, n)} style={{ cursor: 'pointer' }} fill={n <= (r.recruiter_rating || 0) ? '#F59E0B' : 'none'} color="#F59E0B" />
              ))}
            </div>
          </div>
        ))}
        {!responses?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No responses yet.</div>}
      </div>
    </div>
  );
}
