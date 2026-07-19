'use client';
import { useState, useRef, useEffect, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  Mail, Plus, Trash2, CheckCircle, XCircle, Loader2, Settings,
  Wifi, WifiOff, RefreshCw, Star, Eye, EyeOff, ExternalLink, X,
  ChevronDown, Shield, AlertTriangle, Download, Check
} from 'lucide-react';

// ── Provider logos/colors ──────────────────────────────────────────────────────
const PROVIDER_META: Record<string,{color:string;bg:string;logo:string}> = {
  gmail:     { color:'#EA4335', bg:'#FEF2F2', logo:'G' },
  outlook:   { color:'#0078D4', bg:'#EFF6FF', logo:'O' },
  yahoo:     { color:'#6001D2', bg:'#F5F3FF', logo:'Y' },
  hostinger: { color:'#FF5A00', bg:'#FFF7ED', logo:'H' },
  zoho:      { color:'#E41C26', bg:'#FEF2F2', logo:'Z' },
  godaddy:   { color:'#00A700', bg:'#F0FDF4', logo:'GD' },
  custom:    { color:'#475569', bg:'#F8FAFC', logo:'✉' },
};

function ProviderBadge({ provider }: { provider: string }) {
  const m = PROVIDER_META[provider] || PROVIDER_META.custom;
  return (
    <div style={{width:'36px',height:'36px',borderRadius:'8px',background:m.bg,
      border:'1px solid '+m.color+'30',display:'flex',alignItems:'center',
      justifyContent:'center',fontSize:m.logo.length>1?'10px':'16px',
      fontWeight:'800',color:m.color,flexShrink:0}}>
      {m.logo}
    </div>
  );
}

// ── Account form ───────────────────────────────────────────────────────────────
interface AccountFormData {
  provider: string; display_name: string; email: string;
  smtp_host: string; smtp_port: number; smtp_user: string;
  smtp_password: string; smtp_tls: boolean;
  imap_host: string; imap_port: number; imap_user: string;
  imap_password: string; imap_ssl: boolean; is_default: boolean;
}


const DEFAULT_PROVIDERS: Record<string,any> = {
  gmail:     { name:'Gmail',           smtp_host:'smtp.gmail.com',            smtp_port:587, smtp_tls:true, imap_host:'imap.gmail.com',            imap_port:993, imap_ssl:true, note:'Use an App Password (Google Account → Security → App passwords)',         help_url:'https://support.google.com/accounts/answer/185833' },
  outlook:   { name:'Outlook / O365',  smtp_host:'smtp.office365.com',        smtp_port:587, smtp_tls:true, imap_host:'imap-mail.outlook.com',      imap_port:993, imap_ssl:true, note:'Use your Microsoft account email and password',                          help_url:'https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings' },
  yahoo:     { name:'Yahoo Mail',      smtp_host:'smtp.mail.yahoo.com',       smtp_port:587, smtp_tls:true, imap_host:'imap.mail.yahoo.com',        imap_port:993, imap_ssl:true, note:'Generate App Password: Yahoo Security → Manage app passwords',           help_url:'https://help.yahoo.com/kb/generate-third-party-passwords-sln15241.html' },
  hostinger: { name:'Hostinger Mail',  smtp_host:'smtp.hostinger.com',        smtp_port:587, smtp_tls:true, imap_host:'imap.hostinger.com',         imap_port:993, imap_ssl:true, note:'Use your Hostinger email address and hPanel email password',             help_url:'https://support.hostinger.com/en/articles/1583612' },
  zoho:      { name:'Zoho Mail',       smtp_host:'smtp.zoho.in',              smtp_port:587, smtp_tls:true, imap_host:'imap.zoho.in',               imap_port:993, imap_ssl:true, note:'Use your Zoho email and password. Enable IMAP in Zoho settings.',        help_url:'https://www.zoho.com/mail/help/imap-access.html' },
  godaddy:   { name:'GoDaddy',         smtp_host:'smtpout.secureserver.net',  smtp_port:587, smtp_tls:true, imap_host:'imap.secureserver.net',      imap_port:993, imap_ssl:true, note:'Use your GoDaddy Workspace Email credentials',                          help_url:'https://in.godaddy.com/help/server-and-port-settings-7949' },
  custom:    { name:'Custom SMTP/IMAP',smtp_host:'',                          smtp_port:587, smtp_tls:true, imap_host:'',                           imap_port:993, imap_ssl:true, note:'Enter your mail server settings manually',                               help_url:null },
};

