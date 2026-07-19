'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { FileText, CheckCircle, XCircle, Clock, Plus, Copy, ExternalLink,
         Send, Sparkles, Download, Edit3, Mail } from 'lucide-react';

const STATUS_BADGE:Record<string,{color:string,bg:string,label:string}> = {
  issued:           {color:'#2563eb',bg:'#eff6ff',  label:'Issued'},
  accepted:         {color:'#16a34a',bg:'#f0fdf4',  label:'Accepted'},
  declined:         {color:'#dc2626',bg:'#fef2f2',  label:'Declined'},
  draft:            {color:'#64748b',bg:'#f1f5f9',  label:'Draft'},
  pending_approval: {color:'#d97706',bg:'#fffbeb',  label:'Pending Approval'},
  approved:         {color:'#0891b2',bg:'#ecfeff',  label:'Approved'},
  rescinded:        {color:'#991b1b',bg:'#fee2e2',  label:'Rescinded'},
};

// ─── Letter Editor Modal ─────────────────────────────────────────────────────
function LetterModal({ offer, onClose, onSaved }: any) {
  const { data: letter } = useFetch<any>(offer ? `/offers/${offer.id}/letter` : null);
  const [text, setText] = useState<string>('');
  const [saving, setSaving]   = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast]     = useState('');

  // Populate once letter loads
  if (letter && text === '' && (letter.draft_text || offer?.offer_letter_text)) {
    setText(letter.draft_text || offer.offer_letter_text || '');
  }

  const showT = (m:string) => { setToast(m); setTimeout(()=>setToast(''),3000); };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(`/offers/${offer.id}/letter`, {
        method:'PUT', body: JSON.stringify({ letter_text: text })
      });
      showT('Letter saved');
      onSaved?.();
    } catch (e:any) { showT('Save failed: ' + (e?.message||'error')); }
    finally { setSaving(false); }
  };

  const downloadPdf = () => {
    window.open(`/api/offers/${offer.id}/letter/pdf`, '_blank');
  };

  const send = async () => {
    if (!confirm('Send offer letter PDF to candidate email?')) return;
    setSending(true);
    try {
      const r = await apiFetch(`/offers/${offer.id}/letter/send`, { method:'POST' });
      showT(r.sent
        ? `Sent to ${r.recipient} via ${r.channel}`
        : `Letter marked as sent (SMTP not configured — channel: ${r.channel})`);
      onSaved?.();
    } catch (e:any) { showT('Send failed: ' + (e?.message||'error')); }
    finally { setSending(false); }
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}}>
      <div style={{background:'white',borderRadius:'16px',width:'680px',maxHeight:'90vh',overflow:'auto',padding:'28px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        {toast && (
          <div style={{position:'fixed',top:'80px',right:'24px',zIndex:700,background:'#0f172a',color:'white',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'600'}}>
            {toast}
          </div>
        )}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'20px'}}>
          <div>
            <h2 style={{fontSize:'17px',fontWeight:'800',color:'#0f172a',margin:0}}>Offer Letter</h2>
            <p style={{fontSize:'12px',color:'#64748b',margin:'3px 0 0'}}>
              CTC: {offer?.ctc_offered ? `₹${(offer.ctc_offered/100000).toFixed(1)}L` : '—'} ·
              Joining: {offer?.joining_date || '—'} ·
              Status: <span style={{fontWeight:'700'}}>{offer?.status}</span>
            </p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'#94a3b8',padding:'0 4px'}}>×</button>
        </div>

        <div style={{marginBottom:'12px'}}>
          <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>
            Letter Body
            <span style={{fontWeight:'400',color:'#94a3b8',marginLeft:'8px'}}>
              Leave blank to use the standard template
            </span>
          </label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Enter custom offer letter text here, or leave blank for the auto-generated template (includes CTC, joining date, and acceptance section)..."
            rows={12}
            style={{
              width:'100%', border:'1px solid #e2e8f0', borderRadius:'8px',
              padding:'12px', fontSize:'13px', lineHeight:'1.7', outline:'none',
              fontFamily:'serif', resize:'vertical', boxSizing:'border-box'
            }}
          />
        </div>

        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={save} disabled={saving}
            style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 16px',background:'#0f172a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600',opacity:saving?0.6:1}}>
            <FileText size={13}/> {saving ? 'Saving…' : 'Save Letter'}
          </button>
          <button onClick={downloadPdf}
            style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 16px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
            <Download size={13}/> Download PDF
          </button>
          <button onClick={send} disabled={sending}
            style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 16px',background:'#16a34a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600',opacity:sending?0.6:1}}>
            <Mail size={13}/> {sending ? 'Sending…' : 'Send to Candidate'}
          </button>
          <RequestSignBtn offer={offer} />
          <button onClick={onClose}
            style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 16px',background:'white',color:'#374151',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
            Cancel
          </button>
        </div>

        {letter?.sent_at && (
          <div style={{marginTop:'12px',padding:'10px 14px',background:'#f0fdf4',borderRadius:'8px',fontSize:'12px',color:'#16a34a',fontWeight:'600'}}>
            ✓ Sent at {new Date(letter.sent_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}



// ─── Request Signature Button (inline in LetterModal) ────────────────────────
function RequestSignBtn({ offer }: any) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  async function requestSign() {
    setLoading(true);
    try {
      const r = await apiFetch('/offers/' + offer.id + '/letter/request-sign', { method: 'POST' });
      setUrl(r.url || '');
    } catch {
      alert('Failed to generate signing link. Make sure the offer letter is saved first.');
    } finally {
      setLoading(false);
    }
  }

  if (url) return (
    <div style={{display:'flex',flexDirection:'column',gap:'6px',width:'100%',marginTop:'8px',padding:'12px',background:'#eff6ff',borderRadius:'8px',border:'1px solid #bfdbfe'}}>
      <div style={{fontSize:'12px',fontWeight:'700',color:'#1e40af'}}>✍️ Signing link ready — share with candidate:</div>
      <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
        <input readOnly value={url} style={{flex:1,padding:'7px 10px',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'12px',background:'white',fontFamily:'monospace'}} onClick={e=>(e.target as HTMLInputElement).select()} />
        <button onClick={()=>{navigator.clipboard.writeText(url);alert('Copied!');}} style={{padding:'7px 12px',background:'#1e40af',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap'}}>Copy</button>
      </div>
    </div>
  );

  return (
    <button onClick={requestSign} disabled={loading}
      style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 16px',background:'#7c3aed',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600',opacity:loading?0.6:1}}>
      ✍️ {loading ? 'Generating…' : 'Request e-Signature'}
    </button>
  );
}

// ─── AI Offer Generate Modal (unchanged) ─────────────────────────────────────
function OfferModal({ onClose, onCreated }:any) {
  const { data: appsData } = useFetch<any>('/applications?limit=200');
  const [form, setForm] = useState({ application_id:'', ctc_offered:'', joining_date:'', currency:'INR', generate_letter:true });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const apps:any[] = Array.isArray(appsData) ? appsData : (appsData?.items || []);
  const eligibleApps = apps.filter((a:any) => ['submitted','interview','l1_interview','l2_interview','offer'].includes(a.stage));

  const save = async () => {
    if (!form.application_id || !form.ctc_offered || !form.joining_date) return;
    setSaving(true);
    try {
      const r = await apiFetch('/auto-offer/generate', { method:'POST', body: JSON.stringify({...form, ctc_offered: Number(form.ctc_offered)}) });
      setResult(r);
      onCreated?.();
    } catch(e:any) { alert('Error: ' + (e?.message||'Failed')); }
    finally { setSaving(false); }
  };

  const copy = () => { navigator.clipboard.writeText(result?.offer_letter||''); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  const iStyle = {width:'100%',border:'1px solid #e2e8f0',borderRadius:'7px',padding:'8px 10px',fontSize:'13px',outline:'none',boxSizing:'border-box' as const};

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}}>
      <div style={{background:'white',borderRadius:'16px',width:'620px',maxHeight:'85vh',overflow:'auto',padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{display:'flex',justifyContent:'space-between',marginBottom:'20px'}}>
          <div>
            <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',margin:0}}>Generate Offer Letter</h2>
            <p style={{fontSize:'12px',color:'#8b5cf6',margin:'2px 0 0'}}>Powered by Ollama Qwen2.5 · Zero external tokens</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#94a3b8'}}>×</button>
        </div>
        {result ? (
          <div>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
              <CheckCircle size={20} color="#22c55e"/>
              <span style={{fontWeight:'700',color:'#0f172a'}}>Offer generated for {result.candidate}</span>
              <span style={{fontSize:'11px',color:'#8b5cf6',background:'#f5f3ff',padding:'2px 7px',borderRadius:'20px'}}>{result.generated_by}</span>
            </div>
            <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'16px',marginBottom:'14px',fontFamily:'serif',fontSize:'13px',lineHeight:'1.8',whiteSpace:'pre-wrap',maxHeight:'320px',overflowY:'auto'}}>
              {result.offer_letter}
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <button onClick={copy} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 16px',background:copied?'#22c55e':'#0f172a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
                <Copy size={13}/> {copied?'Copied!':'Copy Letter'}
              </button>
              <button onClick={onClose} style={{padding:'8px 16px',background:'white',color:'#374151',border:'1px solid #e2e8f0',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>Done</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Application *</label>
                <select value={form.application_id} onChange={e=>setForm(p=>({...p,application_id:e.target.value}))} style={iStyle}>
                  <option value="">Select application…</option>
                  {eligibleApps.map((a:any)=>(
                    <option key={a.id} value={a.id}>{a.candidate_name||a.candidate_id} — {a.requisition_title||a.requisition_id}</option>
                  ))}
                </select>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                <div>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>CTC Offered (₹) *</label>
                  <input type="number" value={form.ctc_offered} onChange={e=>setForm(p=>({...p,ctc_offered:e.target.value}))} placeholder="e.g. 1200000" style={iStyle}/>
                </div>
                <div>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Joining Date *</label>
                  <input type="date" value={form.joining_date} onChange={e=>setForm(p=>({...p,joining_date:e.target.value}))} style={iStyle}/>
                </div>
              </div>
            </div>
            <div style={{marginTop:'20px',display:'flex',gap:'8px'}}>
              <button onClick={save} disabled={saving||!form.application_id||!form.ctc_offered||!form.joining_date}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 20px',background:'#7c3aed',color:'white',border:'none',borderRadius:'9px',cursor:'pointer',fontSize:'13px',fontWeight:'700',opacity:(saving||!form.application_id||!form.ctc_offered||!form.joining_date)?0.5:1}}>
                <Sparkles size={14}/> {saving?'Generating…':'Generate with Ollama'}
              </button>
              <button onClick={onClose} style={{padding:'9px 16px',background:'white',color:'#374151',border:'1px solid #e2e8f0',borderRadius:'9px',cursor:'pointer',fontSize:'13px'}}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OffersPage() {
  const { data: aiOffers, loading: aiLoading, mutate: aiMutate } = useFetch<any[]>('/auto-offer/list');
  const { data: formalOffers, loading: formalLoading, mutate: formalMutate } = useFetch<any[]>('/offers');
  const [tab, setTab] = useState<'ai'|'formal'>('ai');
  const [showModal, setShowModal] = useState(false);
  const [letterOffer, setLetterOffer] = useState<any>(null);
  const [genLink, setGenLink] = useState<Record<string,string>>({});
  const [toast, setToast] = useState('');

  const showT = (m:string) => { setToast(m); setTimeout(()=>setToast(''),3000); };

  const generateLink = async (appId:string) => {
    try {
      const r = await apiFetch(`/self-schedule/generate/${appId}`, { method:'POST' });
      setGenLink(prev=>({...prev,[appId]:r.link}));
      await navigator.clipboard.writeText(`https://ats.aviinjobs.com${r.link}`);
      showT('Self-scheduling link copied to clipboard!');
    } catch { showT('Failed to generate link'); }
  };

  const list:any[] = Array.isArray(aiOffers) ? aiOffers : [];
  const formal:any[] = Array.isArray(formalOffers) ? formalOffers : [];

  const stats = {
    total: list.length + formal.length,
    issued: formal.filter(o=>o.status==='issued').length,
    accepted: formal.filter(o=>o.status==='accepted').length,
    declined: formal.filter(o=>o.status==='declined').length,
  };

  const tabStyle = (t: string) => ({
    padding:'8px 18px', borderRadius:'8px', border:'none', cursor:'pointer',
    fontSize:'13px', fontWeight:'600',
    background: tab===t ? '#0f172a' : 'transparent',
    color: tab===t ? 'white' : '#64748b',
    transition:'all .15s',
  });

  return (
    <div className="anim-fade-up" style={{display:'flex',flexDirection:'column',gap:'20px'}}>
      {toast&&<div style={{position:'fixed',top:'80px',right:'24px',zIndex:1000,background:'#0f172a',color:'white',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'600'}}>✓ {toast}</div>}
      {showModal&&<OfferModal onClose={()=>setShowModal(false)} onCreated={()=>{aiMutate?.();setShowModal(false);}}/>}
      {letterOffer&&<LetterModal offer={letterOffer} onClose={()=>setLetterOffer(null)} onSaved={()=>formalMutate?.()}/>}

      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'2px'}}>Offer Engine</h1>
          <p style={{fontSize:'13px',color:'#64748b'}}>AI-generated letters · Formal offer management · PDF download</p>
        </div>
        <button onClick={()=>setShowModal(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 18px',background:'#7c3aed',color:'white',border:'none',borderRadius:'9px',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>
          <Sparkles size={14}/> Generate Offer
        </button>
      </div>

      {/* KPI row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'12px'}}>
        {[{l:'Total Offers',v:stats.total,c:'#3b82f6'},{l:'Issued',v:stats.issued,c:'#0891b2'},{l:'Accepted',v:stats.accepted,c:'#22c55e'},{l:'Declined',v:stats.declined,c:'#ef4444'}].map(({l,v,c})=>(
          <div key={l} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'16px'}}>
            <div style={{fontSize:'24px',fontWeight:'800',color:'#0f172a'}}>{v}</div>
            <div style={{fontSize:'11px',color:'#94a3b8',textTransform:'uppercase' as const,letterSpacing:'0.06em',marginTop:'2px'}}>{l}</div>
            <div style={{height:'2px',background:c,borderRadius:'1px',width:'50%',marginTop:'8px'}}/>
          </div>))}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'4px',padding:'4px',background:'#f1f5f9',borderRadius:'10px',width:'fit-content'}}>
        <button style={tabStyle('ai')} onClick={()=>setTab('ai')}>
          <Sparkles size={12} style={{marginRight:'5px',verticalAlign:'middle'}}/>AI Generated
        </button>
        <button style={tabStyle('formal')} onClick={()=>setTab('formal')}>
          <FileText size={12} style={{marginRight:'5px',verticalAlign:'middle'}}/>Formal Offers + Letters
        </button>
      </div>

      {/* AI Offers Table */}
      {tab==='ai' && (
        aiLoading ? <div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>Loading...</div> :
        list.length===0 ?
          <div style={{textAlign:'center',padding:'48px',color:'#94a3b8',fontSize:'14px'}}>No AI-generated offers yet. Click "Generate Offer" to create one.</div>
        : (
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                {['CANDIDATE','JOB','CTC OFFERED','JOINING','STATUS','ACTIONS'].map(h=>(
                  <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#64748b',letterSpacing:'0.06em'}}>{h}</th>))}
              </tr></thead>
              <tbody>
                {list.map((offer:any)=>{
                  const badge = STATUS_BADGE[offer.status]||STATUS_BADGE.draft;
                  const ctcL = offer.ctc_offered >= 100000 ? `₹${(offer.ctc_offered/100000).toFixed(1)}L` : `₹${offer.ctc_offered}`;
                  const link = genLink[offer.application_id];
                  return (
                    <tr key={offer.id} style={{borderBottom:'1px solid #f1f5f9'}}
                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8fafc'}
                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='white'}>
                      <td style={{padding:'12px 14px'}}>
                        <div style={{fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{offer.candidate}</div>
                        <div style={{fontSize:'11px',color:'#94a3b8'}}>{offer.email}</div>
                      </td>
                      <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{offer.job_title||'—'}</td>
                      <td style={{padding:'12px 14px'}}>
                        <div style={{fontWeight:'700',fontSize:'13px',color:'#16a34a'}}>{ctcL}</div>
                      </td>
                      <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{offer.joining_date||'—'}</td>
                      <td style={{padding:'12px 14px'}}>
                        <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',background:badge.bg,color:badge.color}}>{badge.label}</span>
                      </td>
                      <td style={{padding:'12px 14px'}}>
                        <button onClick={()=>generateLink(offer.application_id)} title="Generate self-scheduling link"
                          style={{display:'flex',alignItems:'center',gap:'4px',padding:'4px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'11px',color:'#8b5cf6',fontWeight:'600'}}>
                          <ExternalLink size={11}/> {link?'Copied!':'Schedule Link'}
                        </button>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Formal Offers Table */}
      {tab==='formal' && (
        formalLoading ? <div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>Loading...</div> :
        formal.length===0 ?
          <div style={{textAlign:'center',padding:'48px',color:'#94a3b8',fontSize:'14px'}}>
            No formal offers yet. Create offers from the candidate pipeline (stage: offer).
          </div>
        : (
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                {['OFFER ID','CTC','CURRENCY','JOINING','STATUS','LETTER'].map(h=>(
                  <th key={h} style={{padding:'11px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#64748b',letterSpacing:'0.06em'}}>{h}</th>))}
              </tr></thead>
              <tbody>
                {formal.map((offer:any)=>{
                  const badge = STATUS_BADGE[offer.status]||STATUS_BADGE.draft;
                  const ctcL = offer.ctc_offered
                    ? (offer.ctc_offered>=100000 ? `₹${(offer.ctc_offered/100000).toFixed(1)}L` : `₹${Number(offer.ctc_offered).toLocaleString()}`)
                    : '—';
                  return (
                    <tr key={offer.id} style={{borderBottom:'1px solid #f1f5f9'}}
                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8fafc'}
                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='white'}>
                      <td style={{padding:'12px 14px'}}>
                        <code style={{fontSize:'11px',color:'#64748b',background:'#f1f5f9',padding:'2px 6px',borderRadius:'4px'}}>
                          {offer.id?.slice(0,8)}…
                        </code>
                      </td>
                      <td style={{padding:'12px 14px',fontWeight:'700',fontSize:'13px',color:'#16a34a'}}>{ctcL}</td>
                      <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{offer.currency||'INR'}</td>
                      <td style={{padding:'12px 14px',fontSize:'13px',color:'#475569'}}>{offer.joining_date||'—'}</td>
                      <td style={{padding:'12px 14px'}}>
                        <span style={{padding:'3px 9px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',background:badge.bg,color:badge.color}}>{badge.label}</span>
                      </td>
                      <td style={{padding:'12px 14px'}}>
                        <button
                          onClick={()=>setLetterOffer(offer)}
                          style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',borderRadius:'7px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',color:'#1e40af',fontWeight:'600'}}>
                          <Edit3 size={12}/> Manage Letter
                        </button>
                      </td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
