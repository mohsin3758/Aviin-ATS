'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Mail, Server, Eye, EyeOff, CheckCircle, XCircle, Send, Wifi, AlertTriangle, Save } from 'lucide-react';

const INP: any = { width:'100%', border:'1px solid #e2e8f0', borderRadius:'8px', padding:'10px 12px', fontSize:'13px', outline:'none', color:'#1e293b', background:'white', boxSizing:'border-box' as const };
const CARD: any = { background:'white', borderRadius:'12px', border:'1px solid #e2e8f0', padding:'20px', marginBottom:'16px' };
const LBL: any = { display:'block', fontSize:'12px', fontWeight:'600', color:'#374151', marginBottom:'5px' };

const EMAIL_STAGES = [
  {key:'contacted',label:'Contacted'},
  {key:'interested',label:'Interested'},
  {key:'nda',label:'NDA / Pre-Contract'},
  {key:'screened',label:'Screened'},
  {key:'submitted',label:'Submitted'},
  {key:'l1_interview',label:'L1 Interview'},
  {key:'l2_interview',label:'L2 Interview'},
  {key:'offer',label:'Offer Released'},
  {key:'offer_accepted',label:'Offer Accepted'},
  {key:'placed',label:'Placed'},
  {key:'hold',label:'On Hold'},
  {key:'rejected',label:'Rejected'},
];
const DEFAULT_SUBJS:Record<string,string> = {
  contacted:'AVIIN Jobs - We Have Reviewed Your Profile',
  interested:'AVIIN Jobs - Moving Forward with Your Application',
  nda:'AVIIN Jobs - NDA / Pre-Contract Agreement Required',
  screened:'AVIIN Jobs - Profile Shortlisted',
  submitted:'AVIIN Jobs - Your Profile Has Been Submitted to Client',
  l1_interview:'AVIIN Jobs - L1 Interview Scheduled - Congratulations!',
  l2_interview:'AVIIN Jobs - L2 Final Interview - You Are Almost There!',
  offer:'AVIIN Jobs - Offer in Progress - Congratulations!',
  offer_accepted:'AVIIN Jobs - Offer Accepted - Welcome Aboard!',
  placed:'AVIIN Jobs - Placement Confirmation - Congratulations!',
  hold:'AVIIN Jobs - Application Status Update',
  rejected:'AVIIN Jobs - Update on Your Application',
};
const DEFAULT_MSGS:Record<string,string> = {
  contacted:'We have reviewed your profile and would like to connect with you about an exciting opportunity. Our recruitment team will reach out shortly.',
  interested:'Thank you for your interest! We are moving forward with your application and will be in touch very soon to discuss the next steps.',
  nda:'As part of our process, we require you to review and sign an NDA / Pre-contract agreement. Please respond at your earliest convenience.',
  screened:'Congratulations! Your profile has been shortlisted after our initial screening. Our recruiter will contact you shortly to discuss next steps.',
  submitted:'We are pleased to inform you that your profile has been submitted to our client. We will keep you posted and revert as soon as we receive feedback.',
  l1_interview:'Congratulations! You have been selected for the L1 Interview. Our team will share the interview schedule shortly. Please prepare well. All the best!',
  l2_interview:'Excellent! You have cleared L1 and are selected for the L2 Final Interview. Our team will share the schedule shortly. Congratulations and all the best!',
  offer:'Great news! Our client is preparing an offer for you. Our team will be in touch shortly to discuss the details. Congratulations!',
  offer_accepted:'Congratulations on accepting the offer! Our team will coordinate with you for the documentation and onboarding. Please confirm your joining date.',
  placed:'Congratulations on your successful placement! It has been a pleasure being part of your career journey. Wishing you great success in your new role.',
  hold:'Your application is currently on hold. We appreciate your patience and will update you as soon as there is any movement. Thank you for your understanding.',
  rejected:'Thank you for your interest and the time invested. After careful consideration, we are unable to move forward with your application for this role at this time.',
};

const PRESETS: Record<string, object> = {
  hostinger: { smtp_host:'smtp.hostinger.com', smtp_port:587, smtp_tls:true, imap_host:'imap.hostinger.com', imap_port:993 },
  gmail:     { smtp_host:'smtp.gmail.com',     smtp_port:587, smtp_tls:true, imap_host:'imap.gmail.com',     imap_port:993 },
};

