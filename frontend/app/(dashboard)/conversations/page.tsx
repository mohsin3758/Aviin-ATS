'use client';
import { useState, useEffect, useRef, useCallback, CSSProperties } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  Mail, MessageCircle, Send, Trash2, FileText, Inbox, RefreshCw, Search,
  X, Plus, Wifi, WifiOff, Star, Reply, Forward, Loader2, Zap, RotateCcw,
  Phone, PenSquare, ChevronDown, ChevronRight, AlertCircle, CheckCircle,
  EyeOff, Paperclip, AtSign, Bold, Italic, Underline, AlignLeft,
  AlignCenter, AlignRight, AlignJustify, List, ListOrdered, Indent,
  Outdent, Link as LinkIcon, Image, Table, Strikethrough, Maximize2, Minimize2,
  Highlighter, Type, Minus, Flag, Clock, Archive, MoreHorizontal,
  Filter, SortAsc, CheckSquare, Square, Eye, ShieldOff, Printer, Download, Bell, FolderPlus
} from 'lucide-react';

type Folder = 'inbox'|'sent'|'drafts'|'trash'|'starred'|'whatsapp'|'archive'|'junk'|'snoozed'|'ats_inbox';
interface Msg {
  id: string; candidate_id: string; candidate_name: string;
  email: string; phone: string; channel: string; direction: string;
  subject: string; body: string; status: string; created_at: string;
  deleted_at?: string; sent_by_name?: string; is_read: boolean;
  is_starred: boolean; to_email?: string; cc?: string;
  msg_count?: number; unread_count?: number;
}
interface Draft {
  id: string; candidate_id?: string; candidate_name?: string;
  email?: string; to_email?: string; channel: string;
  subject?: string; body: string; cc?: string; updated_at: string;
}
interface ToRecipient { id?: string; email: string; name: string; }
interface EmailAccount { id: string; email: string; display_name: string; provider: string; is_default: boolean; verified: boolean; }

const CH_CLR: Record<string,string> = { email:'#3b82f6', whatsapp:'#22c55e', sms:'#f59e0b' };
const ST_CLR: Record<string,string> = { sent:'#16a34a', failed:'#dc2626', pending:'#d97706' };

