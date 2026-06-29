'use client';
import { useState } from 'react';
import { Brain, Sparkles, Search, Upload, Star, ChevronRight, Zap } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';

export default function IntelligencePage() {
  const [tab, setTab] = useState('scored');
  const [candId, setCandId] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<any>(null);
  const { data: stats } = useFetch<any>('/intelligence/stats');
  const { data: candidates } = useFetch<any[]>('/intelligence/candidates');

  async function parseResume() {
    if (!candId) return;
    setParsing(true);
    try {
      const r = await apiFetch('/intelligence/parse', { method:'POST', body:JSON.stringify({ candidate_id:candId }) });
      setParseResult(r);
    } finally { setParsing(false); }
  }

  const GRADE_COLOR: Record<string,string> = { 'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444' };
  const GRADE_BG:    Record<string,string> = { 'A+':'#d1fae5','A':'#d1fae5','B':'#dbeafe','C':'#fef3c7','D':'#fee2e2' };

  return (
    <div data-testid="intelligence-page" className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl">🤖</span>
            <h1 className="text-white text-2xl font-bold">AI Candidate Intelligence</h1>
          </div>
          <p className="text-blue-200 text-sm">Resume NER parsing · BGE-small semantic scoring · sklearn predictions · ₹0/month</p>
          <div className="flex gap-3 mt-3">
            {[['Total Parsed',stats?.total_parsed||0],['Avg Score',stats?.avg_readiness||'—'],['A/A+ Candidates',(stats?.grade_aplus||0)+(stats?.grade_a||0)],['Gap Flagged',stats?.gap_flagged||0]].map(([l,v])=>(
              <div key={l} className="text-center px-4 py-2 rounded-xl" style={{ background:'rgba(255,255,255,0.15)' }}>
                <div className="text-xl font-bold text-white">{v}</div>
                <div className="text-xs text-blue-200">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tabs">
        {[['scored','🎯 Scored Candidates'],['parse','🔍 Parse Resume'],['score','⭐ Score Candidate']].map(([k,l])=>(
          <button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k as any)}>{l}</button>
        ))}
      </div>

      {tab==='scored' && (
        <div className="card overflow-hidden">
          <div className="card-header">
            <h3>AI-Scored Candidates</h3>
            <span className="badge badge-purple">BGE-small + sklearn</span>
          </div>
          <table className="data-table">
            <thead><tr><th>Candidate</th><th>Experience</th><th>Education</th><th>Skills</th><th>Readiness Score</th><th>Grade</th><th>Flags</th></tr></thead>
            <tbody>
              {(candidates||[]).slice(0,15).map((c:any) => (
                <tr key={c.id}>
                  <td><div className="font-medium text-sm">{c.full_name}</div><div className="text-xs" style={{ color:'var(--gray-400)' }}>{c.email}</div></td>
                  <td className="text-sm">{c.total_years_exp != null ? `${c.total_years_exp}yr` : `${Math.round((c.total_exp_mo||0)/12)}yr`}</td>
                  <td><span className="badge badge-gray text-xs">{c.education_level||'—'}</span></td>
                  <td className="text-xs" style={{ color:'var(--gray-500)' }}>{(c.extracted_skills||c.skills||[]).slice(0,3).join(', ')}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="progress-bar" style={{ width:'80px', height:'6px' }}>
                        <div className="progress-fill" style={{ width:`${c.readiness_index||0}%`, background:GRADE_COLOR[c.readiness_grade||'C']||'var(--primary)' }} />
                      </div>
                      <span className="text-xs font-bold">{Number(c.readiness_index||0).toFixed(0)}</span>
                    </div>
                  </td>
                  <td>{c.readiness_grade && <span className="badge text-xs" style={{ background:GRADE_BG[c.readiness_grade], color:GRADE_COLOR[c.readiness_grade] }}>{c.readiness_grade}</span>}</td>
                  <td className="text-xs">{c.has_gap_flag && <span className="badge badge-amber">⚠ Gap</span>}</td>
                </tr>
              ))}
              {!candidates?.length && <tr><td colSpan={7} className="text-center py-8" style={{ color:'var(--gray-400)' }}>No scored candidates yet. Parse resumes first.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab==='parse' && (
        <div className="card">
          <div className="card-header"><h3>Resume NER Parsing</h3><span className="badge badge-purple">Regex NER · Zero LLM</span></div>
          <div className="card-body space-y-4">
            <input className="input" placeholder="Candidate UUID" value={candId} onChange={e=>setCandId(e.target.value)} />
            <button onClick={parseResume} disabled={parsing||!candId} className="btn btn-primary">
              {parsing ? <Spinner size="sm" /> : <Brain size={14} />} Parse Resume
            </button>
            {parseResult && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[['Education',parseResult.education_level],['Exp Years',parseResult.total_years_exp],['Jobs',parseResult.job_count],['Max Gap',`${parseResult.max_gap_months}m`]].map(([l,v])=>(
                  <div key={l} className="text-center p-3 rounded-xl" style={{ background:'var(--gray-50)', border:'1px solid var(--gray-200)' }}>
                    <div className="font-bold text-lg" style={{ color:'var(--primary)' }}>{v||'—'}</div>
                    <div className="text-xs mt-1" style={{ color:'var(--gray-500)' }}>{l}</div>
                  </div>
                ))}
                <div className="col-span-full">
                  <div className="text-xs font-semibold mb-2" style={{ color:'var(--gray-600)' }}>Extracted Skills</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(parseResult.extracted_skills||[]).map((s:string) => (
                      <span key={s} className="badge badge-blue">{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