export default function EmailSettingsPage() {
  const { data: saved, refetch } = useFetch<any>('/settings/email');
  const [form, setForm] = useState({
    smtp_host:'', smtp_port:587, smtp_user:'', smtp_password:'',
    smtp_from:'', smtp_from_name:'AVIIN ATS', smtp_tls:true,
    imap_host:'', imap_port:993, imap_user:'', imap_password:'',
    is_active:false,
  });
  const [showPw1, setShowPw1] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [sendResult, setSendResult] = useState<any>(null);
  const [msg, setMsg] = useState<{ text:string; ok:boolean }|null>(null);
  const [notifMode, setNotifMode] = useState<'auto'|'manual'>('manual');
  const [templates, setTemplates] = useState<Record<string, {subject:string;message:string}>>({});
  const [activeStage, setActiveStage] = useState<string>('contacted');
  const [savingTemplates, setSavingTemplates] = useState(false);

  useEffect(() => {
    if (saved?.configured) {
      setForm((f:any) => ({
        ...f,
        smtp_host:      saved.smtp_host      || '',
        smtp_port:      saved.smtp_port      || 587,
        smtp_user:      saved.smtp_user      || '',
        smtp_password:  saved.smtp_password  || '',
        smtp_from:      saved.smtp_from      || '',
        smtp_from_name: saved.smtp_from_name || 'AVIIN ATS',
        smtp_tls:       saved.smtp_tls       ?? true,
        imap_host:      saved.imap_host      || '',
        imap_port:      saved.imap_port      || 993,
        imap_user:      saved.imap_user      || '',
        imap_password:  saved.imap_password  || '',
        is_active:      saved.is_active      || false,
      }));
      if (saved.notification_mode) setNotifMode(saved.notification_mode as 'auto'|'manual');
      if (saved.stage_templates && typeof saved.stage_templates === 'object') {
        setTemplates(saved.stage_templates);
      }
    }
  }, [saved]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f: any) => ({ ...f, [k]: e.target.type === 'number' ? +e.target.value : e.target.value }));

  const applyPreset = (p: string) => {
    setForm((f: any) => ({ ...f, ...PRESETS[p] }));
    setMsg({ text: (p === 'hostinger' ? 'Hostinger' : 'Gmail') + ' preset applied. Enter your email and password below.', ok: true });
  };

  const save = async () => {
    if (!form.smtp_host || !form.smtp_user || !form.smtp_from) {
      setMsg({ text: 'Please fill SMTP Host, Username and From Email', ok: false });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/settings/email', { method: 'PUT', body: JSON.stringify(form) });
      setMsg({ text: 'Settings saved successfully!', ok: true });
      refetch();
    } catch (e: any) { setMsg({ text: 'Save failed: ' + e.message, ok: false }); }
    finally { setSaving(false); }
  };

  const testConn = async () => {
    setTesting(true); setTestResult(null);
    try { setTestResult(await apiFetch('/settings/email/test', { method: 'POST', body: '{}' })); }
    catch (e: any) { setTestResult({ smtp: { ok: false, error: e.message }, overall: false }); }
    finally { setTesting(false); }
  };

  const sendTest = async () => {
    setSending(true); setSendResult(null);
    try { setSendResult(await apiFetch('/settings/email/send-test?to_email='+encodeURIComponent(testEmail||''), { method: 'POST', body: '{}' })); }
    catch (e: any) { setSendResult({ success: false, message: e.message }); }
    finally { setSending(false); }
  };

  const saveTemplates = async () => {
    setSavingTemplates(true);
    try {
      await apiFetch('/settings/email', {method:'PUT', body:JSON.stringify({
        notification_mode: notifMode,
        stage_templates: templates,
      })});
      setMsg({text:'Stage email settings saved!', ok:true});
      refetch();
    } catch(e:any) {
      setMsg({text:'Save failed: '+e.message, ok:false});
    } finally { setSavingTemplates(false); }
  };

  return (
    <div style={{ maxWidth:'780px' }} className="anim-fade-up">

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:'12px', marginBottom:'24px' }}>
        <div style={{ width:'42px', height:'42px', borderRadius:'10px', background:'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Mail size={20} style={{ color:'#1e40af' }}/>
        </div>
        <div>
          <h1 style={{ fontSize:'20px', fontWeight:'700', color:'#0f172a', margin:0 }}>Email Configuration</h1>
          <p style={{ fontSize:'13px', color:'#64748b', margin:'2px 0 0' }}>Configure SMTP and IMAP for sending emails from aviintech.com</p>
        </div>
      </div>

      {/* Status Banner */}
      {saved?.configured && (
        <div style={{ ...CARD, background: saved.is_active ? '#f0fdf4' : '#fffbeb', border: '1px solid ' + (saved.is_active ? '#bbf7d0' : '#fde68a'), display:'flex', alignItems:'center', gap:'10px' }}>
          {saved.is_active
            ? <><CheckCircle size={16} style={{ color:'#16a34a', flexShrink:0 }}/><span style={{ fontSize:'13px', color:'#15803d' }}>Email is <b>active</b> — sending from <b>{saved.smtp_from}</b></span></>
            : <><AlertTriangle size={16} style={{ color:'#ca8a04', flexShrink:0 }}/><span style={{ fontSize:'13px', color:'#92400e' }}>Email configured but <b>not active</b> — enable below and save</span></>
          }
        </div>
      )}

      {/* Quick Presets */}
      <div style={CARD}>
        <p style={{ fontSize:'12px', fontWeight:'700', color:'#374151', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'12px' }}>Quick Setup — Select Provider</p>
        <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
          <button onClick={() => applyPreset('hostinger')}
            style={{ padding:'10px 20px', border:'2px solid #e2e8f0', borderRadius:'10px', background:'white', cursor:'pointer', fontSize:'13px', fontWeight:'600', color:'#374151' }}>
            Hostinger (aviintech.com)
          </button>
          <button onClick={() => applyPreset('gmail')}
            style={{ padding:'10px 20px', border:'2px solid #e2e8f0', borderRadius:'10px', background:'white', cursor:'pointer', fontSize:'13px', fontWeight:'600', color:'#374151' }}>
            Gmail
          </button>
        </div>
      </div>

      {/* SMTP */}
      <div style={CARD}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px', paddingBottom:'12px', borderBottom:'1px solid #f1f5f9' }}>
          <Send size={15} style={{ color:'#00b87c' }}/>
          <b style={{ fontSize:'14px', color:'#0f172a' }}>SMTP Settings</b>
          <span style={{ fontSize:'11px', color:'#94a3b8' }}>(for sending emails)</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
          <div><label style={LBL}>SMTP Host *</label><input style={INP} value={form.smtp_host} onChange={set('smtp_host')} placeholder="smtp.hostinger.com"/></div>
          <div><label style={LBL}>SMTP Port *</label><input type="number" style={INP} value={form.smtp_port} onChange={set('smtp_port')}/></div>
          <div><label style={LBL}>Email / Username *</label><input style={INP} value={form.smtp_user} onChange={set('smtp_user')} placeholder="noreply@aviintech.com"/></div>
          <div>
            <label style={LBL}>Password *</label>
            <div style={{ position:'relative' }}>
              <input type={showPw1 ? 'text' : 'password'} style={{ ...INP, paddingRight:'38px' }} value={form.smtp_password} onChange={set('smtp_password')} placeholder="enter password"/>
              <button onClick={() => setShowPw1(p => !p)} style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer' }}>
                {showPw1 ? <EyeOff size={14} style={{ color:'#94a3b8' }}/> : <Eye size={14} style={{ color:'#94a3b8' }}/>}
              </button>
            </div>
          </div>
          <div><label style={LBL}>From Email *</label><input style={INP} value={form.smtp_from} onChange={set('smtp_from')} placeholder="noreply@aviintech.com"/></div>
          <div><label style={LBL}>From Name</label><input style={INP} value={form.smtp_from_name} onChange={set('smtp_from_name')}/></div>
        </div>
        <div style={{ marginTop:'12px', display:'flex', alignItems:'center', gap:'8px' }}>
          <input type="checkbox" id="tls" checked={form.smtp_tls} onChange={e => setForm((f:any) => ({ ...f, smtp_tls: e.target.checked }))} style={{ accentColor:'#00b87c', width:'15px', height:'15px' }}/>
          <label htmlFor="tls" style={{ fontSize:'13px', color:'#374151', cursor:'pointer' }}>Use TLS (recommended for port 587)</label>
        </div>
      </div>

      {/* IMAP */}
      <div style={CARD}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'16px', paddingBottom:'12px', borderBottom:'1px solid #f1f5f9' }}>
          <Wifi size={15} style={{ color:'#7c3aed' }}/>
          <b style={{ fontSize:'14px', color:'#0f172a' }}>IMAP Settings</b>
          <span style={{ fontSize:'11px', color:'#94a3b8' }}>(for reading/receiving emails)</span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
          <div><label style={LBL}>IMAP Host</label><input style={INP} value={form.imap_host} onChange={set('imap_host')} placeholder="imap.hostinger.com"/></div>
          <div><label style={LBL}>IMAP Port</label><input type="number" style={INP} value={form.imap_port} onChange={set('imap_port')}/></div>
          <div><label style={LBL}>Email / Username</label><input style={INP} value={form.imap_user} onChange={set('imap_user')} placeholder="noreply@aviintech.com"/></div>
          <div>
            <label style={LBL}>IMAP Password</label>
            <div style={{ position:'relative' }}>
              <input type={showPw2 ? 'text' : 'password'} style={{ ...INP, paddingRight:'38px' }} value={form.imap_password} onChange={set('imap_password')} placeholder="enter password"/>
              <button onClick={() => setShowPw2(p => !p)} style={{ position:'absolute', right:'10px', top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer' }}>
                {showPw2 ? <EyeOff size={14} style={{ color:'#94a3b8' }}/> : <Eye size={14} style={{ color:'#94a3b8' }}/>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Enable + Actions */}
      <div style={CARD}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
          <div>
            <p style={{ fontSize:'14px', fontWeight:'600', color:'#0f172a', margin:0 }}>Enable Email Sending</p>
            <p style={{ fontSize:'12px', color:'#64748b', margin:'2px 0 0' }}>Activate for invites, interview reminders and offer letters</p>
          </div>
          <div onClick={() => setForm((f:any) => ({ ...f, is_active: !f.is_active }))}
            style={{ width:'44px', height:'24px', borderRadius:'12px', background: form.is_active ? '#00b87c' : '#e2e8f0', cursor:'pointer', transition:'background 0.2s', position:'relative', flexShrink:0 }}>
            <div style={{ width:'18px', height:'18px', borderRadius:'50%', background:'white', position:'absolute', top:'3px', left: form.is_active ? '23px' : '3px', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }}/>
          </div>
        </div>

        {msg && (
          <div style={{ marginBottom:'14px', padding:'10px 14px', borderRadius:'8px', background: msg.ok ? '#f0fdf4' : '#fef2f2', border: '1px solid ' + (msg.ok ? '#bbf7d0' : '#fecaca'), fontSize:'13px', color: msg.ok ? '#16a34a' : '#dc2626' }}>
            {msg.text}
          </div>
        )}

        <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
          <button onClick={save} disabled={saving} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'10px 22px', background:'#00b87c', color:'white', border:'none', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            <Save size={14}/>{saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button onClick={testConn} disabled={testing || !saved?.configured} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'10px 18px', background:'#eff6ff', color:'#1e40af', border:'1px solid #bfdbfe', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', opacity: (testing || !saved?.configured) ? 0.5 : 1 }}>
            <Server size={14}/>{testing ? 'Testing...' : 'Test Connection'}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:'8px',flex:1,minWidth:'220px'}}>
            <input style={{...INP,flex:1,height:'40px'}} value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder='Enter email to send test (e.g. you@gmail.com)'/>
          </div>
          <button onClick={sendTest} disabled={sending || !saved?.configured || !testEmail} style={{ display:'flex', alignItems:'center', gap:'6px', padding:'10px 18px', background:'#f5f3ff', color:'#7c3aed', border:'1px solid #c4b5fd', borderRadius:'8px', fontSize:'13px', fontWeight:'600', cursor:'pointer', opacity: (sending || !saved?.configured || !testEmail) ? 0.5 : 1 }}>
            <Send size={14}/>{sending ? 'Sending...' : 'Send Test Email'}
          </button>
        </div>

        {testResult && (
          <div style={{ marginTop:'14px', padding:'14px', borderRadius:'10px', background: testResult.overall ? '#f0fdf4' : '#fef2f2', border: '1px solid ' + (testResult.overall ? '#bbf7d0' : '#fecaca') }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
              {testResult.overall ? <CheckCircle size={16} style={{ color:'#16a34a' }}/> : <XCircle size={16} style={{ color:'#dc2626' }}/>}
              <b style={{ fontSize:'13px', color: testResult.overall ? '#15803d' : '#dc2626' }}>{testResult.overall ? 'Connection Successful!' : 'Connection Failed'}</b>
            </div>
            <p style={{ fontSize:'12px', color:'#64748b', margin:0 }}>SMTP: {testResult.smtp?.ok ? 'Connected' : 'Failed - ' + testResult.smtp?.error}</p>
            {testResult.imap && <p style={{ fontSize:'12px', color:'#64748b', margin:'3px 0 0' }}>IMAP: {testResult.imap?.ok ? 'Connected' : 'Failed - ' + testResult.imap?.error}</p>}
          </div>
        )}

        {sendResult && (
          <div style={{ marginTop:'12px', padding:'12px 14px', borderRadius:'8px', background: sendResult.success ? '#f0fdf4' : '#fef2f2', border: '1px solid ' + (sendResult.success ? '#bbf7d0' : '#fecaca'), fontSize:'13px', color: sendResult.success ? '#15803d' : '#dc2626' }}>
            {sendResult.success ? 'Test email sent to ' + sendResult.sent_to : 'Failed: ' + sendResult.message}
          </div>
        )}
      </div>

      {/* Help */}
      <div style={{ ...CARD, background:'#f8fafc' }}>
        <p style={{ fontSize:'13px', fontWeight:'700', color:'#374151', marginBottom:'12px' }}>Hostinger Setup Guide</p>
        <div style={{ fontSize:'12px', color:'#64748b', lineHeight:'1.8' }}>
          <p><b>Step 1:</b> Login to hpanel.hostinger.com — Emails — Email Accounts</p>
          <p><b>Step 2:</b> Create email noreply@aviintech.com with a strong password</p>
          <p><b>Step 3:</b> Click Hostinger preset button above — auto-fills SMTP and IMAP</p>
          <p><b>Step 4:</b> Enter your email and password — click Save Settings</p>
          <p><b>Step 5:</b> Click Test Connection — should show Connected</p>
          <p><b>Step 6:</b> Click Send Test Email — check your inbox for confirmation</p>
        </div>
        <div style={{ marginTop:'12px', padding:'10px 14px', borderRadius:'8px', background:'#eff6ff', border:'1px solid #bfdbfe', fontSize:'12px', color:'#1e40af' }}>
          SMTP: smtp.hostinger.com:587 (TLS) | IMAP: imap.hostinger.com:993 (SSL)
        </div>
      </div>

    {/* ── Stage Email Notifications ─────────────────────────────── */}
    <div style={CARD}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px'}}>
        <div>
          <h3 style={{margin:0,fontSize:'15px',fontWeight:'700',color:'#1e293b'}}>Stage Email Notifications</h3>
          <p style={{margin:'4px 0 0',fontSize:'12px',color:'#64748b'}}>Configure when emails are sent and customize messages per stage</p>
        </div>
        <button onClick={saveTemplates} disabled={savingTemplates} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',background:savingTemplates?'#94a3b8':'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:savingTemplates?'not-allowed':'pointer'}}>
          <Save size={14}/>{savingTemplates?'Saving...':'Save Templates'}
        </button>
      </div>

      {/* Mode Toggle */}
      <div style={{marginBottom:'24px',padding:'16px',background:'#f8fafc',borderRadius:'10px',border:'1px solid #e2e8f0'}}>
        <div style={{fontSize:'12px',fontWeight:'700',color:'#374151',marginBottom:'12px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Email Send Mode</div>
        <div style={{display:'flex',gap:'12px'}}>
          <button onClick={()=>setNotifMode('auto')} style={{flex:1,padding:'12px 16px',borderRadius:'8px',border:`2px solid ${notifMode==='auto'?'#1e40af':'#e2e8f0'}`,background:notifMode==='auto'?'#eff6ff':'white',cursor:'pointer',textAlign:'left'}}>
            <div style={{fontSize:'13px',fontWeight:'700',color:notifMode==='auto'?'#1e40af':'#374151',marginBottom:'4px'}}>⚡ Automatic</div>
            <div style={{fontSize:'11px',color:'#64748b'}}>Email sends instantly on every stage change using saved messages. No confirmation needed.</div>
          </button>
          <button onClick={()=>setNotifMode('manual')} style={{flex:1,padding:'12px 16px',borderRadius:'8px',border:`2px solid ${notifMode==='manual'?'#1e40af':'#e2e8f0'}`,background:notifMode==='manual'?'#eff6ff':'white',cursor:'pointer',textAlign:'left'}}>
            <div style={{fontSize:'13px',fontWeight:'700',color:notifMode==='manual'?'#1e40af':'#374151',marginBottom:'4px'}}>✍️ Manual</div>
            <div style={{fontSize:'11px',color:'#64748b'}}>A modal appears on each stage change so you can edit the message before sending.</div>
          </button>
        </div>
      </div>

      {/* Stage Message Templates */}
      <div style={{fontSize:'12px',fontWeight:'700',color:'#374151',marginBottom:'12px',textTransform:'uppercase',letterSpacing:'0.05em'}}>Stage Message Templates</div>
      <div style={{display:'flex',gap:'0',border:'1px solid #e2e8f0',borderRadius:'10px',overflow:'hidden'}}>
        {/* Stage list */}
        <div style={{width:'160px',flexShrink:0,borderRight:'1px solid #e2e8f0',background:'#f8fafc'}}>
          {EMAIL_STAGES.map(st=>{
            const hasCustom=!!(templates[st.key]?.message||templates[st.key]?.subject);
            return(
              <button key={st.key} onClick={()=>setActiveStage(st.key)}
                style={{width:'100%',padding:'10px 12px',textAlign:'left',border:'none',borderBottom:'1px solid #e2e8f0',background:activeStage===st.key?'white':'transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:'12px',fontWeight:activeStage===st.key?'700':'500',color:activeStage===st.key?'#1e40af':'#374151'}}>{st.label}</span>
                {hasCustom&&<span style={{width:'6px',height:'6px',borderRadius:'50%',background:'#22c55e',flexShrink:0}}/>}
              </button>
            );
          })}
        </div>
        {/* Template editor */}
        <div style={{flex:1,padding:'16px'}}>
          {EMAIL_STAGES.filter(s=>s.key===activeStage).map(st=>(
            <div key={st.key}>
              <div style={{fontSize:'13px',fontWeight:'700',color:'#1e293b',marginBottom:'14px'}}>{st.label} — Email Template</div>
              <div style={{marginBottom:'12px'}}>
                <label style={LBL}>Subject Line</label>
                <input style={INP} value={templates[st.key]?.subject||''} placeholder={DEFAULT_SUBJS[st.key]||'Subject...'}
                  onChange={e=>setTemplates(t=>({...t,[st.key]:{...(t[st.key]||{}),subject:e.target.value,message:(t[st.key]?.message)||''}}))}/>
                <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'3px'}}>Leave blank to use default subject</div>
              </div>
              <div>
                <label style={LBL}>Message Body</label>
                <textarea rows={6} style={{...INP,resize:'vertical',lineHeight:'1.6'}}
                  value={templates[st.key]?.message||''} placeholder={DEFAULT_MSGS[st.key]||'Message...'}
                  onChange={e=>setTemplates(t=>({...t,[st.key]:{...(t[st.key]||{}),subject:(t[st.key]?.subject)||'',message:e.target.value}}))}/>
                <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'3px'}}>Leave blank to use the built-in default message</div>
              </div>
              <button onClick={()=>setTemplates(t=>{const n={...t};delete n[st.key];return n;})}
                style={{marginTop:'10px',padding:'6px 12px',border:'1px solid #fee2e2',borderRadius:'6px',background:'#fef2f2',color:'#dc2626',fontSize:'12px',cursor:'pointer'}}>
                Reset to Default
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
