'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, User, Briefcase, ArrowRight } from 'lucide-react';
import { API, authHeaders } from '@/lib/auth';

interface Result {
  type: 'candidate' | 'requisition';
  id: string;
  title: string;
  sub: string;
  href: string;
}

async function searchAll(q: string, signal: AbortSignal): Promise<Result[]> {
  if (!q.trim() || q.length < 2) return [];
  try {
    const [cRes, rRes] = await Promise.all([
      fetch(`${API}/candidates?search=${encodeURIComponent(q)}&limit=5`, { headers: authHeaders(), signal }),
      fetch(`${API}/requisitions?search=${encodeURIComponent(q)}&limit=5`, { headers: authHeaders(), signal }),
    ]);
    const results: Result[] = [];
    if (cRes.ok) {
      const d = await cRes.json();
      const items = d?.data || d?.items || (Array.isArray(d) ? d : []);
      items.forEach((c: any) => results.push({
        type: 'candidate', id: c.id,
        title: c.full_name || 'Unknown',
        sub: [c.current_designation, c.current_employer].filter(Boolean).join(' @ ') || c.email || '',
        href: `/candidates/${c.id}`,
      }));
    }
    if (rRes.ok) {
      const d = await rRes.json();
      const items = d?.data || d?.items || (Array.isArray(d) ? d : []);
      items.forEach((r: any) => results.push({
        type: 'requisition', id: r.id,
        title: r.title || 'Untitled',
        sub: [r.department, r.location, r.employment_type].filter(Boolean).join(' · '),
        href: `/requisitions`,
      }));
    }
    return results;
  } catch (e: any) {
    if (e.name === 'AbortError') return [];
    return [];
  }
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Cmd+K / Ctrl+K to open
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQ(''); setResults([]); setIdx(0); }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const r = await searchAll(q, ctrl.signal);
      setResults(r);
      setLoading(false);
      setIdx(0);
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  function navigate(r: Result) {
    router.push(r.href);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i+1, results.length-1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i-1, 0)); }
    if (e.key === 'Enter' && results[idx]) navigate(results[idx]);
  }

  if (!open) return null;

  const candidates = results.filter(r => r.type === 'candidate');
  const requisitions = results.filter(r => r.type === 'requisition');
  let globalIdx = 0;

  function ResultItem({ r }: { r: Result }) {
    const myIdx = globalIdx++;
    const active = myIdx === idx;
    return (
      <button onClick={() => navigate(r)}
        style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',padding:'10px 14px',
          border:'none',background: active ? '#eff6ff' : 'transparent',cursor:'pointer',
          textAlign:'left',borderRadius:'8px',transition:'background 0.1s'}}
        onMouseEnter={() => setIdx(myIdx)}>
        <div style={{width:'32px',height:'32px',borderRadius:'8px',
          background: r.type==='candidate' ? '#eff6ff' : '#f5f3ff',
          display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          {r.type==='candidate'
            ? <User size={14} style={{color:'#1e40af'}}/>
            : <Briefcase size={14} style={{color:'#7c3aed'}}/>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:'13px',fontWeight:'600',color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.title}</div>
          {r.sub && <div style={{fontSize:'11px',color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.sub}</div>}
        </div>
        <ArrowRight size={12} style={{color:'#94a3b8',flexShrink:0}}/>
      </button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div onClick={() => setOpen(false)}
        style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:9000,backdropFilter:'blur(2px)'}}/>

      {/* Panel */}
      <div style={{position:'fixed',top:'15%',left:'50%',transform:'translateX(-50%)',
        width:'560px',maxWidth:'calc(100vw - 32px)',background:'white',
        borderRadius:'16px',boxShadow:'0 24px 80px rgba(0,0,0,0.3)',zIndex:9001,overflow:'hidden'}}>

        {/* Input */}
        <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'16px 18px',
          borderBottom:'1px solid #f1f5f9'}}>
          <Search size={18} style={{color:'#94a3b8',flexShrink:0}}/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search candidates, jobs, requisitions..."
            style={{flex:1,border:'none',outline:'none',fontSize:'15px',color:'#0f172a',background:'transparent'}}/>
          {loading && <div style={{width:'16px',height:'16px',border:'2px solid #e2e8f0',borderTopColor:'#1e40af',
            borderRadius:'50%',animation:'spin 0.7s linear infinite',flexShrink:0}}/>}
          <button onClick={() => setOpen(false)}
            style={{border:'none',background:'#f1f5f9',cursor:'pointer',borderRadius:'6px',
              padding:'4px 8px',fontSize:'11px',color:'#64748b',flexShrink:0}}>ESC</button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div style={{maxHeight:'400px',overflowY:'auto',padding:'8px'}}>
            {candidates.length > 0 && (
              <>
                <div style={{fontSize:'10px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',
                  padding:'6px 14px 4px',letterSpacing:'0.08em'}}>Candidates</div>
                {candidates.map(r => <ResultItem key={r.id} r={r}/>)}
              </>
            )}
            {requisitions.length > 0 && (
              <>
                <div style={{fontSize:'10px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',
                  padding:'10px 14px 4px',letterSpacing:'0.08em'}}>Requisitions</div>
                {requisitions.map(r => <ResultItem key={r.id} r={r}/>)}
              </>
            )}
          </div>
        )}

        {q.length >= 2 && !loading && results.length === 0 && (
          <div style={{padding:'28px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>
            No results for "{q}"
          </div>
        )}

        {!q && (
          <div style={{padding:'20px 18px',color:'#94a3b8',fontSize:'12px',display:'flex',justifyContent:'space-between'}}>
            <span>Type to search candidates & jobs</span>
            <span>↑↓ navigate · Enter select</span>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
