'use client';
import { useState } from 'react';
import { Sparkles, FileText, Star, Lightbulb, Brain, ChevronRight } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';

export default function AiToolsPage() {
  const [tab, setTab] = useState('jd-optimizer');
  const [jdText, setJdText] = useState('');
  const [jdResult, setJdResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { data: reqs } = useFetch<any[]>('/requisitions');
  const [selReq, setSelReq] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [ranking, setRanking] = useState<any>(null);
  const [candId, setCandId] = useState('');
  const { data: cands } = useFetch<any[]>('/candidates');

  async function optimizeJd() {
    if (!jdText) return; setLoading(true);
    try { const r = await apiFetch(`/ai-tools/jd-optimizer?jd_text=${encodeURIComponent(jdText)}`, {method:'POST'}); setJdResult(r); }
    finally { setLoading(false); }
  }
  async function genQuestions() {
    if (!selReq) return; setLoading(true);
    try { const r = await apiFetch(`/ai-tools/interview-questions?requisition_id=${selReq}&count=8`, {method:'POST'}); setQuestions(r.questions||[]); }
    finally { setLoading(false); }
  }
  async function getRanking() {
    if (!candId||!selReq) return; setLoading(true);
    try { const r = await apiFetch(`/ai-tools/rank-explanation/${candId}?requisition_id=${selReq}`, {method:'POST'}); setRanking(r); }
    finally { setLoading(false); }
  }

  const GRADE_COLOR: Record<string,string> = { 'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444' };

  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10">
          <h1 className="text-white text-2xl font-bold mb-1 flex items-center gap-3"><span>✨</span> AI Tools</h1>
          <p className="text-blue-200 text-sm">Ollama Qwen2.5-1.5B · Cached · Zero external API · ₹0/month</p>
        </div>
      </div>
      <div className="tabs">
        {[['jd-optimizer','📄 JD Optimizer'],['questions','❓ Interview Questions'],['ranking','⭐ Ranking Explanation']].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>
      {tab==='jd-optimizer' && (
        <div className="card">
          <div className="card-header"><h3>JD Quality Optimizer</h3><span className="badge badge-purple">Rules Engine · Zero LLM</span></div>
          <div className="card-body space-y-4">
            <textarea className="input" rows={8} placeholder="Paste your Job Description here..." value={jdText} onChange={e=>setJdText(e.target.value)} />
            <button onClick={optimizeJd} disabled={loading||!jdText} className="btn btn-primary">
              {loading ? <Spinner size="sm" /> : <Sparkles size={14} />} Analyze JD
            </button>
            {jdResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  {[['Quality Score',`${jdResult.quality_score}/100`,jdResult.quality_score>=70?'#059669':'#ef4444'],['Grade',jdResult.quality_grade,'var(--primary)'],['Readability',jdResult.readability,'var(--gray-700)']].map(([l,v,col])=>(
                    <div key={l} className="text-center p-4 rounded-xl" style={{ background:'var(--gray-50)', border:'1px solid var(--gray-200)' }}>
                      <div className="text-2xl font-bold" style={{ color:col as string }}>{v}</div>
                      <div className="text-xs mt-1" style={{ color:'var(--gray-500)' }}>{l}</div>
                    </div>
                  ))}
                </div>
                {jdResult.bias_words?.length>0 && (
                  <div className="p-4 rounded-xl" style={{ background:'#fee2e2', border:'1px solid #fca5a5' }}>
                    <div className="text-sm font-semibold mb-2" style={{ color:'#991b1b' }}>⚠ Biased Language Detected</div>
                    <div className="flex flex-wrap gap-2">{jdResult.bias_words.map((w:string)=><span key={w} className="badge badge-red">{w}</span>)}</div>
                  </div>
                )}
                {jdResult.suggestions?.length>0 && (
                  <div className="p-4 rounded-xl" style={{ background:'#fef3c7', border:'1px solid #fde68a' }}>
                    <div className="text-sm font-semibold mb-2" style={{ color:'#92400e' }}>💡 Improvements</div>
                    <ul className="space-y-1">{jdResult.suggestions.map((s:string,i:number)=><li key={i} className="text-sm flex gap-2"><span>•</span>{s}</li>)}</ul>
                  </div>
                )}
                <div className="p-4 rounded-xl" style={{ background:'#d1fae5', border:'1px solid #6ee7b7' }}>
                  <div className="text-sm font-semibold mb-2" style={{ color:'#065f46' }}>✅ Skills Detected</div>
                  <div className="flex flex-wrap gap-2">{(jdResult.skills_detected||[]).map((s:string)=><span key={s} className="badge badge-green">{s}</span>)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {tab==='questions' && (
        <div className="card">
          <div className="card-header"><h3>AI Interview Question Generator</h3><span className="badge badge-purple">Ollama · Cached</span></div>
          <div className="card-body space-y-4">
            <select className="input" value={selReq} onChange={e=>setSelReq(e.target.value)}>
              <option value="">Select Job Requisition...</option>
              {(reqs||[]).map((r:any)=><option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <button onClick={genQuestions} disabled={loading||!selReq} className="btn btn-primary">
              {loading ? <Spinner size="sm" /> : <Brain size={14} />} Generate 8 Questions
            </button>
            {questions.length>0 && (
              <div className="space-y-3">
                {questions.map((q:any,i:number)=>(
                  <div key={i} className="flex gap-3 p-4 rounded-xl" style={{ background:'var(--primary-bg)', border:'1px solid var(--gray-200)' }}>
                    <span className="font-bold text-sm shrink-0" style={{ color:'var(--primary)' }}>Q{i+1}</span>
                    <p className="text-sm leading-relaxed" style={{ color:'var(--gray-700)' }}>{q.question}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {tab==='ranking' && (
        <div className="card">
          <div className="card-header"><h3>AI Candidate Ranking Explanation</h3><span className="badge badge-purple">Ollama · Cached</span></div>
          <div className="card-body space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <select className="input" value={selReq} onChange={e=>setSelReq(e.target.value)}>
                <option value="">Select Job...</option>
                {(reqs||[]).map((r:any)=><option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
              <select className="input" value={candId} onChange={e=>setCandId(e.target.value)}>
                <option value="">Select Candidate...</option>
                {(cands||[]).map((c:any)=><option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            <button onClick={getRanking} disabled={loading||!selReq||!candId} className="btn btn-primary">
              {loading ? <Spinner size="sm" /> : <Star size={14} />} Explain Match
            </button>
            {ranking && (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background:'var(--gray-50)', border:'1px solid var(--gray-200)' }}>
                  <div className="text-center"><div className="text-3xl font-bold" style={{ color:GRADE_COLOR[ranking.grade]||'var(--primary)' }}>{Number(ranking.readiness_score||0).toFixed(0)}</div><div className="text-xs" style={{ color:'var(--gray-500)' }}>Score/100</div></div>
                  <div className="text-center"><div className="text-3xl font-bold" style={{ color:GRADE_COLOR[ranking.grade] }}>{ranking.grade}</div><div className="text-xs" style={{ color:'var(--gray-500)' }}>Grade</div></div>
                  <div className="flex-1"><div className="font-semibold">{ranking.candidate}</div><div className="text-sm" style={{ color:'var(--gray-500)' }}>for {ranking.role}</div></div>
                </div>
                <div className="p-4 rounded-xl" style={{ background:'var(--primary-bg)', border:'1px solid var(--gray-200)' }}>
                  <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Brain size={14} style={{ color:'var(--primary)' }} /> AI Explanation</div>
                  <p className="text-sm leading-relaxed" style={{ color:'var(--gray-700)' }}>{ranking.explanation}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