function fmtDate(dt: string) {
  if (!dt) return '';
  const d = new Date(dt), now = new Date();
  const diff = (now.getTime()-d.getTime())/1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60)+'m ago';
  if (diff < 86400) return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  if (diff < 604800) return d.toLocaleDateString('en-IN',{weekday:'short',hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
function fmtGroup(dt: string) {
  const d = new Date(dt), now = new Date();
  const diff = (now.getTime()-d.getTime())/86400000;
  if (diff < 1) return 'Today';
  if (diff < 2) return 'Yesterday';
  if (diff < 7) return 'This Week';
  if (diff < 30) return 'This Month';
  return d.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
}
function strip(html: string) {
  if (!html) return '';
  // For full HTML documents, only use body content for preview
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let t = bodyMatch ? bodyMatch[1] : html;
  // Remove head, style, script blocks
  t = t.replace(/<head[\s\S]*?<\/head>/gi, '');
  t = t.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  // Remove conditional comments (Word)
  t = t.replace(/<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->/gi, '');
  // Remove all HTML tags
  t = t.replace(/<[^>]+>/g, ' ');
  // Decode entities
  t = t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"');
  // Clean up and get first meaningful line
  const lines = t.split(/\n/).map(l=>l.trim()).filter(l=>l.length>2 && !/^\d+$/.test(l));
  return (lines[0] || '').slice(0, 120);
}
function Avatar({ name, size=32 }: { name:string; size?:number }) {
  const ch = (name||'?')[0].toUpperCase();
  const colors = ['#3b82f6','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899'];
  return (
    <div style={{width:size,height:size,borderRadius:'50%',flexShrink:0,
      background:colors[ch.charCodeAt(0)%colors.length],
      display:'flex',alignItems:'center',justifyContent:'center',
      color:'white',fontWeight:'700',fontSize:Math.round(size*.38)}}>
      {ch}
    </div>
  );
}

function ComposePane({
  initial, candidates, templates, mailAccounts,
  onSend, onDraft, onDiscard
}: {
  initial: Partial<Draft>;
  candidates: any[]; templates: any[]; mailAccounts: EmailAccount[];
  onSend: (d:any)=>Promise<void>;
  onDraft: (d:any)=>Promise<void>;
  onDiscard: ()=>void;
}) {
  const defaultAcc = mailAccounts.find(a=>a.is_default) || mailAccounts[0] || null;
  const [fromAccId, setFromAccId] = useState<string>(defaultAcc?.id || '');
  const [to, setTo] = useState<ToRecipient|null>(
    initial.candidate_id ? {id:initial.candidate_id,email:initial.email||'',name:initial.candidate_name||''}
    : initial.to_email ? {email:initial.to_email,name:initial.to_email} : null
  );
  const [toInput, setToInput] = useState(initial.to_email||initial.email||'');
  const [toSugg, setToSugg] = useState<any[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const [cc, setCc] = useState(initial.cc||'');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(initial.subject||'');
  const [channel, setChannel] = useState<'email'|'whatsapp'>((initial.channel as any)||'email');
  const [sending, setSending] = useState(false);
  const [autoSaved, setAutoSaved] = useState('');
  const [draftId, setDraftId] = useState<string|null>(null);
  const [showSig, setShowSig] = useState(true);
  const SIG_SEP = '<div data-sig="1"><hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0 8px"/>';
  const SIG_END = '</div>';

  const [fullscreen, setFullscreen] = useState(false);
  const [priority, setPriority] = useState<'normal'|'high'|'low'>('normal');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [readReceipt, setReadReceipt] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [showFontFamily, setShowFontFamily] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoTimer = useRef<any>(null);

  const selectedAcc = mailAccounts.find(a=>a.id===fromAccId);

  // Fetch and insert signature when account changes
  useEffect(() => {
    if (!fromAccId) {
      if (bodyRef.current && !bodyRef.current.innerHTML) bodyRef.current.innerHTML = initial.body || '';
      return;
    }
    apiFetch('/signatures/for-account/' + fromAccId)
      .then(sigData => {
        const sigHtml = sigData?.new_mail?.html || '';
        const bodyBase = initial.body || '';
        if (bodyRef.current) {
          if (showSig && sigHtml.trim()) {
            const SEP = '<div data-sig="1"><p><br></p><hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0"/><p style="font-size:11px;color:#94a3b8;margin:0 0 6px">--</p>';
            bodyRef.current.innerHTML = (bodyBase || '<p><br></p>') + SEP + sigHtml + '</div>';
          } else {
            bodyRef.current.innerHTML = bodyBase || '';
          }
        }
      })
      .catch(() => {
        if (bodyRef.current && !bodyRef.current.innerHTML) bodyRef.current.innerHTML = initial.body || '';
      });
  }, [fromAccId, showSig]);


  useEffect(() => {
    if (toInput.length < 2 || to) { setToSugg([]); return; }
    const q = toInput.toLowerCase();
    setToSugg(candidates.filter((c:any)=>
      (c.full_name||'').toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q)
    ).slice(0,8));
    setShowSugg(true);
  }, [toInput, candidates, to]);

  // Auto-save draft every 30s
  useEffect(() => {
    autoTimer.current = setInterval(async()=>{
      const body = bodyRef.current?.innerHTML||'';
      if (!body.trim()&&!subject) return;
      try {
        const payload = {candidate_id:to?.id||undefined,to_email:!to?.id?(to?.email||undefined):undefined,channel,subject,body,cc};
        if (draftId) {
          await apiFetch('/communications/drafts/'+draftId,{method:'PUT',body:JSON.stringify(payload)});
        } else {
          const r = await apiFetch('/communications/drafts',{method:'POST',body:JSON.stringify(payload)});
          if(r.id) setDraftId(r.id);
        }
        setAutoSaved(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
      } catch {}
    }, 30000);
    return ()=>clearInterval(autoTimer.current);
  }, [to, subject, channel, cc, draftId]);

  const updateWordCount = () => {
    const text = bodyRef.current?.innerText||'';
    setWordCount(text.trim().split(/\s+/).filter(Boolean).length);
  };

  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    bodyRef.current?.focus();
    updateWordCount();
  };

  const insertTable = (rows=3, cols=3) => {
    let html = '<table class="data-table" style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>';
    for (let r=0; r<rows; r++) {
      html += '<tr>';
      for (let c2=0; c2<cols; c2++) {
        const tag = r===0?'th':'td';
        html += `<${tag} style="border:1px solid #cbd5e1;padding:7px 10px;min-width:80px;font-size:13px">${r===0?'Column '+(c2+1):''}</${tag}>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    document.execCommand('insertHTML', false, html);
    bodyRef.current?.focus();
  };

  const applyFontFamily = (f: string) => { exec('fontName', f); setShowFontFamily(false); };
  const applyFontSize = (s: string) => { exec('fontSize', s); setShowFontSize(false); };

  const handleUndoSend = () => {
    if (undoToast) {
      clearTimeout(undoToast.timer);
      setUndoToast(null);
      showToast('Send cancelled ✓');
    }
  };

  const handleSend = async () => {
    if (!to || !bodyRef.current?.innerHTML.trim()) return;
    setSending(true);
    clearInterval(autoTimer.current);
    try {
      const body = bodyRef.current?.innerHTML||'';
      if (fromAccId && selectedAcc) {
        // Use multipart FormData to support file attachments
        const fd = new FormData();
        fd.append('acc_id', fromAccId);
        fd.append('to_email', to.email);
        fd.append('subject', subject||'');
        fd.append('body', body);
        fd.append('cc', cc||'');
        fd.append('bcc', bcc||'');
        fd.append('read_receipt', readReceipt?'true':'false');
        for (const f of attachments) fd.append('files', f);
        const {authHeaders} = await import('@/lib/auth');
        const res = await fetch((process.env.NEXT_PUBLIC_API_URL??'/api')+'/user-mail/send-with-attachments', {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
        if (!res.ok) { const e = await res.json().catch(()=>({detail:'Send failed'})); throw new Error(e.detail||'Send failed'); }
        // Also log to candidate_messages if candidate
        if (to.id) {
          await apiFetch('/communications/send',{method:'POST',body:JSON.stringify({
            candidate_id:to.id, channel:'email', subject, message:body, cc:cc||undefined
          })}).catch(()=>{});
        }
      } else {
        await onSend({candidate_id:to.id||undefined,to_email:!to.id?to.email:undefined,channel,subject,message:body,cc:cc||undefined,bcc:bcc||undefined});
      }
      if (draftId) await apiFetch('/communications/drafts/'+draftId,{method:'DELETE'}).catch(()=>{});
      onDiscard(); // close compose pane after successful send
    } finally { setSending(false); }
  };

  const handleDraft = async () => {
    const body = bodyRef.current?.innerHTML||'';
    const payload = {candidate_id:to?.id||undefined,to_email:!to?.id?(to?.email||undefined):undefined,channel,subject,body,cc};
    if (draftId) {
      await apiFetch('/communications/drafts/'+draftId,{method:'PUT',body:JSON.stringify(payload)});
    } else {
      const r = await apiFetch('/communications/drafts',{method:'POST',body:JSON.stringify(payload)});
      if(r.id) setDraftId(r.id);
    }
    onDiscard();
  };

  const FONTS = ['Arial','Georgia','Times New Roman','Courier New','Verdana','Trebuchet MS','Impact'];
  const SIZES = [['1','8px'],['2','10px'],['3','12px'],['4','14px'],['5','18px'],['6','24px'],['7','36px']];
  const COLORS = ['#000000','#dc2626','#16a34a','#2563eb','#9333ea','#ea580c','#0891b2','#374151','#6b7280','#ffffff'];

  const INP: CSSProperties = {border:'none',outline:'none',fontSize:'13px',color:'#1e293b',background:'transparent',padding:'0',flex:1};

  const containerStyle: CSSProperties = fullscreen
    ? {position:'fixed',inset:0,zIndex:9999,display:'flex',flexDirection:'column',background:'white'}
    : {flex:1,display:'flex',flexDirection:'column',background:'white',minHeight:0};

  return (
    <div style={containerStyle}>
      {/* Header bar */}
      <div style={{padding:'10px 16px',background:'#1e40af',display:'flex',alignItems:'center',
        justifyContent:'space-between',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
          <PenSquare size={14} color="white"/>
          <span style={{fontSize:'14px',fontWeight:'700',color:'white'}}>New Message</span>
          {priority==='high' && <span style={{fontSize:'10px',background:'#dc2626',color:'white',padding:'2px 7px',borderRadius:'10px',fontWeight:'700'}}>HIGH PRIORITY</span>}
          {autoSaved && <span style={{fontSize:'10px',color:'rgba(255,255,255,0.6)'}}>Draft saved {autoSaved}</span>}
        </div>
        <div style={{display:'flex',gap:'6px'}}>
          {/* Channel toggle */}
          <div style={{display:'flex',gap:'3px',background:'rgba(255,255,255,0.15)',borderRadius:'6px',padding:'2px'}}>
            {([['email','✉ Email'],['whatsapp','💬 WA']] as [string,string][]).map(([ch,lb])=>(
              <button key={ch} onClick={()=>setChannel(ch as any)}
                style={{padding:'4px 10px',borderRadius:'5px',border:'none',fontSize:'11px',fontWeight:'700',
                  background:channel===ch?'white':'transparent',color:channel===ch?'#1e40af':'rgba(255,255,255,0.7)',cursor:'pointer'}}>
                {lb}
              </button>
            ))}
          </div>
          <button onClick={()=>setFullscreen(v=>!v)} title={fullscreen?'Exit fullscreen':'Fullscreen'}
            style={{padding:'5px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'5px',cursor:'pointer',color:'white'}}>
            {fullscreen?<Minimize2 size={13}/>:<Maximize2 size={13}/>}
          </button>
          <button onClick={onDiscard}
            style={{padding:'5px',background:'rgba(255,255,255,0.15)',border:'none',borderRadius:'5px',cursor:'pointer',color:'white'}}>
            <X size={14}/>
          </button>
        </div>
      </div>

      {/* From field */}
      {mailAccounts.length > 0 && (
        <div style={{padding:'7px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'10px',flexShrink:0,background:'#fafafa'}}>
          <span style={{fontSize:'12px',color:'#94a3b8',width:'52px',flexShrink:0,fontWeight:'500'}}>From</span>
          <select value={fromAccId} onChange={e=>setFromAccId(e.target.value)}
            style={{...INP,cursor:'pointer',fontSize:'13px',fontWeight:'500',color:'#1e40af',padding:'2px 0'}}>
            <option value="">Company default account</option>
            {mailAccounts.map(a=>(
              <option key={a.id} value={a.id}>
                {a.display_name} &lt;{a.email}&gt;{a.is_default?' (Default)':''}
              </option>
            ))}
          </select>
          {selectedAcc?.verified && <CheckCircle size={13} color="#22c55e"/>}
          {fromAccId && !selectedAcc?.verified && <AlertCircle size={13} color="#f59e0b"/>}
        </div>
      )}

      {/* To field */}
      <div style={{padding:'7px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'10px',flexShrink:0,position:'relative'}}>
        <span style={{fontSize:'12px',color:'#94a3b8',width:'52px',flexShrink:0,fontWeight:'500'}}>To</span>
        <div style={{flex:1,display:'flex',alignItems:'center',gap:'5px',flexWrap:'wrap'}}>
          {to ? (
            <span style={{display:'flex',alignItems:'center',gap:'4px',background:'#eff6ff',color:'#1e40af',
              padding:'2px 8px 2px 6px',borderRadius:'14px',fontSize:'12px',fontWeight:'600'}}>
              <Avatar name={to.name} size={16}/>
              {to.name!==to.email?to.name+' <'+to.email+'>':to.email}
              <button onClick={()=>{setTo(null);setToInput('');}} style={{background:'none',border:'none',cursor:'pointer',padding:'0 0 0 2px',color:'#94a3b8'}}>
                <X size={10}/>
              </button>
            </span>
          ) : (
            <input value={toInput} onChange={e=>setToInput(e.target.value)}
              onBlur={()=>{setTimeout(()=>{setShowSugg(false);if(!to&&toInput.includes('@'))setTo({email:toInput.trim(),name:toInput.trim()});},150);}}
              placeholder="Type name, email, or paste address..."
              style={{...INP,minWidth:'220px'}}/>
          )}
        </div>
        <div style={{display:'flex',gap:'6px',flexShrink:0}}>
          {!showCc&&<button onClick={()=>setShowCc(true)} style={{fontSize:'11px',color:'#94a3b8',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}}>CC</button>}
          {!showBcc&&<button onClick={()=>setShowBcc(true)} style={{fontSize:'11px',color:'#94a3b8',background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}}>BCC</button>}
        </div>
        {/* Autocomplete */}
        {showSugg && toSugg.length > 0 && (
          <div style={{position:'absolute',top:'100%',left:'68px',right:0,background:'white',
            border:'1px solid #e2e8f0',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.12)',
            zIndex:200,maxHeight:'200px',overflowY:'auto'}}>
            {toSugg.map((cd:any)=>(
              <div key={cd.id} onMouseDown={()=>{setTo({id:cd.id,email:cd.email||'',name:cd.full_name});setToInput(cd.full_name);setShowSugg(false);}}
                style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 14px',cursor:'pointer'}}
                onMouseEnter={e=>(e.currentTarget.style.background='#f8fafc')}
                onMouseLeave={e=>(e.currentTarget.style.background='white')}>
                <Avatar name={cd.full_name} size={26}/>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#1e293b'}}>{cd.full_name}</div>
                  <div style={{fontSize:'11px',color:'#64748b'}}>{cd.email||cd.phone}</div>
                </div>
              </div>
            ))}
            {toInput.includes('@') && (
              <div onMouseDown={()=>{setTo({email:toInput,name:toInput});setShowSugg(false);}}
                style={{display:'flex',alignItems:'center',gap:'8px',padding:'8px 14px',cursor:'pointer',
                  borderTop:'1px solid #f1f5f9',color:'#1e40af'}}>
                <AtSign size={13}/><span style={{fontSize:'12px'}}>Send to "{toInput}"</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* CC/BCC */}
      {showCc && (
        <div style={{padding:'6px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
          <span style={{fontSize:'12px',color:'#94a3b8',width:'52px',flexShrink:0}}>CC</span>
          <input value={cc} onChange={e=>setCc(e.target.value)} placeholder="Carbon copy..."
            style={{...INP,flex:1}}/>
          <button onClick={()=>{setShowCc(false);setCc('');}} style={{background:'none',border:'none',cursor:'pointer'}}><X size={11} color="#94a3b8"/></button>
        </div>
      )}
      {showBcc && (
        <div style={{padding:'6px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
          <span style={{fontSize:'12px',color:'#94a3b8',width:'52px',flexShrink:0}}>BCC</span>
          <input value={bcc} onChange={e=>setBcc(e.target.value)} placeholder="Blind carbon copy..."
            style={{...INP,flex:1}}/>
          <button onClick={()=>{setShowBcc(false);setBcc('');}} style={{background:'none',border:'none',cursor:'pointer'}}><X size={11} color="#94a3b8"/></button>
        </div>
      )}

      {/* Subject */}
      {channel==='email' && (
        <div style={{padding:'7px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
          <span style={{fontSize:'12px',color:'#94a3b8',width:'52px',flexShrink:0,fontWeight:'500'}}>Subject</span>
          <input value={subject} onChange={e=>setSubject(e.target.value)}
            placeholder="Enter subject..." style={{...INP,flex:1,fontSize:'14px',fontWeight:'500'}}/>
          {/* Priority selector */}
          <select value={priority} onChange={e=>setPriority(e.target.value as any)}
            style={{fontSize:'11px',border:'1px solid #e2e8f0',borderRadius:'5px',padding:'3px 6px',color:'#64748b',cursor:'pointer',flexShrink:0}}>
            <option value="normal">Normal</option>
            <option value="high">🔴 High Priority</option>
            <option value="low">🔵 Low Priority</option>
          </select>
        </div>
      )}

      {/* OUTLOOK-STYLE TOOLBAR */}
      {channel==='email' && (
        <div style={{flexShrink:0,borderBottom:'1px solid #e2e8f0',background:'#f8fafc'}}>
          {/* Row 1: Font controls */}
          <div style={{padding:'4px 12px',display:'flex',alignItems:'center',gap:'2px',flexWrap:'wrap',borderBottom:'1px solid #f1f5f9'}}>
            {/* Template picker */}
            {templates.length>0 && (
              <>
                <select onChange={e=>{
                  const t=templates.find((x:any)=>x.id===e.target.value);
                  if(t){setSubject(p=>t.subject||p);if(bodyRef.current)bodyRef.current.innerHTML=t.body_html||'';}
                  e.target.value='';
                }} style={{fontSize:'11px',border:'1px solid #e2e8f0',borderRadius:'5px',padding:'3px 6px',color:'#374151',cursor:'pointer',maxWidth:'120px'}}>
                  <option value="">Templates...</option>
                  {templates.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div style={{width:'1px',height:'20px',background:'#e2e8f0',margin:'0 4px'}}/>
              </>
            )}
            {/* Font family */}
            <div style={{position:'relative'}}>
              <button onClick={()=>{setShowFontFamily(v=>!v);setShowFontSize(false);}}
                style={{display:'flex',alignItems:'center',gap:'3px',padding:'3px 6px',border:'1px solid #e2e8f0',borderRadius:'5px',background:'white',cursor:'pointer',fontSize:'11px',color:'#374151',minWidth:'90px'}}>
                <Type size={11}/> Font <ChevronDown size={9}/>
              </button>
              {showFontFamily && (
                <div style={{position:'absolute',top:'100%',left:0,background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:100,minWidth:'160px',padding:'4px 0'}}>
                  {FONTS.map(f=>(
                    <div key={f} onMouseDown={()=>applyFontFamily(f)}
                      style={{padding:'7px 14px',cursor:'pointer',fontSize:'13px',fontFamily:f}}
                      onMouseEnter={e=>(e.currentTarget.style.background='#f8fafc')}
                      onMouseLeave={e=>(e.currentTarget.style.background='white')}>
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Font size */}
            <div style={{position:'relative'}}>
              <button onClick={()=>{setShowFontSize(v=>!v);setShowFontFamily(false);}}
                style={{display:'flex',alignItems:'center',gap:'3px',padding:'3px 6px',border:'1px solid #e2e8f0',borderRadius:'5px',background:'white',cursor:'pointer',fontSize:'11px',color:'#374151',minWidth:'60px'}}>
                12 <ChevronDown size={9}/>
              </button>
              {showFontSize && (
                <div style={{position:'absolute',top:'100%',left:0,background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:100,minWidth:'80px',padding:'4px 0'}}>
                  {SIZES.map(([val,px])=>(
                    <div key={val} onMouseDown={()=>applyFontSize(val)}
                      style={{padding:'5px 14px',cursor:'pointer',fontSize:px,color:'#1e293b'}}
                      onMouseEnter={e=>(e.currentTarget.style.background='#f8fafc')}
                      onMouseLeave={e=>(e.currentTarget.style.background='white')}>
                      {px}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{width:'1px',height:'20px',background:'#e2e8f0',margin:'0 3px'}}/>
            {/* B I U S */}
            {([
              [Bold,   ()=>exec('bold'),        'Bold (Ctrl+B)'],
              [Italic, ()=>exec('italic'),      'Italic (Ctrl+I)'],
              [Underline,()=>exec('underline'), 'Underline (Ctrl+U)'],
              [Strikethrough,()=>exec('strikeThrough'),'Strikethrough'],
            ] as any[]).map(([Ic,fn,title]:any,i:number)=>(
              <button key={i} onMouseDown={e=>{e.preventDefault();fn();}} title={title}
                style={{padding:'4px 6px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151',fontWeight:'700',fontSize:'12px'}}
                onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
                onMouseLeave={e=>(e.currentTarget.style.background='none')}>
                <Ic size={13}/>
              </button>
            ))}
            <div style={{width:'1px',height:'20px',background:'#e2e8f0',margin:'0 3px'}}/>
            {/* Text color */}
            <div style={{display:'flex',gap:'1px'}}>
              <span style={{fontSize:'10px',color:'#94a3b8',alignSelf:'center',marginRight:'3px'}}>A</span>
              {COLORS.slice(0,6).map(clr=>(
                <button key={clr} onMouseDown={e=>{e.preventDefault();exec('foreColor',clr);}}
                  title={'Text color: '+clr}
                  style={{width:'14px',height:'14px',borderRadius:'2px',background:clr,border:'1px solid #e2e8f0',cursor:'pointer'}}/>
              ))}
            </div>
            <div style={{width:'1px',height:'20px',background:'#e2e8f0',margin:'0 3px'}}/>
            {/* Highlight */}
            <span style={{fontSize:'10px',color:'#94a3b8',alignSelf:'center'}}>Highlight:</span>
            {['#fef9c3','#dcfce7','#dbeafe','#fce7f3'].map(clr=>(
              <button key={clr} onMouseDown={e=>{e.preventDefault();exec('hiliteColor',clr);}}
                style={{width:'14px',height:'14px',borderRadius:'2px',background:clr,border:'1px solid #e2e8f0',cursor:'pointer'}}/>
            ))}
            <div style={{width:'1px',height:'20px',background:'#e2e8f0',margin:'0 3px'}}/>
            <button onMouseDown={e=>{e.preventDefault();exec('removeFormat');}} title="Clear formatting"
              style={{padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',fontSize:'10px',color:'#94a3b8'}}
              onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
              onMouseLeave={e=>(e.currentTarget.style.background='none')}>
              Clear
            </button>
          </div>

          {/* Row 2: Paragraph controls */}
          <div style={{padding:'3px 12px',display:'flex',alignItems:'center',gap:'2px'}}>
            {([
              [List,       ()=>exec('insertUnorderedList'), 'Bullet List'],
              [ListOrdered,()=>exec('insertOrderedList'),  'Numbered List'],
            ] as any[]).map(([Ic,fn,title]:any,i:number)=>(
              <button key={i} onMouseDown={e=>{e.preventDefault();fn();}} title={title}
                style={{padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151'}}
                onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
                onMouseLeave={e=>(e.currentTarget.style.background='none')}>
                <Ic size={13}/>
              </button>
            ))}
            <div style={{width:'1px',height:'18px',background:'#e2e8f0',margin:'0 3px'}}/>
            {([
              [AlignLeft,    ()=>exec('justifyLeft'),    'Align Left'],
              [AlignCenter,  ()=>exec('justifyCenter'),  'Center'],
              [AlignRight,   ()=>exec('justifyRight'),   'Align Right'],
              [AlignJustify, ()=>exec('justifyFull'),    'Justify'],
            ] as any[]).map(([Ic,fn,title]:any,i:number)=>(
              <button key={i} onMouseDown={e=>{e.preventDefault();fn();}} title={title}
                style={{padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151'}}
                onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
                onMouseLeave={e=>(e.currentTarget.style.background='none')}>
                <Ic size={13}/>
              </button>
            ))}
            <div style={{width:'1px',height:'18px',background:'#e2e8f0',margin:'0 3px'}}/>
            {([
              [Outdent,()=>exec('outdent'),'Decrease Indent'],
              [Indent, ()=>exec('indent'), 'Increase Indent'],
            ] as any[]).map(([Ic,fn,title]:any,i:number)=>(
              <button key={i} onMouseDown={e=>{e.preventDefault();fn();}} title={title}
                style={{padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151'}}
                onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
                onMouseLeave={e=>(e.currentTarget.style.background='none')}>
                <Ic size={13}/>
              </button>
            ))}
            <div style={{width:'1px',height:'18px',background:'#e2e8f0',margin:'0 3px'}}/>
            {/* Table inserter */}
            <TablePicker onInsert={insertTable}/>
            {/* Image from URL */}
            <button onMouseDown={e=>{e.preventDefault();const u=prompt('Image URL:');if(u)exec('insertImage',u);}} title="Insert Image"
              style={{padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151'}}
              onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
              onMouseLeave={e=>(e.currentTarget.style.background='none')}>
              <Image size={13}/>
            </button>
            {/* Link */}
            <button onMouseDown={e=>{e.preventDefault();const u=prompt('URL:');if(u)exec('createLink',u);}} title="Insert Link"
              style={{display:'flex',alignItems:'center',gap:'3px',padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151'}}
              onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
              onMouseLeave={e=>(e.currentTarget.style.background='none')}>
              <LinkIcon size={13}/>
            </button>
            {/* Horizontal rule */}
            <button onMouseDown={e=>{e.preventDefault();exec('insertHorizontalRule');}} title="Insert Divider"
              style={{padding:'4px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151'}}
              onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
              onMouseLeave={e=>(e.currentTarget.style.background='none')}>
              <Minus size={13}/>
            </button>
            <div style={{width:'1px',height:'18px',background:'#e2e8f0',margin:'0 3px'}}/>
            <button onMouseDown={e=>{e.preventDefault();setShowSig(v=>!v);}} title={showSig?'Hide signature':'Show signature'}
              style={{display:'flex',alignItems:'center',gap:'4px',padding:'4px 8px',border:'1px solid '+(showSig?'#1e40af':'#e2e8f0'),borderRadius:'5px',background:showSig?'#eff6ff':'white',cursor:'pointer',fontSize:'11px',fontWeight:'700',color:showSig?'#1e40af':'#94a3b8'}}>
              ✍️ {showSig?'Sig ON':'Sig OFF'}
            </button>
            <div style={{marginLeft:'auto',fontSize:'10px',color:'#94a3b8'}}>
              {wordCount} words · Paste Excel tables directly ✓
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{flex:1,overflowY:'auto',padding:'16px 20px',background:'white',minHeight:0}}
        onKeyDown={e=>{if(e.ctrlKey&&e.key==='Enter')handleSend();}}
        onClick={e=>{
          const t=e.target as HTMLElement;
          if(t.tagName==='IMG'){
            const img=t as HTMLImageElement;
            const curr=img.style.width||(img.width?img.width+'px':'auto');
            const nw=prompt('Set image width (e.g. 120px or 50%):',curr);
            if(nw){img.style.width=nw;img.style.height='auto';updateWordCount();}
          } else {
            bodyRef.current?.focus();
          }
        }}>
        {channel==='email' ? (
          <div ref={bodyRef} contentEditable suppressContentEditableWarning
            onInput={updateWordCount}
            data-ph="Write your message here... or paste a table from Excel"
            style={{minHeight:'200px',outline:'none',fontSize:'14px',lineHeight:'1.75',color:'#1e293b'}}/>
        ) : (
          <textarea placeholder="Type WhatsApp message..."
            style={{width:'100%',height:'100%',minHeight:'200px',border:'none',outline:'none',
              fontSize:'14px',lineHeight:'1.7',color:'#1e293b',resize:'none',fontFamily:'inherit'}}/>
        )}
      </div>

      {/* Attachments preview */}
      {attachments.length>0 && (
        <div style={{padding:'8px 16px',borderTop:'1px solid #f1f5f9',display:'flex',gap:'6px',flexWrap:'wrap',flexShrink:0}}>
          {attachments.map((f,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:'5px',padding:'4px 8px',
              background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'6px',fontSize:'11px',color:'#374151'}}>
              <Paperclip size={11}/>{f.name} ({(f.size/1024).toFixed(0)}KB)
              <button onClick={()=>setAttachments(prev=>prev.filter((_,j)=>j!==i))}
                style={{background:'none',border:'none',cursor:'pointer',padding:0,color:'#94a3b8'}}>
                <X size={10}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{padding:'10px 16px',borderTop:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:'8px',flexShrink:0,background:'#fafafa'}}>
        <button onClick={handleSend} disabled={sending||!to}
          style={{display:'flex',alignItems:'center',gap:'7px',padding:'9px 22px',
            background:(sending||!to)?'#94a3b8':'#1e40af',color:'white',border:'none',
            borderRadius:'8px',fontSize:'13px',fontWeight:'700',
            cursor:(sending||!to)?'not-allowed':'pointer',
            boxShadow:(sending||!to)?'none':'0 2px 8px rgba(30,64,175,0.3)'}}>
          {sending?<Loader2 size={14} className="animate-spin"/>:<Send size={14}/>}
          {sending?'Sending...':'Send'}
        </button>
        <button onClick={()=>fileRef.current?.click()} title="Attach files"
          style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 14px',
            border:'1.5px solid #e2e8f0',borderRadius:'8px',background:'white',
            color:'#475569',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
          <Paperclip size={13}/> Attach
        </button>
        <input ref={fileRef} type="file" multiple style={{display:'none'}}
          onChange={e=>setAttachments(prev=>[...prev,...Array.from(e.target.files||[])])}/>
        <button onClick={handleDraft}
          style={{display:'flex',alignItems:'center',gap:'5px',padding:'9px 14px',
            border:'1.5px solid #e2e8f0',borderRadius:'8px',background:'white',
            color:'#475569',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
          <FileText size={13}/> Save Draft
        </button>
        <button onClick={()=>{
          if(bodyRef.current)bodyRef.current.innerHTML='';
          setSubject('');setTo(null);setToInput('');setCc('');setBcc('');
        }} style={{padding:'9px 12px',border:'none',background:'none',color:'#94a3b8',fontSize:'13px',cursor:'pointer'}}>
          Discard
        </button>
        <div style={{marginLeft:'auto',display:'flex',gap:'6px',alignItems:'center'}}>
          {selectedAcc && (
            <span style={{fontSize:'11px',color:'#64748b',background:'#eff6ff',padding:'3px 8px',borderRadius:'6px',border:'1px solid #bfdbfe'}}>
              Sending from: <strong>{selectedAcc.email}</strong>
            </span>
          )}
          <label style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'11px',color:'#64748b',cursor:'pointer'}}>
            <input type='checkbox' checked={readReceipt} onChange={e=>setReadReceipt(e.target.checked)} style={{cursor:'pointer'}}/>
            Read receipt
          </label>
          <span style={{fontSize:'10px',color:'#94a3b8'}}>Ctrl+Enter to send · Sent emails appear in Sent folder</span>
        </div>
      </div>

      <style>{`
        [data-ph]:empty:before{content:attr(data-ph);color:#94a3b8;pointer-events:none;display:block}
        /* User-inserted data tables get borders */
        [contenteditable] table.data-table{border-collapse:collapse;width:100%;margin:8px 0}
        [contenteditable] table.data-table td,[contenteditable] table.data-table th{border:1px solid #cbd5e1;padding:7px 10px;min-width:60px}
        [contenteditable] table.data-table th{background:#f8fafc;font-weight:600}
        /* Signature tables - NO borders at all */
        [data-sig='1']{margin-top:12px}
        [data-sig='1'] *{border:none!important;box-shadow:none!important;background:transparent}
        [data-sig='1'] a{color:inherit!important}
        [data-sig='1'] table td,[data-sig='1'] table th{padding:2px 0!important;min-width:0}
        /* Generic non-class tables also no border */
        [contenteditable] table:not(.data-table) td,[contenteditable] table:not(.data-table) th{border:none}
        [contenteditable] a{color:#1e40af}
        [contenteditable] ul,[contenteditable] ol{padding-left:24px}
        [contenteditable] hr{border:none;border-top:1px solid #e2e8f0;margin:10px 0}
        [contenteditable] img{max-width:100%;cursor:pointer}
        [contenteditable] img:hover{outline:2px solid #3b82f620;outline-offset:2px}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .animate-spin{animation:spin 1s linear infinite}
      `}</style>
    </div>
  );
}

// Table picker widget
function TablePicker({ onInsert }: { onInsert:(r:number,c:number)=>void }) {
  const [show, setShow] = useState(false);
  const [hover, setHover] = useState([0,0]);
  return (
    <div style={{position:'relative'}}>
      <button onMouseDown={e=>{e.preventDefault();setShow(v=>!v);}} title="Insert Table"
        style={{display:'flex',alignItems:'center',gap:'3px',padding:'4px 6px',border:'none',background:'none',cursor:'pointer',borderRadius:'4px',color:'#374151',fontSize:'11px',fontWeight:'600'}}
        onMouseEnter={e=>(e.currentTarget.style.background='#e2e8f0')}
        onMouseLeave={e=>(e.currentTarget.style.background='none')}>
        <Table size={13}/> Table
      </button>
      {show && (
        <div style={{position:'absolute',top:'100%',left:0,background:'white',border:'1px solid #e2e8f0',
          borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:100,padding:'10px'}}>
          <div style={{fontSize:'11px',color:'#64748b',marginBottom:'6px',textAlign:'center'}}>
            {hover[0]}×{hover[1]} table
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(8,18px)',gap:'2px'}}>
            {Array.from({length:8*8},(_,i)=>{
              const r=Math.floor(i/8)+1, cl=(i%8)+1;
              return (
                <div key={i}
                  onMouseEnter={()=>setHover([r,cl])}
                  onMouseDown={(e)=>{e.preventDefault();onInsert(r,cl);setShow(false);}}
                  style={{width:'18px',height:'18px',borderRadius:'2px',cursor:'pointer',
                    background:(r<=hover[0]&&cl<=hover[1])?'#3b82f6':'#f1f5f9',
                    border:'1px solid '+(r<=hover[0]&&cl<=hover[1])?'#2563eb':'#e2e8f0'}}/>
              );
            })}
          </div>
          <div style={{marginTop:'8px',textAlign:'center',fontSize:'10px',color:'#94a3b8'}}>Click to insert</div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN MAILBOX PAGE ────────────────────────────────────────────────────────

function ResumeTag({ tag }: { tag: any }) {
  if (!tag?.detected) return null;
  const colorMap: Record<string,string> = {
    auto_accepted: '#059669',
    needs_review:  '#d97706',
    low_confidence:'#dc2626',
  };
  const color = colorMap[tag.routing] || '#64748b';
  const topSkills = (tag.skills || []).slice(0,2).join(' • ');
  const expLabel = tag.exp ? ' • ' + tag.exp : '';
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:'3px',flexWrap:'wrap',marginTop:'1px'}}>
      <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'4px',
        background:color+'18',color:color,fontWeight:'700',border:'1px solid '+color+'30',whiteSpace:'nowrap'}}>
        Resume
      </span>
      {tag.candidate_name && (
        <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'4px',
          background:'#3b82f618',color:'#1e40af',fontWeight:'600',whiteSpace:'nowrap',
          maxWidth:'110px',overflow:'hidden',textOverflow:'ellipsis'}}>
          {tag.candidate_name}
        </span>
      )}
      {topSkills && (
        <span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'4px',
          background:'#10b98118',color:'#047857',fontWeight:'600',whiteSpace:'nowrap',
          maxWidth:'130px',overflow:'hidden',textOverflow:'ellipsis'}}>
          {topSkills + expLabel}
        </span>
      )}
    </span>
  );
}

export default function MailboxPage() {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [composing, setComposing] = useState(false);
  const [composeInitial, setComposeInitial] = useState<Partial<Draft>>({});
  const [search, setSearch] = useState('');
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [searchFrom, setSearchFrom] = useState('');
  const [searchHasAtt, setSearchHasAtt] = useState(false);
  const [searchDateFrom, setSearchDateFrom] = useState('');
  const [searchDateTo, setSearchDateTo] = useState('');
  const [searchResults, setSearchResults] = useState<any[]|null>(null);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState('');
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [undoToast, setUndoToast] = useState<{msg:string,timer:ReturnType<typeof setTimeout>}|null>(null);
  const [contextMenu, setContextMenu] = useState<{x:number,y:number,msg:any}|null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<string|null>(null);
  const [undoSendData, setUndoSendData] = useState<{timer:any}|null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attPreview, setAttPreview] = useState<{data:string,mime:string,name:string}|null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [toastOk, setToastOk] = useState(true);
  const [hoveredId, setHoveredId] = useState<string|null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulk, setBulk] = useState({stage:'',channel:'email',subject:'',message:''});
  const [sendingBulk, setSendingBulk] = useState(false);
  const [waOk, setWaOk] = useState(false);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingBody, setLoadingBody] = useState(false);
  const [loadedEmailBody, setLoadedEmailBody] = useState<string>('');
  const [loadedEmailId, setLoadedEmailId] = useState<string>('');
  const [loadedAttachments, setLoadedAttachments] = useState<any[]>([]);
  const [mailAccsCache, setMailAccsCache] = useState<any[]>([]);
  const [threadMap, setThreadMap] = useState<Record<string,Msg[]>>({});
  const [loadingThread, setLoadingThread] = useState(false);
  const [viewMode, setViewMode] = useState<'normal'|'compact'>('normal');
  const [sortBy, setSortBy] = useState<'date'|'from'|'subject'>('date');
  const [filterUnread, setFilterUnread] = useState(false);
  const [replyMode, setReplyMode] = useState(false);
  const [fullView, setFullView] = useState(false);
  const [listWidth, setListWidth] = useState(300);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(300);
  const [replyMsg, setReplyMsg] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const replyBodyRef = useRef<HTMLDivElement>(null);

  const { data: inboxData, refetch: refetchInbox } = useFetch<Msg[]>('/communications/inbox?limit=200');
  const { data: inboxCountData, refetch: refetchCount } = useFetch<any>('/communications/inbox-count');
  useEffect(()=>{ if(inboxCountData?.total) setTotalCount(inboxCountData.total); },[inboxCountData]);
  const prevUnreadRef = useRef(0);
  const { data: sentData, refetch: refetchSent } = useFetch<Msg[]>('/communications/sent?limit=200');
  const { data: archiveData, refetch: refetchArchive } = useFetch<Msg[]>(folder==='archive'?'/communications/archive?limit=200':null);
  const { data: junkData, refetch: refetchJunk } = useFetch<Msg[]>(folder==='junk'?'/communications/junk?limit=200':null);
  const { data: trashData, refetch: refetchTrash } = useFetch<Msg[]>('/communications/trash?limit=200');
  const { data: starredData, refetch: refetchStarred } = useFetch<Msg[]>('/communications/starred');
  const { data: draftsData, refetch: refetchDrafts } = useFetch<{drafts:Draft[];count:number}>('/communications/drafts');
  const { data: atsInboxData } = useFetch<any>(folder==='ats_inbox'?'/communications/imap-messages?limit=100':null);
  const { data: statsData, refetch: refetchStats } = useFetch<any>('/communications/stats');
  const { data: templates } = useFetch<any[]>('/communications/email-templates');
  const { data: nurture } = useFetch<any[]>('/communications/nurture-sequences');
  const { data: candidates } = useFetch<any>('/candidates?limit=500');
  const { data: mailAccounts } = useFetch<EmailAccount[]>('/user-mail/accounts');

  const candList: any[] = Array.isArray(candidates) ? candidates : (candidates?.items||[]);
  const accounts: EmailAccount[] = mailAccounts || [];

  const showToast = (msg: string, ok=true) => { setToast(msg); setToastOk(ok); setTimeout(()=>setToast(''), 3500); };
  const doAdvancedSearch = async () => {
    if (!search && !searchFrom && !searchHasAtt && !searchDateFrom && !searchDateTo) {
      setSearchResults(null); return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (searchFrom) params.set('from_addr', searchFrom);
      if (searchHasAtt) params.set('has_attachment', 'true');
      if (searchDateFrom) params.set('date_from', searchDateFrom);
      if (searchDateTo) params.set('date_to', searchDateTo);
      const r = await apiFetch('/communications/search?'+params.toString());
      setSearchResults(Array.isArray(r) ? r : []);
    } catch(e) { setSearchResults([]); }
    finally { setSearching(false); }
  };

  const refetchAll = useCallback(()=>{ refetchInbox();refetchSent();refetchTrash();refetchStarred();refetchDrafts();refetchStats();refetchArchive();refetchJunk(); },[]);

  useEffect(()=>{ apiFetch('/communications/whatsapp/status').then(d=>setWaOk(d?.connected&&d?.session?.status==='WORKING')).catch(()=>{}); },[]);

  // Draggable resizer between message list and reading pane
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const newW = Math.max(180, Math.min(520, dragStartWidth.current + delta));
      setListWidth(newW);
    };
    const onUp = () => { isDragging.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);


  // 5-second UI refresh: check DB count for new emails (lightweight)
  // The actual IMAP fetch runs every 60s in the backend (imap_bg.py)
  const [lastKnownCount, setLastKnownCount] = useState(0);
  const [newMailAlert, setNewMailAlert] = useState('');

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const data = await apiFetch('/communications/inbox-count').catch(()=>null);
        if (data?.total) {
          if (lastKnownCount > 0 && data.total > lastKnownCount) {
            const diff = data.total - lastKnownCount;
            setNewMailAlert(diff + ' new email' + (diff>1?'s':'') + ' arrived!');
            setTimeout(()=>setNewMailAlert(''), 5000);
            refetchInbox();
            refetchStats();
            setLastFetched(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
          }
          setLastKnownCount(data.total);
          setTotalCount(data.total);
        }
      } catch {}
    }, 5000); // Check every 5 seconds
    return () => clearInterval(timer);
  }, [lastKnownCount]);


  const getMessages = (): any[] => {
    if (searchResults !== null) return searchResults;
    let msgs: any[] = [];
    if (folder==='inbox') msgs = inboxData||[];
    else if (folder==='sent') msgs = sentData||[];
    else if (folder==='trash') msgs = trashData||[];
    else if (folder==='starred') msgs = starredData||[];
    else if (folder==='drafts') msgs = (draftsData?.drafts)||[];
    else if (folder==='whatsapp') msgs = (inboxData||[]).filter((m:any)=>m.channel==='whatsapp');
    else if (folder==='archive') msgs = (archiveData as any)||[];
    else if (folder==='junk') msgs = (junkData as any)||[];
    else if (folder==='snoozed') msgs = (inboxData||[]).filter((m:any)=>(m as any).snoozed_until&&new Date((m as any).snoozed_until)>new Date());
    else if (folder==='ats_inbox') msgs = (atsInboxData as any)?.messages||[];
    if (filterUnread) msgs = msgs.filter((m:any)=>!m.is_read);
    if (search) {
      const s = search.toLowerCase();
      msgs = msgs.filter((m:any)=>(m.candidate_name||'').toLowerCase().includes(s)||(m.subject||'').toLowerCase().includes(s)||(m.body||'').toLowerCase().includes(s));
    }
    if (sortBy==='from') msgs = [...msgs].sort((a,b)=>(a.candidate_name||'').localeCompare(b.candidate_name||''));
    else if (sortBy==='subject') msgs = [...msgs].sort((a,b)=>(a.subject||'').localeCompare(b.subject||''));
    return msgs;
  };

  const messages = getMessages();


  const counts = statsData?.folder_counts || {};
  const unreadCount = counts.unread || 0;

  // F11: Browser notifications (placed after counts is defined)
  useEffect(()=>{
    const curr = counts.unread || 0;
    if (curr > prevUnreadRef.current && prevUnreadRef.current > 0) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('New email — ATS Mailbox', {body: (curr - prevUnreadRef.current) + ' new email(s)', icon: '/favicon.ico'});
      }
    }
    prevUnreadRef.current = curr;
  }, [counts.unread]);
  useEffect(()=>{
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      setTimeout(()=>Notification.requestPermission(), 3000);
    }
  }, []);

  // Group by date
  const grouped: Record<string, any[]> = {};
  messages.forEach(m=>{
    const g = fmtGroup(m.updated_at||m.created_at||'');
    if (!grouped[g]) grouped[g]=[];
    grouped[g].push(m);
  });

  const selectedMsg = folder!=='drafts' ? messages.find((m:any)=>m.id===selectedId) as Msg|undefined : undefined;
  const currentThread = selectedMsg?.candidate_id ? threadMap[selectedMsg.candidate_id] : undefined;
  // Auto-fetch email body from IMAP when opening inbound email
  useEffect(() => {
    const uid = (selectedMsg as any)?.imap_uid;
    const folder = (selectedMsg as any)?.imap_folder;
    // Load body for any IMAP message (inbound OR sent) that has an imap_uid
    if (!selectedMsg || !uid || !folder) {
      // For non-IMAP messages (ATS outbound), body is inline
      if (selectedMsg && !uid) { setLoadedEmailBody(''); setLoadedEmailId(''); }
      return;
    }
    setLoadingBody(true);
    setLoadedEmailBody('');
    setLoadedAttachments([]);
    // Get IMAP accounts from cache or fetch
    const doFetch = async (accs: any[]) => {
      const acc = accs.find((a:any) => a.imap_host);
      if (!acc) { setLoadingBody(false); return; }
      try {
        const folderEnc = encodeURIComponent(folder);
        const bd = await apiFetch('/user-mail/message-body/'+acc.id+'/'+folderEnc+'/'+uid);
        const body = bd?.html_body || bd?.body || '';
        setLoadedEmailBody(body);
        setLoadedEmailId(selectedMsg.id);
        setLoadedAttachments(bd?.attachments || []);
      } catch(e) {
        console.error('Body fetch error:', e);
      } finally {
        setLoadingBody(false);
      }
    };
    if (mailAccsCache.length > 0) {
      doFetch(mailAccsCache);
    } else {
      apiFetch('/user-mail/accounts').then(accs => {
        setMailAccsCache(accs || []);
        doFetch(accs || []);
      }).catch(() => setLoadingBody(false));
    }
  }, [selectedMsg?.id]);


  // F14: Close context menu on click outside
  useEffect(()=>{
    const handler = () => setContextMenu(null);
    if (contextMenu) document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  // Scroll selected email into view when exiting full view
  useEffect(() => {
    if (!fullView && selectedId) {
      setTimeout(() => {
        const el = document.querySelector('[data-msgid="'+selectedId+'"]');
        if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 100);
    }
  }, [fullView]);

  // Keyboard shortcuts: j=next, k=prev, r=reply, d=delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLDivElement && (e.target as any).contentEditable==='true') return;
      const idx = messages.findIndex((m:any)=>m.id===selectedId);
      if (e.key==='j' || e.key==='ArrowDown') { // Next email
        if (idx < messages.length-1) selectMsg(messages[idx+1] as any);
      } else if (e.key==='k' || e.key==='ArrowUp') { // Prev email
        if (idx > 0) selectMsg(messages[idx-1] as any);
      } else if (e.key==='r' && !e.ctrlKey && !e.metaKey && selectedMsg) { // Reply
        setReplyMode(v=>!v);
      } else if ((e.key==='Delete' || e.key==='d') && selectedMsg && folder!=='trash') { // Delete
        handleTrash(selectedMsg.id, selectedMsg.direction);
      } else if (e.key==='c' && !e.ctrlKey) { // Compose
        setComposing(true); setComposeInitial({});
      } else if (e.key==='f' && !e.ctrlKey && !e.metaKey && selectedMsg && !composing) {
        setFullView(v=>!v);
      } else if (e.key==='?' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { setShowShortcuts(v=>!v); }
      else if (e.key==='Escape') { // Close compose/reply
        if (composing) { setComposing(false); setComposeInitial({}); }
        if (replyMode) setReplyMode(false);
        if (fullView) setFullView(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, messages, selectedMsg, folder, composing, replyMode]);


  const selectMsg = async (msg: Msg) => {
    setSelectedId(msg.id); setComposing(false); setReplyMode(false);
    if (folder==='inbox' && msg.candidate_id && !threadMap[msg.candidate_id]) {
      setLoadingThread(true);
      try {
        const r = await apiFetch('/communications/thread/'+msg.candidate_id);
        setThreadMap(prev=>({...prev,[msg.candidate_id]:r.messages}));
        refetchInbox();
      } catch {}
      setLoadingThread(false);
    }
    if (!msg.is_read) {
      const readEp = msg.direction==='inbound' ? '/communications/imap/'+msg.id+'/read' : '/communications/messages/'+msg.id+'/read';
      await apiFetch(readEp,{method:'PATCH'}).catch(()=>{});
      refetchInbox();
    }
  };

  const handleSend = async (data: any) => {
    const r = await apiFetch('/communications/send',{method:'POST',body:JSON.stringify(data)});
    setComposing(false); setComposeInitial({});
    refetchAll();
    // F8: Show undo toast (note: email already sent - undo is visual only here)
    const timer = setTimeout(() => setUndoToast(null), 5000);
    setUndoToast({msg: 'Email sent ✓', timer});
  };
  const handleDraft = async (data: any) => {
    await apiFetch('/communications/drafts',{method:'POST',body:JSON.stringify(data)});
    showToast('Draft saved'); refetchDrafts(); refetchStats();
  };
  const handleTrash = async (id: string, dir?: string) => {
    const ep = dir==='inbound' ? '/communications/imap/'+id+'/trash' : '/communications/messages/'+id+'/trash';
    await apiFetch(ep,{method:'PATCH'});
    showToast('Moved to Trash'); if(selectedId===id)setSelectedId(null); refetchAll();
  };
  const handleRestore = async (id: string) => {
    await apiFetch('/communications/messages/'+id+'/restore',{method:'PATCH'});
    showToast('Restored'); if(selectedId===id)setSelectedId(null); refetchTrash();refetchInbox();refetchStats();
  };
  const handleDeletePerm = async (id: string) => {
    if(!confirm('Permanently delete?'))return;
    await apiFetch('/communications/messages/'+id,{method:'DELETE'});
    showToast('Deleted permanently'); if(selectedId===id)setSelectedId(null); refetchTrash();refetchStats();
  };
  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    try {
      await apiFetch('/communications/mark-all-read', {method:'POST', body:JSON.stringify({folder})});
      refetchAll(); showToast('All marked as read');
    } catch(e:any){ showToast('Failed: '+e.message, false); }
    finally { setMarkingAllRead(false); }
  };

  const handleSnooze = async (msgId: string, until: Date) => {
    try {
      const isImap = !!(messages.find((m:any)=>m.id===msgId) as any)?.imap_uid;
      if (isImap) {
        await apiFetch('/communications/imap/'+msgId+'/snooze', {method:'POST', body:JSON.stringify({until:until.toISOString()})});
      }
      setSnoozeTarget(null); refetchAll(); showToast('Snoozed until '+until.toLocaleString());
    } catch(e:any){ showToast('Snooze failed: '+e.message, false); }
  };

  const handleStar = async (msg: Msg) => {
    const isIn = msg.direction==='inbound';
    const ep = isIn ? '/communications/imap/'+msg.id+'/star' : '/communications/messages/'+msg.id+'/star';
    const r = await apiFetch(ep,{method:'PATCH'});
    showToast(r.starred?'Starred':'Unstarred'); refetchAll();
  };
  const handleMarkUnread = async (id: string) => {
    await apiFetch('/communications/messages/'+id+'/unread',{method:'PATCH'});
    showToast('Marked unread'); refetchAll();
  };

  const sendQuickReply = async () => {
    if (!replyBodyRef.current?.innerHTML.trim() || !selectedMsg) return;
    setSendingReply(true);
    try {
      await apiFetch('/communications/send',{method:'POST',body:JSON.stringify({
        candidate_id:selectedMsg.candidate_id||undefined,
        to_email:selectedMsg.candidate_id?undefined:selectedMsg.email,
        channel:selectedMsg.channel,
        subject:'Re: '+(selectedMsg.subject||''),
        message:replyBodyRef.current.innerHTML
      })});
      showToast('Reply sent!'); setReplyMode(false);
      if(replyBodyRef.current)replyBodyRef.current.innerHTML='';
      refetchAll();
    } catch(e:any){showToast('Failed: '+e.message,false);}
    finally{setSendingReply(false);}
  };

  const STAGES = ['sourced','contacted','interested','nda','screened','submitted','l1_interview','l2_interview','offer','offer_accepted','placed','rejected','hold'];
  const fetchNowImap = async (fullSync?: boolean) => {
    setFetchingImap(true);
    setSyncProgress('Connecting to mailbox...');
    try {
      const accs = await apiFetch('/user-mail/accounts');
      const imapAccs = (accs||[]).filter((a:any)=>a.imap_host);
      if (!imapAccs.length) {
        showToast('No IMAP email configured. Go to Settings > My Email Accounts.', false);
        return;
      }
      let totalFetched = 0, totalInMailbox = 0;
      for (const acc of imapAccs) {
        setSyncProgress('Discovering folders for ' + acc.email + '...');
        await apiFetch('/user-mail/accounts/'+acc.id+'/folders').catch(()=>{});
        setSyncProgress('Syncing all emails from ' + acc.email + '...');
        try {
          const url = '/user-mail/accounts/'+acc.id+'/fetch-inbox?limit=0' + (fullSync ? '&full_sync=true' : '');
          const r = await apiFetch(url, {method:'POST'});
          totalFetched += (r.fetched || 0);
          totalInMailbox += (r.total_in_mailbox || 0);
          const folderNames = Object.keys(r.folder_counts || {});
          if (folderNames.length > 0) {
            setSyncProgress('Synced: ' + folderNames.join(', ') + ' — ' + totalFetched + ' new emails');
          }
        } catch(e:any) {
          setSyncProgress('Error: ' + e.message);
        }
      }
      setLastFetched(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
      const msg = totalFetched > 0
        ? ('Synced ' + totalFetched + ' new emails (' + totalInMailbox + ' total in mailbox)')
        : 'Inbox is up to date';
      showToast(msg);
      refetchAll();
    } catch(e:any) {
      showToast('Sync failed: ' + e.message, false);
    } finally {
      setFetchingImap(false);
      setSyncProgress('');
    }
  };


  const handleBulk = async () => {
    if(!bulk.stage||!bulk.message.trim())return;
    setSendingBulk(true);
    try {
      const r=await apiFetch('/communications/bulk-send',{method:'POST',body:JSON.stringify({stage:bulk.stage,channel:bulk.channel,subject:bulk.subject||undefined,message:bulk.message})});
      showToast('Campaign: '+r.sent+' sent'); setShowBulk(false); setBulk({stage:'',channel:'email',subject:'',message:''}); refetchAll();
    } catch(e:any){showToast('Failed: '+e.message,false);} finally{setSendingBulk(false);}
  };

  const FOLDERS: [Folder,any,string,number|undefined,boolean?][] = [
    ['inbox', Inbox, 'Inbox', unreadCount>0?unreadCount:undefined, unreadCount>0],
    ['sent', Send, 'Sent', counts.sent],
    ['drafts', FileText, 'Drafts', counts.drafts],
    ['starred', Star, 'Starred', counts.starred],
    ['ats_inbox', Inbox, 'ATS Resume Inbox', (atsInboxData as any)?.unread||undefined, ((atsInboxData as any)?.unread||0)>0],
    ['archive', Archive, 'Archive', undefined],
    ['junk', ShieldOff, 'Junk / Spam', undefined],
    ['snoozed', Clock, 'Snoozed', undefined],
    ['trash', Trash2, 'Trash', counts.trash],
  ];

  return (
    <div style={{display:'flex',height:'calc(100vh - 64px)',background:'#f1f5f9',overflow:'hidden'}}>
      {newMailAlert && (
        <div style={{position:'fixed',top:'70px',right:'24px',zIndex:9999,
          background:'linear-gradient(135deg,#1e40af,#3b82f6)',color:'white',
          padding:'10px 18px',borderRadius:'10px',fontSize:'13px',
          boxShadow:'0 8px 30px rgba(30,64,175,0.4)',display:'flex',alignItems:'center',gap:'8px',
          animation:'slideIn 0.3s ease'}}>
          <span style={{fontSize:'16px'}}>📬</span>
          {newMailAlert}
          <button onClick={()=>setNewMailAlert('')} style={{background:'none',border:'none',cursor:'pointer',color:'rgba(255,255,255,0.7)',marginLeft:'4px'}}>
            <X size={12}/>
          </button>
        </div>
      )}
      {toast && (
        <div style={{position:'fixed',top:'80px',right:'24px',zIndex:9999,
          background:toastOk?'#1e293b':'#dc2626',color:'white',padding:'10px 18px',
          borderRadius:'10px',fontSize:'13px',maxWidth:'380px',
          boxShadow:'0 8px 30px rgba(0,0,0,0.25)',display:'flex',alignItems:'center',gap:'8px'}}>
          {toastOk?<CheckCircle size={14} color="#22c55e"/>:<AlertCircle size={14} color="#fca5a5"/>}
          {toast}
        </div>
      )}
      {undoToast && (
        <div style={{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',zIndex:9999,
          background:'#1e293b',color:'white',padding:'12px 20px',borderRadius:'10px',fontSize:'13px',
          boxShadow:'0 8px 30px rgba(0,0,0,0.3)',display:'flex',alignItems:'center',gap:'12px'}}>
          <CheckCircle size={14} color="#22c55e"/>
          {undoToast.msg}
          <button onClick={()=>{clearTimeout(undoToast.timer);setUndoToast(null);handleUndoSend();}}
            style={{padding:'4px 12px',background:'rgba(255,255,255,0.15)',border:'1px solid rgba(255,255,255,0.3)',borderRadius:'6px',color:'white',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
            Undo
          </button>
        </div>
      )}

      {/* ── SIDEBAR ── */}
      {!fullView && <div style={{width:'195px',flexShrink:0,background:'white',borderRight:'1px solid #e2e8f0',display:'flex',flexDirection:'column',overflowY:'auto'}}>
        <div style={{padding:'12px 12px 8px'}}>
          <button onClick={()=>{setComposing(true);setComposeInitial({});setSelectedId(null);setReplyMode(false);}}
            style={{display:'flex',alignItems:'center',gap:'8px',width:'100%',padding:'10px 14px',
              background:'linear-gradient(135deg,#1e40af,#3b82f6)',color:'white',border:'none',
              borderRadius:'10px',fontSize:'13px',fontWeight:'700',cursor:'pointer',
              boxShadow:'0 3px 12px rgba(30,64,175,0.35)'}}>
            <PenSquare size={14}/> Compose
          </button>
        </div>
        <nav style={{padding:'4px 8px'}}>
          {FOLDERS.map(([key,Icon,label,cnt,hasUnread])=>(
            <button key={key} onClick={()=>{setFolder(key);setSelectedId(null);setComposing(false);setReplyMode(false);setSearchResults(null);setSearch('');}}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',
                padding:'7px 10px',borderRadius:'8px',border:'none',
                background:folder===key?'#eff6ff':'transparent',cursor:'pointer',marginBottom:'1px',
                color:folder===key?'#1e40af':'#374151'}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                <Icon size={14} color={folder===key?'#1e40af':'#64748b'}/>
                <span style={{fontSize:'13px',fontWeight:folder===key?'700':'500'}}>{label}</span>
                {hasUnread&&<span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#3b82f6'}}/>}
              </div>
              {cnt&&cnt>0&&<span style={{fontSize:'10px',fontWeight:'700',background:folder===key?'#1e40af':'#e2e8f0',color:folder===key?'white':'#64748b',borderRadius:'10px',padding:'1px 6px'}}>{cnt}</span>}
            </button>
          ))}
        </nav>
        <div style={{height:'1px',background:'#f1f5f9',margin:'6px 12px'}}/>
        <div style={{padding:'4px 8px'}}>
          <button onClick={()=>{setFolder('whatsapp');setSelectedId(null);setComposing(false);}}
            style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'7px 10px',borderRadius:'8px',border:'none',background:folder==='whatsapp'?'#f0fdf4':'transparent',cursor:'pointer',color:folder==='whatsapp'?'#16a34a':'#374151',marginBottom:'4px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <MessageCircle size={14} color={folder==='whatsapp'?'#16a34a':'#64748b'}/>
              <span style={{fontSize:'13px',fontWeight:folder==='whatsapp'?'700':'500'}}>WhatsApp</span>
            </div>
            {(counts.whatsapp||0)>0&&<span style={{fontSize:'10px',fontWeight:'700',background:'#22c55e',color:'white',borderRadius:'10px',padding:'1px 6px'}}>{counts.whatsapp}</span>}
          </button>
          <div style={{padding:'3px 10px 5px'}}>
            {waOk?(<div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'10px',color:'#16a34a'}}><Wifi size={10}/> Connected</div>
            ):(<button onClick={async()=>{await apiFetch('/communications/whatsapp/start-session',{method:'POST'});}} style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'10px',color:'#d97706',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:'4px',padding:'3px 7px',cursor:'pointer',width:'100%'}}><WifiOff size={9}/> Connect WA</button>)}
          </div>
          <button onClick={()=>setShowBulk(true)}
            style={{display:'flex',alignItems:'center',gap:'8px',width:'100%',padding:'7px 10px',borderRadius:'8px',border:'none',background:'transparent',cursor:'pointer',color:'#374151'}}>
            <Zap size={14} color="#64748b"/><span style={{fontSize:'13px',fontWeight:'500'}}>Bulk Campaign</span>
          </button>
        </div>
        {(nurture||[]).length>0&&(<>
          <div style={{height:'1px',background:'#f1f5f9',margin:'6px 12px'}}/>
          <div style={{padding:'4px 10px 8px'}}>
            <div style={{fontSize:'10px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'4px',paddingLeft:'10px'}}>Nurture</div>
            {(nurture||[]).map((n:any)=>(<div key={n.id} style={{display:'flex',alignItems:'center',gap:'6px',padding:'5px 10px',fontSize:'12px',color:'#374151',cursor:'pointer'}}><span style={{color:'#22c55e'}}>✦</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{n.name}</span></div>))}
          </div>
        </>)}
        {/* My email accounts summary */}
        {accounts.length>0&&(
          <div style={{margin:'8px 10px',padding:'8px 10px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:'10px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'6px'}}>Sending From</div>
            {accounts.slice(0,2).map(a=>(
              <div key={a.id} style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'4px'}}>
                <div style={{width:'20px',height:'20px',borderRadius:'4px',background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:'800',color:'#1e40af'}}>{a.provider[0].toUpperCase()}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:'10px',fontWeight:'600',color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.email}</div>
                  {a.is_default&&<div style={{fontSize:'9px',color:'#16a34a'}}>✓ Default</div>}
                </div>
              </div>
            ))}
            <a href="/settings/mail-accounts" style={{fontSize:'10px',color:'#1e40af',textDecoration:'none',display:'block',marginTop:'4px'}}>Manage accounts →</a>
          </div>
        )}
      </div>

}
      {/* ── MESSAGE LIST ── */}
      {!fullView && <div ref={listRef} style={{width:listWidth+'px',flexShrink:0,background:'white',borderRight:'none',display:'flex',flexDirection:'column'}}>
        {/* List toolbar */}
        <div style={{padding:'10px 12px',borderBottom:'1px solid #e2e8f0',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
            <span style={{fontSize:'14px',fontWeight:'800',color:'#0f172a',textTransform:'capitalize'}}>
              {folder==='whatsapp'?'WhatsApp':folder}
              <span style={{fontSize:'11px',fontWeight:'500',color:'#94a3b8',marginLeft:'6px'}}>({messages.length})</span>
              {unreadCount>0&&folder==='inbox'&&<span style={{marginLeft:'6px',fontSize:'11px',fontWeight:'700',background:'#3b82f6',color:'white',borderRadius:'10px',padding:'1px 6px'}}>{unreadCount} new</span>}
            </span>
            <div style={{display:'flex',gap:'4px'}}>
              <button onClick={()=>setFilterUnread(v=>!v)} title="Show unread only"
                style={{padding:'4px 6px',border:'1px solid '+(filterUnread?'#3b82f6':'#e2e8f0'),borderRadius:'5px',background:filterUnread?'#eff6ff':'white',cursor:'pointer',fontSize:'10px',color:filterUnread?'#1e40af':'#64748b'}}>
                Unread
              </button>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)}
                style={{padding:'4px',border:'1px solid #e2e8f0',borderRadius:'5px',fontSize:'10px',color:'#64748b',cursor:'pointer'}}>
                <option value="date">By Date</option>
                <option value="from">By From</option>
                <option value="subject">By Subject</option>
              </select>
              <div style={{display:'flex',gap:'4px'}}>
                <button onClick={async()=>{
                  // Mark all ATS messages as read
                  const unreadMsgs = messages.filter((m:any)=>!m.is_read);
                  await Promise.all(unreadMsgs.map((m:any)=>{
                    const ep = m.direction==='inbound' ? '/communications/imap/'+m.id+'/read' : '/communications/messages/'+m.id+'/read';
                    return apiFetch(ep,{method:'PATCH'}).catch(()=>{});
                  }));
                  refetchAll();
                  showToast('Marked all as read');
                }} title="Mark all as read"
                  style={{padding:'4px 8px',border:'1px solid #e2e8f0',borderRadius:'5px',background:'white',cursor:'pointer',fontSize:'10px',color:'#64748b',fontWeight:'600'}}>
                  All Read
                </button>
                <button onClick={refetchAll} style={{padding:'4px',border:'none',background:'none',cursor:'pointer'}} title="Refresh">
                  <RefreshCw size={12} color="#94a3b8"/>
                </button>

              </div>
            </div>
          </div>
          <div style={{display:'flex',gap:'6px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'7px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:'7px',padding:'6px 10px',flex:1}}>
              <Search size={12} color="#94a3b8"/>
              <input value={search} onChange={e=>{setSearch(e.target.value);if(!e.target.value&&!searchFrom&&!searchHasAtt)setSearchResults(null);}} onKeyDown={e=>{if(e.key==='Enter')doAdvancedSearch();}} placeholder="Search... (Enter to search all)"
                style={{flex:1,border:'none',background:'transparent',outline:'none',fontSize:'12px',color:'#374151'}}/>
              {(search||searchResults!==null)&&<button onClick={()=>{setSearch('');setSearchResults(null);}} style={{background:'none',border:'none',cursor:'pointer',padding:0}}><X size={10} color="#94a3b8"/></button>}
            </div>
            <button onClick={()=>setShowSearchFilters(v=>!v)} title="Advanced search filters"
              style={{padding:'6px 8px',border:'1px solid '+(showSearchFilters?'#1e40af':'#e2e8f0'),borderRadius:'7px',background:showSearchFilters?'#eff6ff':'white',cursor:'pointer',color:showSearchFilters?'#1e40af':'#64748b',flexShrink:0}}>
              <Filter size={13}/>
            </button>
          </div>
        </div>

        {/* Search results banner */}
        {searchResults !== null && (
          <div style={{padding:'6px 14px',background:'#eff6ff',borderBottom:'1px solid #bfdbfe',fontSize:'11px',color:'#1e40af',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
            <span>🔍 {searchResults.length} result(s)</span>
            <button onClick={()=>{setSearchResults(null);setSearch('');}} style={{background:'none',border:'none',cursor:'pointer',color:'#1e40af',fontWeight:'700',fontSize:'12px'}}>Clear</button>
          </div>
        )}
        {/* Grouped message list */}
        <div style={{flex:1,overflowY:'auto'}} onScroll={async e=>{
          const el=e.currentTarget;
          if(el.scrollHeight-el.scrollTop-el.clientHeight<150 && !loadingMore && totalCount>messages.length && folder==='inbox') {
            setLoadingMore(true);
            try {
              const nextOffset = messages.length;
              const more = await apiFetch('/communications/inbox?limit=50&offset='+nextOffset).catch(()=>[]);
              if (more && more.length > 0) {
                // Update inbox data by triggering refetch (simplified approach)
                refetchInbox();
              }
            } finally { setLoadingMore(false); }
          }
        }}>
          {messages.length===0&&(
            <div style={{padding:'40px 16px',textAlign:'center',color:'#94a3b8',fontSize:'12px'}}>
              <Mail size={32} style={{margin:'0 auto 10px',opacity:0.2}}/>
              {folder==='drafts'?'No drafts':folder==='trash'?'Trash is empty':'No messages'}
              {filterUnread&&<div style={{marginTop:'6px',fontSize:'11px'}}>No unread messages</div>}
            </div>
          )}
          {Object.entries(grouped).map(([group, msgs])=>(
            <div key={group}>
              <div style={{padding:'5px 13px 3px',fontSize:'10px',fontWeight:'700',color:'#94a3b8',
                textTransform:'uppercase',letterSpacing:'0.06em',background:'#f8fafc',
                borderBottom:'1px solid #f1f5f9',position:'sticky',top:0}}>
                {group}
              </div>
              {msgs.map((item:any)=>{
                const isSel=selectedId===item.id;
                const isDraft=folder==='drafts';
                const isUnread=!isDraft&&!item.is_read;
                const isHov=hoveredId===item.id;
                const chClr=CH_CLR[item.channel||'email']||'#64748b';
                const preview=item.body?strip(item.body).slice(0,80):'';
                const rowHeight=viewMode==='compact'?'44px':undefined;

                return (
                  <div key={item.id}
                    onDoubleClick={()=>{ if(!isDraft){ selectMsg(item as Msg); setFullView(true); }}}
                    onContextMenu={e=>{ e.preventDefault(); setContextMenu({x:e.clientX,y:e.clientY,msg:item}); }}
                    data-msgid={item.id}
                    onClick={()=>{ if(isDraft){setComposeInitial({candidate_id:item.candidate_id,to_email:item.to_email,channel:item.channel,subject:item.subject,body:item.body,cc:item.cc});setComposing(true);}else{selectMsg(item as Msg);}}}
                    onMouseEnter={()=>setHoveredId(item.id)}
                    onMouseLeave={()=>setHoveredId(null)}
                    style={{padding:viewMode==='compact'?'6px 12px':'10px 13px',cursor:'pointer',
                      borderBottom:'1px solid #f8fafc',minHeight:rowHeight,
                      background:isSel?'#eff6ff':isHov?'#f8fafc':'white',
                      borderLeft:isSel?'3px solid #1e40af':isUnread?'3px solid #3b82f6':'3px solid transparent',
                      position:'relative'}}>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'7px'}}>
                      {!isDraft&&(
                        <button onClick={e=>{e.stopPropagation();handleStar(item);}}
                          style={{background:'none',border:'none',cursor:'pointer',padding:'1px',flexShrink:0,marginTop:'1px'}}>
                          <Star size={11} color={item.is_starred?'#f59e0b':'#e2e8f0'} fill={item.is_starred?'#f59e0b':'none'}/>
                        </button>
                      )}
                      <Avatar name={item.candidate_name||'?'} size={viewMode==='compact'?26:30}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1px'}}>
                          <span style={{fontSize:'12px',fontWeight:isUnread?'800':'600',color:isSel?'#1e40af':'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'130px'}}>
                            {folder==='sent'&&'→ '}{item.candidate_name}
                          </span>
                          <span style={{display:'flex',alignItems:'center',gap:'3px',flexShrink:0,marginLeft:'3px'}}>
                            {(()=>{try{const _a=(item as any).attachments;const _r=Array.isArray(_a)?_a:(typeof _a==='string'&&_a?JSON.parse(_a):[]);return _r&&_r.length>0?<span title={_r.map((x:any)=>x.filename).join(', ')} style={{color:'#64748b',fontSize:'11px'}}>📎</span>:null}catch{return null}})()} 
                            <span style={{fontSize:'10px',color:'#94a3b8'}}>{fmtDate(item.updated_at||item.created_at)}</span>
                          </span>
                        </div>
                        <div style={{fontSize:'12px',fontWeight:isUnread?'700':'500',color:isUnread?'#1e293b':'#374151',
                          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:'1px'}}>
                          {item.subject||'(no subject)'} 
                        </div>
                        {viewMode==='normal'&&(
                          <div style={{fontSize:'11px',color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                            {preview||((item as any).imap_folder==='INBOX.Drafts'?'Unsent draft':'Received email')}
                          </div>
                        )}
                        <div style={{display:'flex',gap:'3px',marginTop:'3px',alignItems:'center'}}>
                          {!isDraft&&<span style={{fontSize:'9px',padding:'1px 4px',borderRadius:'3px',background:chClr+'15',color:chClr,fontWeight:'600',textTransform:'capitalize'}}>{item.channel}</span>}
                          {isDraft&&<span style={{fontSize:'9px',padding:'1px 4px',borderRadius:'3px',background:'#6366f115',color:'#6366f1',fontWeight:'600'}}>Draft</span>}
                          {!isDraft&&item.status&&<span style={{fontSize:'9px',padding:'1px 4px',borderRadius:'3px',background:(ST_CLR[item.status]||'#64748b')+'15',color:ST_CLR[item.status]||'#64748b',fontWeight:'600'}}>{item.status}</span>}
                          {folder==='inbox'&&item.msg_count>1&&<span style={{fontSize:'9px',color:'#64748b',fontWeight:'600'}}>{item.msg_count}</span>}
                          {(item as any).resume_tag?.detected&&<ResumeTag tag={(item as any).resume_tag}/>}
                          {isUnread&&<span style={{fontSize:'9px',padding:'1px 5px',borderRadius:'8px',background:'#3b82f615',color:'#3b82f6',fontWeight:'700'}}>NEW</span>}
                        </div>
                      </div>
                      {/* Hover actions */}
                      {isHov&&!isSel&&!isDraft&&(
                        <div style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',
                          display:'flex',gap:'1px',background:'white',borderRadius:'6px',
                          border:'1px solid #e2e8f0',padding:'2px',boxShadow:'0 2px 8px rgba(0,0,0,0.1)'}}>
                          <button onClick={e=>{e.stopPropagation();handleStar(item);}}
                            style={{padding:'4px',background:'none',border:'none',cursor:'pointer'}} title="Star">
                            <Star size={11} color="#f59e0b"/>
                          </button>
                          {folder!=='trash'&&(
                            <button onClick={e=>{e.stopPropagation();handleTrash(item.id);}}
                              style={{padding:'4px',background:'none',border:'none',cursor:'pointer'}} title="Delete">
                              <Trash2 size={11} color="#ef4444"/>
                            </button>
                          )}
                          {folder==='trash'&&(
                            <button onClick={e=>{e.stopPropagation();handleRestore(item.id);}}
                              style={{padding:'4px',background:'none',border:'none',cursor:'pointer'}} title="Restore">
                              <RotateCcw size={11} color="#16a34a"/>
                            </button>
                          )}
                          <button onClick={e=>{e.stopPropagation();handleMarkUnread(item.id);}}
                            style={{padding:'4px',background:'none',border:'none',cursor:'pointer'}} title="Mark unread">
                            <EyeOff size={11} color="#64748b"/>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalCount > 50 && (
          <div style={{padding:'5px 10px',borderTop:'1px solid #f1f5f9',display:'flex',gap:'4px',background:'#fafafa',justifyContent:'center',alignItems:'center'}}>
            <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
              style={{padding:'4px 10px',border:'1px solid #e2e8f0',borderRadius:'5px',background:'white',cursor:page===0?'not-allowed':'pointer',fontSize:'11px',color:page===0?'#cbd5e1':'#374151',fontWeight:'600'}}>
              Newer
            </button>
            <span style={{fontSize:'10px',color:'#94a3b8'}}>
              {(page*50+1).toLocaleString()}-{Math.min((page+1)*50, totalCount).toLocaleString()} / {totalCount.toLocaleString()}
            </span>
            <button onClick={()=>setPage(p=>p+1)} disabled={(page+1)*50>=totalCount}
              style={{padding:'4px 10px',border:'1px solid #e2e8f0',borderRadius:'5px',background:'white',cursor:(page+1)*50>=totalCount?'not-allowed':'pointer',fontSize:'11px',color:(page+1)*50>=totalCount?'#cbd5e1':'#374151',fontWeight:'600'}}>
              Older
            </button>
          </div>
        )}
        {/* Full view hint */}
        <div style={{padding:'2px 12px',background:'#f8fafc',borderTop:'1px solid #f1f5f9',
          fontSize:'9px',color:'#94a3b8',textAlign:'center',flexShrink:0}}>
          {loadingMore && <span style={{fontSize:'10px',color:'#94a3b8',marginLeft:'auto'}}>Loading...</span>}
          Double-click email to expand • Drag ▶ to resize
        </div>

        {/* View toggle */}
        <div style={{padding:'6px 12px',borderTop:'1px solid #f1f5f9',display:'flex',gap:'6px',alignItems:'center',background:'#fafafa'}}>
          <span style={{fontSize:'10px',color:'#94a3b8'}}>View:</span>
          {(['normal','compact'] as const).map(m=>(
            <button key={m} onClick={()=>setViewMode(m)}
              style={{padding:'2px 8px',borderRadius:'4px',border:'1px solid '+(viewMode===m?'#3b82f6':'#e2e8f0'),
                background:viewMode===m?'#eff6ff':'white',fontSize:'10px',fontWeight:'600',
                color:viewMode===m?'#1e40af':'#64748b',cursor:'pointer',textTransform:'capitalize'}}>
              {m}
            </button>
          ))}
          <span style={{marginLeft:'auto',fontSize:'10px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'8px'}}>
            <span title="Keyboard shortcuts: j=next, k=prev, r=reply, d=delete, c=compose, Esc=close">⌨️</span>
            {messages.length}{totalCount>50?' of '+totalCount.toLocaleString():''} msgs
          </span>
        </div>
      </div>

}
      {/* Standalone drag handle between list and reading pane */}
      {!fullView && (
        <div onMouseDown={e=>{ isDragging.current=true; dragStartX.current=e.clientX; dragStartWidth.current=listWidth; document.body.style.cursor='col-resize'; document.body.style.userSelect='none'; e.preventDefault(); }}
          style={{width:'6px',flexShrink:0,cursor:'col-resize',display:'flex',alignItems:'center',justifyContent:'center',background:'#f1f5f9',zIndex:5}}>
          <div style={{width:'3px',height:'48px',borderRadius:'2px',background:'#94a3b8',opacity:0.8,pointerEvents:'none'}}/>
        </div>
      )}
      {/* ── READING / COMPOSE PANE ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'hidden',borderLeft:'none'}}>
        {composing ? (
          <ComposePane
            key={JSON.stringify(composeInitial)}
            initial={composeInitial}
            candidates={candList}
            templates={templates||[]}
            mailAccounts={accounts}
            onSend={handleSend}
            onDraft={handleDraft}
            onDiscard={()=>{setComposing(false);setComposeInitial({});}}
          />
        ) : loadingThread ? (
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'#94a3b8',gap:'10px'}}>
            <Loader2 size={20} className="animate-spin"/> Loading conversation...
          </div>
        ) : selectedMsg ? (
          <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
            {/* Reading pane header */}
            <div style={{padding:'14px 24px 10px',background:'white',borderBottom:'1px solid #e2e8f0',flexShrink:0}}>
              <div style={{fontSize:'18px',fontWeight:'800',color:'#0f172a',marginBottom:'10px',lineHeight:'1.3'}}>
                {selectedMsg.subject||'(no subject)'}
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px',marginBottom:'10px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <Avatar name={selectedMsg.candidate_name} size={34}/>
                  <div>
                    <div style={{fontSize:'13px',fontWeight:'700',color:'#1e293b'}}>{selectedMsg.direction==='inbound'?((selectedMsg as any).imap_folder==='INBOX.Drafts'?'Draft: ':'From: '):''}{selectedMsg.candidate_name==='Unknown Sender'?((selectedMsg as any).imap_folder==='INBOX.Drafts'?'[Unsent Draft]':(selectedMsg.email||'Unknown Sender')):selectedMsg.candidate_name}</div>
                    <div style={{fontSize:'11px',color:'#64748b'}}>
                      {selectedMsg.email}{selectedMsg.direction==='inbound'&&selectedMsg.sent_by_name?' · Received by '+selectedMsg.sent_by_name:selectedMsg.sent_by_name?' · via '+selectedMsg.sent_by_name:''}
                    </div>
                    {selectedMsg.to_email&&<div style={{fontSize:'11px',color:'#64748b',marginTop:'1px'}}><span style={{color:'#94a3b8'}}>To:</span> {selectedMsg.to_email}</div>}
                    {selectedMsg.cc&&<div style={{fontSize:'11px',color:'#64748b',marginTop:'1px'}}><span style={{color:'#94a3b8'}}>Cc:</span> {selectedMsg.cc}</div>}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'11px',color:'#94a3b8'}}>{fmtDate(selectedMsg.created_at)}</span>
                  <span style={{fontSize:'10px',padding:'2px 7px',borderRadius:'10px',background:(CH_CLR[selectedMsg.channel]||'#64748b')+'15',color:CH_CLR[selectedMsg.channel]||'#64748b',fontWeight:'600'}}>{selectedMsg.channel}</span>
                </div>
              </div>
              {/* Action bar */}
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                {/* Full View toggle in reading pane */}
                <button onClick={()=>setFullView(v=>!v)}
                  title={fullView?'Exit Full View (Esc)':'Full View — expand reading pane (F)'}
                  style={{display:'flex',alignItems:'center',gap:'5px',
                    padding:'6px 14px',
                    background:fullView?'#1e40af':'white',
                    color:fullView?'white':'#374151',
                    border:'1.5px solid '+(fullView?'#1e40af':'#e2e8f0'),
                    borderRadius:'7px',fontSize:'12px',fontWeight:'700',cursor:'pointer',
                    boxShadow:fullView?'0 2px 8px rgba(30,64,175,0.3)':'none'}}>
                  {fullView?<Minimize2 size={13}/>:<Maximize2 size={13}/>}
                  {fullView?'Exit':'Full View'}
                </button>
                {folder!=='trash'&&(<>
                  <button onClick={()=>{setReplyMode(v=>!v);}}
                    style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 14px',background:replyMode?'#1e40af':'white',color:replyMode?'white':'#374151',border:'1.5px solid '+(replyMode?'#1e40af':'#e2e8f0'),borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <Reply size={12}/> Reply
                  </button>
                  {selectedMsg.direction==='inbound'&&(
                    <button onClick={()=>{
                      setComposeInitial({
                        to_email:selectedMsg.email,
                        cc:selectedMsg.cc||'',
                        channel:'email' as any,
                        subject:'Re: '+(selectedMsg.subject||''),
                      });
                      setComposing(true);
                    }} style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                      <Reply size={12}/> Reply All
                    </button>
                  )}
                  <button onClick={()=>{setComposeInitial({subject:'Fwd: '+(selectedMsg.subject||''),body:'<br/><hr style="margin:12px 0"/><p style="color:#64748b;font-size:12px">— Forwarded message —</p>'+selectedMsg.body});setComposing(true);}}
                    style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <Forward size={12}/> Forward
                  </button>
                  <button onClick={()=>handleStar(selectedMsg)}
                    style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid '+(selectedMsg.is_starred?'#f59e0b':'#e2e8f0'),borderRadius:'7px',background:selectedMsg.is_starred?'#fef9c3':'white',color:selectedMsg.is_starred?'#92400e':'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <Star size={12} fill={selectedMsg.is_starred?'#f59e0b':'none'}/> {selectedMsg.is_starred?'Starred':'Star'}
                  </button>
                  <button onClick={()=>handleMarkUnread(selectedMsg.id)}
                    style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <EyeOff size={12}/> Mark Unread
                  </button>
                  <button onClick={()=>setSnoozeTarget(selectedMsg.id)}
                    style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <Clock size={12}/> Snooze
                  </button>
                  {(selectedMsg as any).imap_uid && (
                    <div style={{position:'relative',display:'inline-block'}}>
                      <button onClick={e=>{e.stopPropagation();const el=e.currentTarget.nextElementSibling as HTMLElement;if(el)el.style.display=el.style.display==='none'?'block':'none';}}
                        style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                        <FolderPlus size={12}/> Move to
                      </button>
                      <div style={{display:'none',position:'absolute',top:'100%',right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:200,minWidth:'160px',padding:'4px 0'}}>
                        {['INBOX','INBOX.Sent','INBOX.Outlook.Archive','INBOX.Junk'].map(f=>(
                          <div key={f} onClick={async()=>{
                            await apiFetch('/communications/imap/'+selectedMsg.id+'/move',{method:'POST',body:JSON.stringify({folder:f})}).catch(()=>{});
                            refetchAll(); setSelectedId(null); showToast('Moved to '+f.split('.').pop());
                          }} style={{padding:'8px 14px',cursor:'pointer',fontSize:'12px',color:'#374151'}}
                          onMouseEnter={e=>(e.currentTarget.style.background='#f8fafc')}
                          onMouseLeave={e=>(e.currentTarget.style.background='white')}>
                            {f.split('.').pop()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <button onClick={()=>handleTrash(selectedMsg.id)}
                    style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #fca5a5',borderRadius:'7px',background:'#fff5f5',color:'#dc2626',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <Trash2 size={12}/> Delete
                  </button>
                  <button onClick={()=>{
                    const w=window.open('','_blank');
                    if(!w)return;
                    const printBody = loadedEmailBody || selectedMsg.body || '';
                    w.document.write('<html><head><title>'+selectedMsg.subject+'</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1e293b}h2{margin-bottom:4px;font-size:20px}p.meta{margin:2px 0;font-size:13px;color:#64748b}hr{margin:16px 0;border:none;border-top:1px solid #e2e8f0}.body{margin-top:16px;font-size:14px;line-height:1.75}@media print{body{margin:0}}</style></head><body><h2>'+(selectedMsg.subject||'(no subject)')+'</h2><p class="meta"><strong>From:</strong> '+(selectedMsg.candidate_name||'')+' &lt;'+(selectedMsg.email||'')+'&gt;</p><p class="meta"><strong>To:</strong> '+(selectedMsg.to_email||'')+'</p><p class="meta"><strong>Date:</strong> '+(selectedMsg.created_at?new Date(selectedMsg.created_at).toLocaleString():'')+'</p><hr/><div class="body">'+printBody+'</div></body></html>');
                    w.document.close();
                    setTimeout(()=>w.print(),500);
                  }} style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    <Printer size={12}/> Print
                  </button>
                  {(selectedMsg as any).imap_uid && (
                    <button onClick={async()=>{
                      const uid=(selectedMsg as any).imap_uid;
                      const folder=(selectedMsg as any).imap_folder;
                      if(!uid||!folder)return;
                      const accs2=mailAccsCache.length>0?mailAccsCache:(await apiFetch('/user-mail/accounts').catch(()=>[]));
                      const acc2=(accs2||[]).find((a:any)=>a.imap_host);
                      if(!acc2)return;
                      const r=await apiFetch('/user-mail/eml/'+acc2.id+'/'+encodeURIComponent(folder)+'/'+uid).catch(()=>null);
                      if(r?.data){
                        const b=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));
                        const bl=new Blob([b],{type:'message/rfc822'});
                        const u=URL.createObjectURL(bl);
                        const a=document.createElement('a');
                        a.href=u;a.download=(selectedMsg.subject||'email').replace(/[^a-z0-9\-_]/gi,'_')+'.eml';
                        a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
                      }
                    }} style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #e2e8f0',borderRadius:'7px',background:'white',color:'#374151',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                      <Download size={12}/> .eml
                    </button>
                  )}

                </>)}
                {folder==='trash'&&(<>
                  <button onClick={()=>handleRestore(selectedMsg.id)} style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 14px',background:'#16a34a',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}><RotateCcw size={12}/> Restore</button>
                  <button onClick={()=>handleDeletePerm(selectedMsg.id)} style={{display:'flex',alignItems:'center',gap:'5px',padding:'6px 12px',border:'1.5px solid #fca5a5',borderRadius:'7px',background:'#fff5f5',color:'#dc2626',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}><Trash2 size={12}/> Delete Forever</button>
                </>)}
                {(currentThread||[]).length>1&&(
                  <span style={{marginLeft:'auto',fontSize:'12px',color:'#64748b',padding:'6px 10px',background:'#f8fafc',borderRadius:'7px',border:'1px solid #e2e8f0'}}>
                    {(currentThread||[]).length} messages in thread
                  </span>
                )}
              </div>
            </div>

            {/* Message body */}
            <div style={{flex:1,overflowY:'auto',padding:'20px 24px',background:'#f8fafc',minHeight:0}}>
              {(currentThread||[selectedMsg]).map((m:any,i:number)=>{
                const displayBody = (m.id===selectedMsg?.id && loadedEmailBody) ? loadedEmailBody : (m.body || '');                const isHtml2 = displayBody.includes('<') && displayBody.includes('>');
                const isHtml = displayBody.includes('<')&&displayBody.includes('>');
                return (
                  <div key={m.id||i} style={{marginBottom:'16px'}}>
                    {(currentThread||[]).length>1&&(
                      <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                        <Avatar name={m.sent_by_name||m.candidate_name} size={22}/>
                        <span style={{fontSize:'11px',color:'#64748b',fontWeight:'600'}}>{m.direction==='outbound'?'You ('+m.sent_by_name+')':m.candidate_name}</span>
                        <span style={{fontSize:'10px',color:'#94a3b8'}}>{fmtDate(m.created_at)}</span>
                      </div>
                    )}
                    {/* Attachments above body */}
                    {m.id===selectedMsg?.id && (()=>{try{const _a=(selectedMsg as any).attachments;const _r=Array.isArray(_a)?_a:(typeof _a==='string'&&_a?JSON.parse(_a):[]);return _r&&_r.length>0?(
                      <div style={{marginBottom:'10px',padding:'10px 14px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'10px',maxWidth:'900px'}}>
                        <div style={{fontSize:'11px',fontWeight:'700',color:'#1e40af',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.05em'}}>📎 Attachments ({_r.length})</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
                          {_r.map((att:any,ai:number)=>(
                            <button key={ai} disabled={(window as any)['_attDl'+ai]} onClick={async(e)=>{
                              const btn=e.currentTarget;
                              if((window as any)['_attDl'+ai])return;
                              (window as any)['_attDl'+ai]=true;
                              btn.style.opacity='0.6';
                              const _uid=(selectedMsg as any).imap_uid;
                              const _folder=(selectedMsg as any).imap_folder;
                              if(!_uid||!_folder){(window as any)['_attDl'+ai]=false;btn.style.opacity='1';return;}
                              let _acc=mailAccsCache.find((a:any)=>a.imap_host);
                              if(!_acc){const _accs=await apiFetch('/user-mail/accounts');setMailAccsCache(_accs||[]);_acc=(_accs||[]).find((a:any)=>a.imap_host);}
                              if(!_acc){(window as any)['_attDl'+ai]=false;btn.style.opacity='1';return;}
                              const _fe=encodeURIComponent(_folder);
                              try{
                                const _r2=await apiFetch('/user-mail/attachment/'+_acc.id+'/'+_fe+'/'+_uid+'/'+ai);
                                if(_r2?.data){
                                  // Show preview for images and PDFs, download others
                                  if(_r2.mime_type?.startsWith('image/')||_r2.mime_type==='application/pdf'){
                                    setAttPreview({data:_r2.data,mime:_r2.mime_type,name:_r2.filename||att.filename});
                                  } else {
                                    const _b=Uint8Array.from(atob(_r2.data),c=>c.charCodeAt(0));const _bl=new Blob([_b],{type:_r2.mime_type||'application/octet-stream'});const _u=URL.createObjectURL(_bl);const _el=document.createElement('a');_el.href=_u;_el.download=_r2.filename||att.filename;_el.click();setTimeout(()=>URL.revokeObjectURL(_u),1000);
                                  }
                                }
                              }finally{(window as any)['_attDl'+ai]=false;btn.style.opacity='1';}
                            }} style={{display:'flex',alignItems:'center',gap:'6px',padding:'6px 12px',background:'white',border:'1px solid #bfdbfe',borderRadius:'8px',cursor:'pointer',fontSize:'12px',color:'#1e40af',fontWeight:'600'}}>
                              <span>{att.mime_type?.includes('pdf')?'📄':att.mime_type?.includes('image')?'🖼️':(att.filename?.endsWith('.xlsx')||att.filename?.endsWith('.xls'))?'📊':(att.filename?.endsWith('.pptx')||att.filename?.endsWith('.ppt'))?'📊':(att.filename?.endsWith('.docx')||att.filename?.endsWith('.doc'))?'📝':'📎'}</span>
                              <span style={{maxWidth:'140px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{att.filename}</span>
                              <span style={{fontSize:'10px',color:'#64748b',flexShrink:0,background:'#e0f2fe',padding:'1px 5px',borderRadius:'4px'}}>{att.filename?.split('.').pop()?.toUpperCase()||'FILE'}</span>
                              <span style={{fontSize:'10px',color:'#93c5fd',flexShrink:0}}>{att.size>1048576?(att.size/1048576).toFixed(1)+'MB':att.size>1024?Math.round(att.size/1024)+'KB':att.size+'B'}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ):null}catch{return null}})()}
                    <div style={{background:'white',borderRadius:'10px',padding:'20px 24px',boxShadow:'0 1px 4px rgba(0,0,0,0.06)',maxWidth:'900px'}}>
                      {m.channel==='whatsapp'?(
                        <div style={{background:'#dcf8c6',borderRadius:'10px',padding:'10px 14px',display:'inline-block',maxWidth:'90%',fontSize:'14px',lineHeight:'1.65',color:'#1e293b'}}>{displayBody}</div>
                      ):isHtml?(
                        <div dangerouslySetInnerHTML={{__html:displayBody}} style={{fontSize:'14px',lineHeight:'1.75',color:'#1e293b'}}/>
                      ):(
                        <div style={{fontSize:'14px',lineHeight:'1.75',color:'#1e293b',whiteSpace:'pre-wrap'}}>{displayBody}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Inline quick reply */}

            {(selectedMsg as any)?.imap_uid&&!loadingBody&&!loadedEmailBody&&loadedEmailId===selectedMsg.id&&(selectedMsg as any).imap_folder!=='INBOX.Drafts'&&(
              <div style={{padding:'8px 20px',borderTop:'1px solid #f1f5f9',background:'#fafafa',flexShrink:0,display:'flex',alignItems:'center',gap:'10px'}}>
                <span style={{fontSize:'12px',color:'#94a3b8'}}>Body unavailable — this email may have been moved or deleted on the server.</span>
                <button onClick={()=>{setLoadedEmailId('');setLoadedEmailBody('');}} style={{padding:'4px 12px',background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>Retry</button>
              </div>
            )}
            {replyMode && (
              <div style={{padding:'12px 20px',background:'white',borderTop:'2px solid #1e40af',flexShrink:0}}>
                <div style={{fontSize:'12px',fontWeight:'700',color:'#1e40af',marginBottom:'8px',display:'flex',alignItems:'center',gap:'6px'}}>
                  <Reply size={13}/> Reply to {selectedMsg.candidate_name}
                </div>
                <div ref={replyBodyRef} contentEditable suppressContentEditableWarning
                  data-ph="Write your reply..."
                  style={{minHeight:'80px',maxHeight:'200px',overflowY:'auto',outline:'none',fontSize:'13px',lineHeight:'1.65',color:'#1e293b',border:'1.5px solid #e2e8f0',borderRadius:'8px',padding:'10px 14px',background:'#fafafa'}}/>
                <div style={{display:'flex',gap:'8px',marginTop:'10px',alignItems:'center'}}>
                  <button onClick={sendQuickReply} disabled={sendingReply}
                    style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 18px',background:sendingReply?'#94a3b8':'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:sendingReply?'not-allowed':'pointer'}}>
                    {sendingReply?<Loader2 size={13} className="animate-spin"/>:<Send size={13}/>}
                    {sendingReply?'Sending...':'Send Reply'}
                  </button>
                  <button onClick={()=>{setReplyMode(false);}} style={{padding:'8px 14px',border:'1px solid #e2e8f0',borderRadius:'8px',background:'white',color:'#64748b',fontSize:'13px',cursor:'pointer'}}>Cancel</button>
                  <span style={{fontSize:'11px',color:'#94a3b8',marginLeft:'auto'}}>Ctrl+Enter to send</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#94a3b8',background:'#f8fafc'}}>
            <div style={{width:'80px',height:'80px',borderRadius:'50%',background:'#e2e8f0',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:'16px'}}>
              <Mail size={36} color="#94a3b8"/>
            </div>
            <div style={{fontSize:'16px',fontWeight:'700',marginBottom:'6px',color:'#64748b'}}>Select a message to read</div>
            <div style={{fontSize:'13px',marginBottom:'20px',color:'#94a3b8'}}>or compose a new message</div>
            <button onClick={()=>{setComposing(true);setComposeInitial({});}}
              style={{display:'flex',alignItems:'center',gap:'8px',padding:'11px 24px',background:'#1e40af',color:'white',border:'none',borderRadius:'9px',fontSize:'13px',fontWeight:'700',cursor:'pointer',boxShadow:'0 3px 12px rgba(30,64,175,0.3)'}}>
              <PenSquare size={14}/> Compose Message
            </button>
          </div>
        )}
      </div>

      {/* Bulk modal */}
      {showBulk&&(
        <div onClick={e=>{if(e.target===e.currentTarget)setShowBulk(false);}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
          <div style={{background:'white',borderRadius:'16px',padding:'24px',width:'100%',maxWidth:'520px',boxShadow:'0 25px 60px rgba(0,0,0,0.3)'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'18px'}}>
              <div><div style={{fontSize:'16px',fontWeight:'800',color:'#0f172a'}}>Bulk Campaign</div><div style={{fontSize:'12px',color:'#64748b',marginTop:'3px'}}>Send to all candidates in a stage</div></div>
              <button onClick={()=>setShowBulk(false)} style={{background:'none',border:'none',cursor:'pointer'}}><X size={18} color="#94a3b8"/></button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              <select value={bulk.stage} onChange={e=>setBulk(p=>({...p,stage:e.target.value}))} style={{padding:'9px 12px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',outline:'none',color:'#1e293b'}}>
                <option value="">Select stage...</option>
                {STAGES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g,(c:string)=>c.toUpperCase())}</option>)}
              </select>
              <div style={{display:'flex',gap:'7px'}}>
                {([['email','Email'],['whatsapp','WhatsApp'],['both','Both']] as [string,string][]).map(([v,l])=>(
                  <button key={v} onClick={()=>setBulk(p=>({...p,channel:v}))} style={{flex:1,padding:'8px',border:'1.5px solid '+(bulk.channel===v?'#3b82f6':'#e2e8f0'),borderRadius:'8px',background:bulk.channel===v?'#eff6ff':'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:bulk.channel===v?'#1e40af':'#374151'}}>{l}</button>
                ))}
              </div>
              {(bulk.channel==='email'||bulk.channel==='both')&&<input value={bulk.subject} onChange={e=>setBulk(p=>({...p,subject:e.target.value}))} placeholder="Subject..." style={{padding:'9px 12px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',outline:'none',color:'#1e293b'}}/>}
              <textarea value={bulk.message} onChange={e=>setBulk(p=>({...p,message:e.target.value}))} rows={5} placeholder="Message body..." style={{padding:'10px 12px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',outline:'none',resize:'vertical',fontFamily:'inherit',lineHeight:'1.6',color:'#1e293b'}}/>
              {bulk.stage&&<div style={{padding:'9px 12px',background:'#fef9c3',border:'1px solid #fde68a',borderRadius:'8px',fontSize:'12px',color:'#92400e'}}>Sends to ALL candidates in <strong>{bulk.stage.replace(/_/g,' ')}</strong></div>}
              <div style={{display:'flex',gap:'9px',justifyContent:'flex-end'}}>
                <button onClick={()=>setShowBulk(false)} style={{padding:'9px 18px',border:'1px solid #e2e8f0',borderRadius:'8px',background:'white',color:'#475569',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Cancel</button>
                <button onClick={handleBulk} disabled={sendingBulk||!bulk.stage||!bulk.message.trim()} style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 20px',background:(sendingBulk||!bulk.stage)?'#94a3b8':'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:(sendingBulk||!bulk.stage)?'not-allowed':'pointer'}}>
                  <Zap size={13}/>{sendingBulk?'Sending...':'Send Campaign'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .animate-spin{animation:spin 1s linear infinite}
        [data-ph]:empty:before{content:attr(data-ph);color:#94a3b8;pointer-events:none}
      `}</style>
      {/* ── ATTACHMENT PREVIEW MODAL (F4) ── */}
      {attPreview && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:9999,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'20px'}}
          onClick={()=>setAttPreview(null)}>
          <div style={{background:'white',borderRadius:'12px',overflow:'hidden',maxWidth:'90vw',maxHeight:'90vh',display:'flex',flexDirection:'column',width:'100%'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{padding:'12px 20px',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
              <span style={{fontWeight:'600',fontSize:'14px',color:'#0f172a'}}>{attPreview.name}</span>
              <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                <button onClick={()=>{const b=Uint8Array.from(atob(attPreview.data),c=>c.charCodeAt(0));const bl=new Blob([b],{type:attPreview.mime});const u=URL.createObjectURL(bl);const a=document.createElement('a');a.href=u;a.download=attPreview.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}}
                  style={{padding:'6px 14px',background:'#1e40af',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                  <Download size={12}/> Download
                </button>
                <button onClick={()=>setAttPreview(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'20px',color:'#64748b'}}>×</button>
              </div>
            </div>
            <div style={{flex:1,overflow:'auto',padding:'16px',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',minHeight:'300px'}}>
              {attPreview.mime.startsWith('image/')?(
                <img src={'data:'+attPreview.mime+';base64,'+attPreview.data} alt={attPreview.name} style={{maxWidth:'100%',maxHeight:'70vh',borderRadius:'8px',boxShadow:'0 4px 20px rgba(0,0,0,0.1)'}}/>
              ):attPreview.mime==='application/pdf'?(
                <iframe src={'data:application/pdf;base64,'+attPreview.data} style={{width:'100%',height:'70vh',border:'none',borderRadius:'8px'}} title={attPreview.name}/>
              ):(
                <div style={{textAlign:'center',padding:'40px',color:'#64748b'}}>
                  <div style={{fontSize:'48px',marginBottom:'16px'}}>📄</div>
                  <div style={{fontSize:'16px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>{attPreview.name}</div>
                  <div style={{fontSize:'13px',marginBottom:'20px'}}>{attPreview.mime}</div>
                  <p style={{fontSize:'12px',color:'#94a3b8'}}>Preview not available for this file type.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU ── */}
      {contextMenu && (
        <div style={{position:'fixed',top:contextMenu.y,left:contextMenu.x,background:'white',border:'1px solid #e2e8f0',borderRadius:'10px',boxShadow:'0 8px 30px rgba(0,0,0,0.15)',zIndex:9999,minWidth:'180px',padding:'4px 0',fontSize:'13px'}}
          onClick={e=>e.stopPropagation()}>
          {[
            ['↩ Reply', ()=>{ selectMsg(contextMenu.msg); setReplyMode(true); setContextMenu(null); }],
            ['→ Forward', ()=>{ selectMsg(contextMenu.msg); setComposeInitial({subject:'Fwd: '+(contextMenu.msg.subject||''),body:contextMenu.msg.body}); setComposing(true); setContextMenu(null); }],
            ['★ Star / Unstar', ()=>{ handleStar(contextMenu.msg); setContextMenu(null); }],
            ['✓ Mark Read', async()=>{ await apiFetch('/communications/messages/'+contextMenu.msg.id+'/read',{method:'PATCH'}).catch(()=>{}); refetchAll(); setContextMenu(null); }],
            ['🗑 Delete', ()=>{ handleTrash(contextMenu.msg.id); setContextMenu(null); }],
            ['⏰ Snooze...', ()=>{ setSnoozeTarget(contextMenu.msg.id); setContextMenu(null); }],
          ].map(([label,fn]:any)=>(
            <div key={label as string} onClick={fn}
              style={{padding:'8px 16px',cursor:'pointer',color:'#374151'}}
              onMouseEnter={e=>(e.currentTarget.style.background='#f8fafc')}
              onMouseLeave={e=>(e.currentTarget.style.background='white')}>
              {label as string}
            </div>
          ))}
        </div>
      )}

      {/* ── KEYBOARD SHORTCUTS PANEL (F18) ── */}
      {showShortcuts && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={()=>setShowShortcuts(false)}>
          <div style={{background:'white',borderRadius:'16px',padding:'28px 32px',maxWidth:'520px',width:'90%',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
              <h2 style={{margin:0,fontSize:'18px',fontWeight:'800',color:'#0f172a'}}>⌨️ Keyboard Shortcuts</h2>
              <button onClick={()=>setShowShortcuts(false)} style={{background:'none',border:'none',cursor:'pointer',fontSize:'18px',color:'#94a3b8'}}>×</button>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              {[
                ['j / ↓','Next email'],['k / ↑','Previous email'],
                ['r','Reply'],['f','Full view toggle'],
                ['c','Compose new'],['d','Delete email'],
                ['Esc','Close / Cancel'],['?','Show shortcuts'],
                ['Ctrl+Enter','Send email'],['Ctrl+B','Bold text'],
                ['Ctrl+I','Italic text'],['Ctrl+U','Underline'],
              ].map(([key,desc])=>(
                <div key={key} style={{display:'flex',alignItems:'center',gap:'10px',padding:'6px 0',borderBottom:'1px solid #f1f5f9'}}>
                  <kbd style={{background:'#f1f5f9',border:'1px solid #e2e8f0',borderRadius:'5px',padding:'3px 8px',fontSize:'11px',fontWeight:'700',color:'#374151',fontFamily:'monospace',flexShrink:0}}>{key}</kbd>
                  <span style={{fontSize:'12px',color:'#64748b'}}>{desc}</span>
                </div>
              ))}
            </div>
            <p style={{margin:'16px 0 0',fontSize:'11px',color:'#94a3b8',textAlign:'center'}}>Press ? anytime to toggle this panel</p>
          </div>
        </div>
      )}

      {/* ── SNOOZE MODAL (F7) ── */}
      {snoozeTarget && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}
          onClick={()=>setSnoozeTarget(null)}>
          <div style={{background:'white',borderRadius:'14px',padding:'24px',width:'300px',boxShadow:'0 16px 48px rgba(0,0,0,0.2)'}}
            onClick={e=>e.stopPropagation()}>
            <h3 style={{margin:'0 0 16px',fontSize:'15px',fontWeight:'700',color:'#0f172a'}}>⏰ Snooze until...</h3>
            {[
              ['In 1 hour', ()=>{ const d=new Date(); d.setHours(d.getHours()+1); handleSnooze(snoozeTarget,d); }],
              ['Later today (5pm)', ()=>{ const d=new Date(); d.setHours(17,0,0,0); if(d<new Date())d.setDate(d.getDate()+1); handleSnooze(snoozeTarget,d); }],
              ['Tomorrow morning (9am)', ()=>{ const d=new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); handleSnooze(snoozeTarget,d); }],
              ['Next week (Monday 9am)', ()=>{ const d=new Date(); const day=d.getDay(); d.setDate(d.getDate()+(day===0?1:8-day)); d.setHours(9,0,0,0); handleSnooze(snoozeTarget,d); }],
            ].map(([label,fn]:any)=>(
              <button key={label as string} onClick={fn}
                style={{display:'block',width:'100%',padding:'10px 14px',marginBottom:'6px',border:'1.5px solid #e2e8f0',borderRadius:'8px',background:'white',color:'#374151',fontSize:'13px',fontWeight:'500',cursor:'pointer',textAlign:'left'}}
                onMouseEnter={e=>(e.currentTarget.style.borderColor='#3b82f6')}
                onMouseLeave={e=>(e.currentTarget.style.borderColor='#e2e8f0')}>
                {label as string}
              </button>
            ))}
            <button onClick={()=>setSnoozeTarget(null)} style={{marginTop:'8px',background:'none',border:'none',cursor:'pointer',fontSize:'12px',color:'#94a3b8',width:'100%'}}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── ADVANCED SEARCH PANEL (F5) ── */}
      {showSearchFilters && (
        <div style={{position:'fixed',top:'64px',left:'50%',transform:'translateX(-50%)',background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',boxShadow:'0 16px 48px rgba(0,0,0,0.15)',zIndex:999,padding:'20px',width:'420px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
            <span style={{fontSize:'14px',fontWeight:'700',color:'#0f172a'}}>Advanced Search</span>
            <button onClick={()=>{setShowSearchFilters(false);setSearchResults(null);setSearchFrom('');setSearchHasAtt(false);setSearchDateFrom('');setSearchDateTo('');}} style={{background:'none',border:'none',cursor:'pointer',fontSize:'16px',color:'#94a3b8'}}>×</button>
          </div>
          <div style={{display:'grid',gap:'10px'}}>
            <div>
              <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>KEYWORD (subject/sender)</label>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search emails..." style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div>
              <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>FROM</label>
              <input value={searchFrom} onChange={e=>setSearchFrom(e.target.value)} placeholder="Sender email or name..." style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <div>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>DATE FROM</label>
                <input type="date" value={searchDateFrom} onChange={e=>setSearchDateFrom(e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
              </div>
              <div>
                <label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>DATE TO</label>
                <input type="date" value={searchDateTo} onChange={e=>setSearchDateTo(e.target.value)} style={{width:'100%',padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
              </div>
            </div>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px',color:'#374151'}}>
              <input type="checkbox" checked={searchHasAtt} onChange={e=>setSearchHasAtt(e.target.checked)} style={{width:'16px',height:'16px',cursor:'pointer'}}/>
              Has attachment
            </label>
            <button onClick={()=>{ doAdvancedSearch(); setShowSearchFilters(false); }}
              disabled={searching}
              style={{padding:'10px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
              {searching?'Searching...':'Search'}
            </button>
            {searchResults !== null && (
              <div style={{fontSize:'12px',color:'#64748b',textAlign:'center'}}>
                Found {searchResults.length} result(s)
                <button onClick={()=>{setSearchResults(null);setSearch('');setSearchFrom('');setSearchHasAtt(false);setSearchDateFrom('');setSearchDateTo('');}} style={{marginLeft:'8px',background:'none',border:'none',cursor:'pointer',color:'#1e40af',fontSize:'12px',fontWeight:'600'}}>Clear</button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