function AccountModal({
  initial, providers, onSave, onClose
}: {
  initial?: any; providers: Record<string,any>;
  onSave: (d:AccountFormData)=>Promise<void>; onClose: ()=>void;
}) {
  const _email = initial?.email || '';
  const [form, setForm] = useState<AccountFormData>({
    provider: initial?.provider || 'custom',
    display_name: initial?.display_name || '',
    email: _email,
    smtp_host: initial?.smtp_host || '',
    smtp_port: initial?.smtp_port || 587,
    smtp_user: initial?.smtp_user || _email,
    smtp_password: initial?.smtp_password || '',
    smtp_tls: initial?.smtp_tls ?? true,
    imap_host: initial?.imap_host || '',
    imap_port: initial?.imap_port || 993,
    imap_user: initial?.imap_user || _email,
    imap_password: initial?.imap_password || '',
    imap_ssl: initial?.imap_ssl ?? true,
    is_default: initial?.is_default ?? false,
  });
  const [saving, setSaving] = useState(false);
  useEffect(()=>{ if(sigRef.current && (initial?.signature)) sigRef.current.innerHTML=initial.signature; },[]);
  const [showPw, setShowPw] = useState(false);
  const [showImapPw, setShowImapPw] = useState(false);
  const [tab, setTab] = useState<'smtp'|'imap'|'signature'>('smtp');
  const sigRef = useRef<HTMLDivElement>(null);
  const [sigHtml, setSigHtml] = useState(initial?.signature || '');
  const [sigEnabled, setSigEnabled] = useState(initial?.signature_enabled !== false);

  const setProvider = (p: string) => {
    const preset = providers[p] || {};
    setForm(prev => ({
      ...prev, provider: p,
      smtp_host: preset.smtp_host || prev.smtp_host,
      smtp_port: preset.smtp_port || prev.smtp_port,
      smtp_tls: preset.smtp_tls ?? prev.smtp_tls,
      imap_host: preset.imap_host || prev.imap_host,
      imap_port: preset.imap_port || prev.imap_port,
      imap_ssl: preset.imap_ssl ?? prev.imap_ssl,
    }));
  };

  const fillSmtpFromEmail = (email: string) => {
    setForm(p => ({ ...p, email, smtp_user: email, imap_user: email }));
  };

  const INP: CSSProperties = {
    width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0',
    borderRadius:'8px', fontSize:'13px', outline:'none',
    color:'#1e293b', boxSizing:'border-box', background:'white'
  };

  const preset = providers[form.provider] || {};

  return (
    <div
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:2000,
        display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'560px',
        boxShadow:'0 25px 60px rgba(0,0,0,0.3)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{padding:'20px 24px',borderBottom:'1px solid #e2e8f0',
          display:'flex',alignItems:'center',justifyContent:'space-between',
          position:'sticky',top:0,background:'white',zIndex:1}}>
          <div style={{fontSize:'16px',fontWeight:'800',color:'#0f172a'}}>
            {initial ? 'Edit Email Account' : 'Add Email Account'}
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer'}}>
            <X size={18} color="#94a3b8"/>
          </button>
        </div>

        <div style={{padding:'20px 24px'}}>
          {/* Provider picker */}
          <div style={{marginBottom:'16px'}}>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'8px'}}>
              Mail Provider
            </label>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'8px'}}>
              {Object.entries(providers).map(([key,p]:any)=>(
                <button key={key} onClick={()=>setProvider(key)}
                  style={{padding:'10px 6px',borderRadius:'10px',border:'1.5px solid '+(form.provider===key?(PROVIDER_META[key]?.color||'#3b82f6'):'#e2e8f0'),
                    background:form.provider===key?(PROVIDER_META[key]?.bg||'#eff6ff'):'white',
                    cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:'5px'}}>
                  <ProviderBadge provider={key}/>
                  <span style={{fontSize:'10px',fontWeight:'600',color:form.provider===key?(PROVIDER_META[key]?.color||'#1e40af'):'#374151',textAlign:'center',lineHeight:'1.2'}}>
                    {p.name.split('/')[0].trim()}
                  </span>
                </button>
              ))}
            </div>
            {preset.note && (
              <div style={{marginTop:'10px',padding:'9px 12px',background:'#fef9c3',
                border:'1px solid #fde68a',borderRadius:'8px',fontSize:'12px',color:'#92400e',
                display:'flex',gap:'7px',alignItems:'flex-start'}}>
                <AlertTriangle size={13} style={{flexShrink:0,marginTop:'1px'}}/>
                <span>{preset.note} {preset.help_url && <a href={preset.help_url} target="_blank" rel="noreferrer" style={{color:'#d97706',textDecoration:'underline'}}>Learn more ↗</a>}</span>
              </div>
            )}
          </div>

          {/* Account basics */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'10px'}}>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Your Name</label>
              <input value={form.display_name} onChange={e=>setForm(p=>({...p,display_name:e.target.value}))}
                placeholder="e.g. Rahul Sharma" style={INP}/>
            </div>
            <div>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Email Address</label>
              <input value={form.email} onChange={e=>fillSmtpFromEmail(e.target.value)}
                placeholder="you@company.com" type="email" style={INP}/>
            </div>
          </div>

          {/* Tabs */}
          <div style={{display:'flex',gap:'4px',marginBottom:'12px',marginTop:'16px',
            background:'#f8fafc',borderRadius:'8px',padding:'3px'}}>
            {(['smtp','imap','signature'] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)}
                style={{flex:1,padding:'7px',borderRadius:'6px',border:'none',
                  background:tab===t?'white':'transparent',cursor:'pointer',
                  fontSize:'12px',fontWeight:'700',color:tab===t?'#1e40af':'#64748b',
                  boxShadow:tab===t?'0 1px 4px rgba(0,0,0,0.1)':'none'}}>
                {t==='smtp'?'📤 SMTP (Sending)':t==='imap'?'📥 IMAP (Receiving)':'✍️ Signature'}
              </button>
            ))}
          </div>

          {tab==='smtp' && (
            <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'8px'}}>
                <div>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>SMTP Server</label>
                  <input value={form.smtp_host} onChange={e=>setForm(p=>({...p,smtp_host:e.target.value}))}
                    placeholder="smtp.gmail.com" style={INP}/>
                </div>
                <div>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Port</label>
                  <input value={form.smtp_port} type="number"
                    onChange={e=>setForm(p=>({...p,smtp_port:+e.target.value}))}
                    style={{...INP,width:'75px'}}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Username</label>
                <input value={form.smtp_user} onChange={e=>setForm(p=>({...p,smtp_user:e.target.value}))}
                  placeholder="Usually your email address" style={INP}/>
              </div>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Password / App Password <span style={{fontSize:'10px',fontWeight:'400',color:'#94a3b8'}}>(used for both SMTP & IMAP)</span></label>
                <div style={{position:'relative'}}>
                  <input value={form.smtp_password} type={showPw?'text':'password'} autoComplete="new-password"
                    onChange={e=>{const v=e.target.value;setForm(p=>({...p,smtp_password:v,imap_password:v}));}}
                    placeholder={initial?'Leave blank to keep current':'Enter password'}
                    style={{...INP,paddingRight:'36px'}}/>
                  <button onClick={()=>setShowPw(v=>!v)}
                    style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',
                      background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}>
                    {showPw?<EyeOff size={14}/>:<Eye size={14}/>}
                  </button>
                </div>
              </div>
              {!form.smtp_password && !initial && (
                <div style={{fontSize:'11px',color:'#dc2626',marginTop:'4px'}}>Password required to save account</div>
              )}

              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px',color:'#374151'}}>
                <input type="checkbox" checked={form.smtp_tls} onChange={e=>setForm(p=>({...p,smtp_tls:e.target.checked}))}/>
                Use TLS/STARTTLS encryption (recommended)
              </label>
            </div>
          )}

          {tab==='imap' && (
            <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              <div style={{padding:'9px 12px',background:'#eff6ff',borderRadius:'8px',fontSize:'12px',color:'#1e40af'}}>
                IMAP lets you receive emails directly in your ATS inbox. Configure to see replies from candidates.
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'8px'}}>
                <div>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>IMAP Server</label>
                  <input value={form.imap_host} onChange={e=>setForm(p=>({...p,imap_host:e.target.value}))}
                    placeholder="imap.gmail.com" style={INP}/>
                </div>
                <div>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Port</label>
                  <input value={form.imap_port} type="number"
                    onChange={e=>setForm(p=>({...p,imap_port:+e.target.value}))}
                    style={{...INP,width:'75px'}}/>
                </div>
              </div>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>IMAP Username</label>
                <input value={form.imap_user} onChange={e=>setForm(p=>({...p,imap_user:e.target.value}))}
                  placeholder="Usually same as email" style={INP}/>
              </div>
              <div>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>IMAP Password</label>
                <div style={{position:'relative'}}>
                  <input value={form.imap_password} type={showImapPw?'text':'password'}
                    autoComplete="new-password"
                    onChange={e=>setForm(p=>({...p,imap_password:e.target.value}))}
                    placeholder={initial?'Password saved — click eye icon to view':'Enter IMAP password (same as SMTP)'}
                    style={{...INP,paddingRight:'36px'}}/>
                  <button onClick={()=>setShowImapPw(v=>!v)}
                    style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',
                      background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}>
                    {showImapPw?<EyeOff size={14}/>:<Eye size={14}/>}
                  </button>
                </div>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px',color:'#374151'}}>
                <input type="checkbox" checked={form.imap_ssl} onChange={e=>setForm(p=>({...p,imap_ssl:e.target.checked}))}/>
                Use SSL (port 993) — recommended
              </label>
            </div>
          )}


          {tab==='signature' && (
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              <div style={{padding:'10px 12px',background:'#eff6ff',borderRadius:'8px',fontSize:'12px',color:'#1e40af',lineHeight:'1.6'}}>
                Your signature is auto-appended when composing from this account. It appears below your message with a <code style={{background:'#dbeafe',padding:'1px 5px',borderRadius:'3px'}}>--</code> divider, just like Outlook.
              </div>
              <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer',padding:'10px 12px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
                <div onClick={()=>setSigEnabled(v=>!v)}
                  style={{width:'38px',height:'22px',borderRadius:'11px',background:sigEnabled?'#1e40af':'#e2e8f0',position:'relative',cursor:'pointer',transition:'background 0.2s',flexShrink:0}}>
                  <div style={{position:'absolute',width:'16px',height:'16px',borderRadius:'50%',background:'white',top:'3px',left:sigEnabled?'19px':'3px',transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.2)'}}/>
                </div>
                <span style={{fontSize:'13px',fontWeight:'600',color:'#1e293b'}}>{sigEnabled?'Signature enabled':'Signature disabled'}</span>
              </label>
              <div style={{border:'1px solid #e2e8f0',borderRadius:'10px',overflow:'hidden'}}>
                <div style={{padding:'5px 10px',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',gap:'4px',flexWrap:'wrap'}}>
                  {(['bold','italic','underline'] as const).map(cmd=>(
                    <button key={cmd} onMouseDown={e=>{e.preventDefault();document.execCommand(cmd);sigRef.current?.focus();}}
                      style={{padding:'3px 7px',border:'1px solid #e2e8f0',borderRadius:'4px',background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'700',color:'#374151',textTransform:'capitalize'}}>
                      {cmd[0].toUpperCase()}
                    </button>
                  ))}
                  <div style={{width:'1px',height:'18px',background:'#e2e8f0',margin:'0 3px'}}/>
                  {['#000000','#1e40af','#16a34a','#dc2626','#ea580c','#374151'].map(clr=>(
                    <button key={clr} onMouseDown={e=>{e.preventDefault();document.execCommand('foreColor',false,clr);sigRef.current?.focus();}}
                      style={{width:'16px',height:'16px',borderRadius:'3px',background:clr,border:'1px solid #e2e8f0',cursor:'pointer'}}/>
                  ))}
                  <div style={{width:'1px',height:'18px',background:'#e2e8f0',margin:'0 3px'}}/>
                  <button onMouseDown={e=>{e.preventDefault();const u=prompt('Link URL:');if(u)document.execCommand('createLink',false,u);sigRef.current?.focus();}}
                    style={{padding:'3px 7px',border:'1px solid #e2e8f0',borderRadius:'4px',background:'white',cursor:'pointer',fontSize:'11px',color:'#374151'}}>Link</button>
                  <button onMouseDown={e=>{e.preventDefault();document.execCommand('removeFormat');sigRef.current?.focus();}}
                    style={{padding:'3px 7px',border:'1px solid #e2e8f0',borderRadius:'4px',background:'white',cursor:'pointer',fontSize:'11px',color:'#94a3b8'}}>Clear</button>
                </div>
                <div ref={sigRef} contentEditable suppressContentEditableWarning
                  onInput={e=>setSigHtml((e.target as HTMLDivElement).innerHTML)}
                  data-ph2='Type your signature here — name, title, phone, website...'
                  style={{minHeight:'140px',padding:'14px 16px',outline:'none',fontSize:'13px',lineHeight:'1.75',color:'#1e293b',background:'white'}}/>
              </div>
              <div style={{padding:'12px 14px',background:'#fafafa',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:'11px',fontWeight:'700',color:'#94a3b8',marginBottom:'8px',textTransform:'uppercase'}}>Preview</div>
                <div style={{fontSize:'13px',color:'#94a3b8',marginBottom:'8px'}}>Your email body...</div>
                <div style={{borderTop:'2px solid #e2e8f0',paddingTop:'10px',marginTop:'4px'}}>
                  <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'6px',fontFamily:'monospace'}}>--</div>
                  <div dangerouslySetInnerHTML={{__html:sigHtml||'<span style="color:#94a3b8;font-style:italic">Signature will appear here</span>'}}
                    style={{fontSize:'13px',lineHeight:'1.6'}}/>
                </div>
              </div>
              <div style={{fontSize:'12px',fontWeight:'700',color:'#374151',marginBottom:'2px'}}>Quick templates:</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                {[
                  ['Professional','<b>Your Name</b><br>Job Title | Company<br>email@company.com | +91 98765 43210<br><a href="https://company.com" style="color:#1e40af">company.com</a>'],
                  ['Simple','<b>Your Name</b><br>Job Title | Company'],
                  ['Recruitment','<b>Your Name</b><br>Senior Recruiter - AVIIN Jobs<br>📧 email@aviinjobs.com | 📱 +91 98765 43210<br><i style="color:#64748b;font-size:12px">Connecting Talent with Opportunity</i>'],
                  ['Minimal','Best regards,<br><b>Your Name</b>'],
                ].map(([name,html])=>(
                  <button key={name} onMouseDown={e=>{e.preventDefault();if(sigRef.current){sigRef.current.innerHTML=html;setSigHtml(html);}}}
                    style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',background:'white',cursor:'pointer',fontSize:'11px',color:'#374151',textAlign:'left',fontWeight:'600'}}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Default checkbox */}
          <div style={{marginTop:'14px',padding:'10px 12px',background:'#f8fafc',borderRadius:'8px'}}>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',fontSize:'13px',color:'#374151'}}>
              <input type="checkbox" checked={form.is_default}
                onChange={e=>setForm(p=>({...p,is_default:e.target.checked}))}/>
              <span><strong>Set as default sending account</strong> — emails from the mailbox will use this</span>
            </label>
          </div>
        </div>

        <div style={{padding:'16px 24px',borderTop:'1px solid #e2e8f0',
          display:'flex',gap:'10px',justifyContent:'flex-end',
          position:'sticky',bottom:0,background:'white'}}>
          <button onClick={onClose}
            style={{padding:'9px 18px',border:'1px solid #e2e8f0',borderRadius:'8px',
              background:'white',color:'#475569',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={async()=>{setSaving(true);try{await onSave({...form,signature:sigRef.current?.innerHTML||sigHtml,signature_enabled:sigEnabled});}catch(err:any){alert('Save failed: '+(err?.message||'Check your details'));setSaving(false);}finally{setSaving(false);}}}
            disabled={saving||!form.email||!form.smtp_host||(!initial&&!form.smtp_password)}
            style={{display:'flex',alignItems:'center',gap:'7px',padding:'9px 20px',
              background:saving?'#94a3b8':'#1e40af',color:'white',border:'none',
              borderRadius:'8px',fontSize:'13px',fontWeight:'700',cursor:saving?'not-allowed':'pointer'}}>
            {saving?<Loader2 size={14} className="animate-spin"/>:<CheckCircle size={14}/>}
            {saving?'Saving...':'Save Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MailAccountsPage() {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editAcc, setEditAcc] = useState<any>(null);
  const [verifying, setVerifying] = useState<string|null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string,any>>({});
  const [fetching, setFetching] = useState<string|null>(null);
  const [fetchResult, setFetchResult] = useState<Record<string,any>>({});
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);
  const [deleting, setDeleting] = useState<string|null>(null);

  const { data: accounts, refetch } = useFetch<any[]>('/user-mail/accounts');
  const { data: providers } = useFetch<Record<string,any>>('/user-mail/providers');

  const showToast = (msg: string, ok=true) => {
    setToast(msg); setToastOk(ok);
    setTimeout(()=>setToast(''), 4000);
  };

  const handleSave = async (data: any, id?: string) => {
    try {
      if (id) {
        await apiFetch('/user-mail/accounts/'+id, {method:'PUT',body:JSON.stringify(data)});
        showToast('Account updated successfully!');
      } else {
        await apiFetch('/user-mail/accounts', {method:'POST',body:JSON.stringify(data)});
        showToast('Email account saved! Now click "Test Connection" to verify it works.');
      }
      setShowAdd(false); setEditAcc(null);
      refetch();
    } catch(e:any) {
      showToast('Save failed: '+(e?.message||'Please check your settings'), false);
      throw e;
    }
  };

  const handleVerify = async (id: string) => {
    setVerifying(id);
    try {
      const r = await apiFetch('/user-mail/accounts/'+id+'/verify', {method:'POST'});
      setVerifyResult(prev=>({...prev,[id]:r}));
      showToast(r.smtp?.ok ? 'Connection verified! ✓' : 'Verification failed: '+r.smtp?.error, r.smtp?.ok);
      refetch();
    } catch(e:any){ showToast('Error: '+e.message, false); }
    setVerifying(null);
  };

  const handleFetch = async (id: string) => {
    setFetching(id);
    try {
      const r = await apiFetch('/user-mail/accounts/'+id+'/fetch-inbox', {method:'POST'});
      setFetchResult(prev=>({...prev,[id]:r}));
      showToast('Fetched '+r.fetched+' emails from inbox!');
    } catch(e:any){ showToast('Fetch failed: '+e.message, false); }
    setFetching(null);
  };

  const handleSetDefault = async (id: string) => {
    await apiFetch('/user-mail/accounts/'+id+'/set-default', {method:'PATCH'});
    showToast('Default account updated');
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this email account?')) return;
    setDeleting(id);
    await apiFetch('/user-mail/accounts/'+id, {method:'DELETE'});
    showToast('Account removed');
    setDeleting(null);
    refetch();
  };

  return (
    <>
      {toast && (
        <div style={{position:'fixed',top:'80px',right:'24px',zIndex:9999,
          background:toastOk?'#1e293b':'#dc2626',color:'white',
          padding:'10px 18px',borderRadius:'10px',fontSize:'13px',
          maxWidth:'380px',boxShadow:'0 8px 30px rgba(0,0,0,0.25)',
          display:'flex',alignItems:'center',gap:'8px'}}>
          {toastOk?<CheckCircle size={14} color="#22c55e"/>:<XCircle size={14} color="#fca5a5"/>}
          {toast}
        </div>
      )}

      <div style={{maxWidth:'860px',margin:'0 auto',padding:'28px 24px'}}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px'}}>
          <div>
            <h1 style={{fontSize:'22px',fontWeight:'800',color:'#0f172a',margin:0}}>
          <a href='/conversations'
            style={{display:'inline-flex',alignItems:'center',gap:'6px',marginBottom:'12px',
              padding:'7px 14px',border:'1px solid #e2e8f0',borderRadius:'8px',
              background:'white',color:'#374151',fontSize:'13px',fontWeight:'600',textDecoration:'none',
              cursor:'pointer',boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
            ← Back to Mailbox
          </a>
              My Email Accounts
            </h1>
            <p style={{fontSize:'13px',color:'#64748b',margin:'4px 0 0'}}>
              Connect your personal email to send messages from your own address in the mailbox
            </p>
          </div>
          <button onClick={()=>setShowAdd(true)}
            style={{display:'flex',alignItems:'center',gap:'7px',padding:'10px 18px',
              background:'linear-gradient(135deg,#1e40af,#3b82f6)',color:'white',border:'none',
              borderRadius:'9px',fontSize:'13px',fontWeight:'700',cursor:'pointer',
              boxShadow:'0 3px 12px rgba(30,64,175,0.3)'}}>
            <Plus size={14}/> Add Email Account
          </button>
        </div>

        {/* Info banner */}
        <div style={{padding:'14px 18px',background:'#eff6ff',border:'1px solid #bfdbfe',
          borderRadius:'10px',marginBottom:'20px',display:'flex',gap:'12px',alignItems:'flex-start'}}>
          <Shield size={18} color="#1e40af" style={{flexShrink:0,marginTop:'1px'}}/>
          <div style={{fontSize:'13px',color:'#1e40af',lineHeight:'1.6'}}>
            <strong>How it works:</strong> Each recruiter adds their own Gmail, Outlook, Hostinger, or any SMTP/IMAP email.
            When composing a message in the mailbox, choose your account from the "From" dropdown.
            Emails are sent directly from your address — candidates see your real email, not a shared address.
            IMAP lets you pull received replies directly into your ATS inbox.
          </div>
        </div>

        {/* Account list */}
        {!accounts?.length ? (
          <div style={{textAlign:'center',padding:'48px',background:'white',borderRadius:'12px',
            border:'2px dashed #e2e8f0'}}>
            <Mail size={40} style={{margin:'0 auto 12px',opacity:0.3}}/>
            <div style={{fontSize:'15px',fontWeight:'700',color:'#64748b',marginBottom:'6px'}}>
              No email accounts configured
            </div>
            <div style={{fontSize:'13px',color:'#94a3b8',marginBottom:'20px'}}>
              Add your Gmail, Outlook, or any SMTP email to start sending from your own address
            </div>
            <button onClick={()=>setShowAdd(true)}
              style={{display:'inline-flex',alignItems:'center',gap:'7px',padding:'10px 20px',
                background:'#1e40af',color:'white',border:'none',borderRadius:'8px',
                fontSize:'13px',fontWeight:'700',cursor:'pointer'}}>
              <Plus size={14}/> Add Your First Account
            </button>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
            {(accounts||[]).map((acc:any)=>{
              const vr = verifyResult[acc.id];
              const fr = fetchResult[acc.id];
              const pm = PROVIDER_META[acc.provider] || PROVIDER_META.custom;

              return (
                <div key={acc.id} style={{background:'white',borderRadius:'12px',
                  border:'1.5px solid '+(acc.is_default?'#3b82f6':'#e2e8f0'),
                  boxShadow:'0 1px 4px rgba(0,0,0,0.04)',overflow:'hidden'}}>
                  {acc.is_default && (
                    <div style={{background:'linear-gradient(to right,#3b82f6,#1e40af)',
                      padding:'3px 14px',fontSize:'11px',color:'white',fontWeight:'700',
                      display:'flex',alignItems:'center',gap:'5px'}}>
                      <Star size={10} fill="white"/> DEFAULT SENDING ACCOUNT
                    </div>
                  )}
                  <div style={{padding:'16px 20px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'14px'}}>
                      <ProviderBadge provider={acc.provider}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'3px'}}>
                          <span style={{fontSize:'14px',fontWeight:'800',color:'#0f172a'}}>
                            {acc.display_name}
                          </span>
                          {acc.verified && (
                            <span style={{display:'flex',alignItems:'center',gap:'3px',fontSize:'10px',
                              color:'#16a34a',background:'#f0fdf4',border:'1px solid #bbf7d0',
                              borderRadius:'10px',padding:'1px 7px',fontWeight:'700'}}>
                              <Check size={9}/> Verified
                            </span>
                          )}
                          {!acc.verified && (
                            <span style={{fontSize:'10px',color:'#d97706',background:'#fef9c3',
                              border:'1px solid #fde68a',borderRadius:'10px',padding:'1px 7px',fontWeight:'600'}}>
                              Not verified
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:'13px',color:'#64748b'}}>
                          {acc.email}
                          <span style={{marginLeft:'10px',fontSize:'11px',color:'#94a3b8'}}>
                            SMTP: {acc.smtp_host}:{acc.smtp_port}
                            {acc.imap_host && <> · IMAP: {acc.imap_host}</>}
                          </span>
                        </div>
                        {acc.last_verified_at && (
                          <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>
                            Last verified: {new Date(acc.last_verified_at).toLocaleString('en-IN')}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div style={{display:'flex',gap:'6px',flexShrink:0,flexWrap:'wrap',justifyContent:'flex-end'}}>
                        {!acc.is_default && (
                          <button onClick={()=>handleSetDefault(acc.id)}
                            style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',
                              border:'1px solid #e2e8f0',borderRadius:'7px',background:'white',
                              color:'#374151',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                            <Star size={11}/> Set Default
                          </button>
                        )}
                        <button onClick={()=>handleVerify(acc.id)} disabled={verifying===acc.id}
                          style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',
                            border:'1px solid #e2e8f0',borderRadius:'7px',background:'white',
                            color:'#374151',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                          {verifying===acc.id?<Loader2 size={11} className="animate-spin"/>:<Wifi size={11}/>}
                          {verifying===acc.id?'Testing...':'Test Connection'}
                        </button>
                        {acc.imap_host && (
                          <button onClick={()=>handleFetch(acc.id)} disabled={fetching===acc.id}
                            style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',
                              border:'1px solid #3b82f620',borderRadius:'7px',background:'#eff6ff',
                              color:'#1e40af',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                            {fetching===acc.id?<Loader2 size={11} className="animate-spin"/>:<Download size={11}/>}
                            {fetching===acc.id?'Fetching...':'Fetch Inbox'}
                          </button>
                        )}
                        <button onClick={()=>setEditAcc(acc)}
                          style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',
                            border:'1px solid #e2e8f0',borderRadius:'7px',background:'white',
                            color:'#374151',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                          <Settings size={11}/> Edit
                        </button>
                        <button onClick={()=>handleDelete(acc.id)} disabled={deleting===acc.id}
                          style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',
                            border:'1px solid #fca5a5',borderRadius:'7px',background:'#fff5f5',
                            color:'#dc2626',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>
                          {deleting===acc.id?<Loader2 size={11} className="animate-spin"/>:<Trash2 size={11}/>}
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Verify result */}
                    {vr && (
                      <div style={{marginTop:'12px',display:'flex',gap:'10px',flexWrap:'wrap'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'12px',
                          color:vr.smtp?.ok?'#16a34a':'#dc2626',background:vr.smtp?.ok?'#f0fdf4':'#fff5f5',
                          border:'1px solid '+(vr.smtp?.ok?'#bbf7d0':'#fca5a5'),borderRadius:'6px',padding:'4px 10px'}}>
                          {vr.smtp?.ok?<CheckCircle size={12}/>:<XCircle size={12}/>}
                          SMTP: {vr.smtp?.ok?'Connected':'Failed — '+vr.smtp?.error?.slice(0,50)}
                        </div>
                        {vr.imap && (
                          <div style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'12px',
                            color:vr.imap?.ok?'#16a34a':'#dc2626',background:vr.imap?.ok?'#f0fdf4':'#fff5f5',
                            border:'1px solid '+(vr.imap?.ok?'#bbf7d0':'#fca5a5'),borderRadius:'6px',padding:'4px 10px'}}>
                            {vr.imap?.ok?<CheckCircle size={12}/>:<XCircle size={12}/>}
                            IMAP: {vr.imap?.ok?'Connected':vr.imap?.error?.slice(0,50)||'Not configured'}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Fetch result */}
                    {fr && (
                      <div style={{marginTop:'10px',fontSize:'12px',color:'#1e40af',
                        background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'6px',
                        padding:'6px 12px',display:'flex',alignItems:'center',gap:'6px'}}>
                        <Download size={12}/>
                        Fetched {fr.fetched} new emails from your inbox
                        {fr.errors?.length>0 && <span style={{color:'#d97706'}}> ({fr.errors.length} errors)</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick guide */}
        <div style={{marginTop:'24px',background:'white',borderRadius:'12px',
          border:'1px solid #e2e8f0',padding:'18px 20px'}}>
          <div style={{fontSize:'13px',fontWeight:'700',color:'#0f172a',marginBottom:'12px'}}>
            Quick Setup Guide
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:'12px'}}>
            {[
              ['Gmail','Enable 2-Step Verification → Generate App Password → Use it here','#EA4335'],
              ['Outlook','Use your Microsoft 365 email + password directly','#0078D4'],
              ['Hostinger','Use your hPanel email credentials as-is','#FF5A00'],
              ['Custom','Enter your SMTP host, port, username, password','#475569'],
            ].map(([title,desc,clr])=>(
              <div key={title} style={{padding:'12px',background:'#f8fafc',borderRadius:'8px',
                borderLeft:'3px solid '+clr}}>
                <div style={{fontSize:'12px',fontWeight:'700',color:clr,marginBottom:'4px'}}>{title}</div>
                <div style={{fontSize:'11px',color:'#64748b',lineHeight:'1.5'}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(showAdd||editAcc) && (
        <AccountModal
          key={editAcc?.id || 'new-account'}
          initial={editAcc}
          providers={providers || DEFAULT_PROVIDERS}
          onSave={(d)=>handleSave(d,editAcc?.id)}
          onClose={()=>{setShowAdd(false);setEditAcc(null);}}
        />
      )}
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}.animate-spin{animation:spin 1s linear infinite}
        [data-ph2]:empty:before{content:attr(data-ph2);color:#94a3b8;pointer-events:none;display:block}
        `}</style>
    </>
  );
}
