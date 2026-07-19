'use client';
import { useState, useRef, useEffect, CSSProperties } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  Plus, Trash2, CheckCircle, Loader2, Save, Eye, Mail, Reply,
  User, Phone, Globe, Linkedin, Twitter, MessageCircle,
  Upload, Image, Sliders, Palette, Type, Layout, Copy, X, Link2
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SigFields {
  name: string; title: string; company: string; email: string; phone: string;
  website: string; linkedin: string; twitter: string; whatsapp: string;
  tagline: string; cta_text: string; cta_url: string; disclaimer: string;
  photo: string; photo_size: number; logo: string; logo_width: number;
  primary_color: string; font: string; template: string; layout: string;
  show_photo: boolean; show_logo: boolean; show_social: boolean; show_divider: boolean;
}
interface Sig { id: string; name: string; html: string; updated_at: string; }
interface Account { id: string; email: string; display_name: string; provider: string; is_default: boolean; sig_new_mail?: string; sig_reply?: string; }

// ─── HTML Generator ───────────────────────────────────────────────────────────
function generateHTML(f: SigFields): string {
  const clr = f.primary_color || '#1e40af';
  const font = `font-family:${f.font||'Arial'},sans-serif;`;
  const socialLinks = [
    f.linkedin && `<a href="${f.linkedin.startsWith('http')?f.linkedin:'https://'+f.linkedin}" style="display:inline-block;background:${clr};color:white;text-decoration:none;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;margin-right:4px">in</a>`,
    f.twitter && `<a href="${f.twitter.startsWith('http')?f.twitter:'https://twitter.com/'+f.twitter.replace('@','')}" style="display:inline-block;background:#1DA1F2;color:white;text-decoration:none;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;margin-right:4px">𝕏</a>`,
    f.whatsapp && `<a href="https://wa.me/${f.whatsapp.replace(/\D/g,'')}" style="display:inline-block;background:#22c55e;color:white;text-decoration:none;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;margin-right:4px">WA</a>`,
  ].filter(Boolean).join('');

  const ctaBtn = f.cta_text && f.cta_url
    ? `<div style="margin-top:8px"><a href="${f.cta_url}" style="display:inline-block;background:${clr};color:white;text-decoration:none;font-size:12px;font-weight:600;padding:6px 16px;border-radius:6px">${f.cta_text}</a></div>`
    : '';

  const disclaimer = f.disclaimer
    ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;line-height:1.5">${f.disclaimer}</div>`
    : '';

  const photoHtml = f.show_photo && f.photo
    ? `<img src="${f.photo}" width="${f.photo_size}" height="${f.photo_size}" style="border-radius:50%;object-fit:cover;display:block" alt="Photo"/>`
    : '';

  const logoHtml = f.show_logo && f.logo
    ? `<img src="${f.logo}" width="${f.logo_width}" style="display:block;margin-bottom:8px" alt="Logo"/>`
    : '';

  const divider = f.show_divider
    ? `<div style="border-top:2px solid ${clr};margin:10px 0 10px"></div>`
    : '<div style="margin-top:10px"></div>';

  const nameHtml = `<div style="${font}font-size:16px;font-weight:800;color:#0f172a;margin:0 0 2px">${f.name}</div>`;
  const titleHtml = f.title ? `<div style="${font}font-size:12px;color:${clr};font-weight:600;margin:0 0 4px">${f.title}${f.company?` | ${f.company}`:''}</div>` : '';
  const taglineHtml = f.tagline ? `<div style="${font}font-size:11px;color:#64748b;font-style:italic;margin:0 0 6px">${f.tagline}</div>` : '';
  const contactHtml = `<div style="${font}font-size:12px;color:#374151;margin:0 0 4px">
    ${f.email?`<span>📧 <a href="mailto:${f.email}" style="color:${clr};text-decoration:none">${f.email}</a></span>`:''}
    ${f.phone?`<span style="margin-left:10px">📱 ${f.phone}</span>`:''}
  </div>`;
  const websiteHtml = f.website ? `<div style="${font}font-size:12px;color:#374151;margin:0 0 6px">🌐 <a href="${f.website.startsWith('http')?f.website:'https://'+f.website}" style="color:${clr};text-decoration:none">${f.website}</a></div>` : '';
  const socialHtml = f.show_social && socialLinks ? `<div style="margin:6px 0">${socialLinks}</div>` : '';

  if (f.template === 'professional') {
    return `<table cellpadding="0" cellspacing="0" style="max-width:520px">${divider}<tr>
      ${(f.show_photo && f.photo) ? `<td valign="top" style="padding-right:14px">${photoHtml}</td>` : ''}
      <td valign="top">
        ${logoHtml}${nameHtml}${titleHtml}${taglineHtml}${contactHtml}${websiteHtml}${socialHtml}${ctaBtn}${disclaimer}
      </td>
    </tr></table>`;
  }

  if (f.template === 'modern') {
    return `<table cellpadding="0" cellspacing="0" style="max-width:520px">${divider}
      <tr><td style="padding:12px 16px;background:${clr}20;border-left:4px solid ${clr};border-radius:0 8px 8px 0">
        <table cellpadding="0" cellspacing="0"><tr>
          ${(f.show_photo && f.photo) ? `<td valign="middle" style="padding-right:14px">${photoHtml}</td>` : ''}
          <td valign="middle">
            ${nameHtml}${titleHtml}${taglineHtml}${contactHtml}${websiteHtml}${socialHtml}
          </td>
          ${(f.show_logo && f.logo) ? `<td valign="middle" style="padding-left:16px"><img src="${f.logo}" width="${f.logo_width}" style="display:block" alt="Logo"/></td>` : ''}
        </tr></table>
        ${ctaBtn}${disclaimer}
      </td></tr>
    </table>`;
  }

  if (f.template === 'corporate') {
    return `<table cellpadding="0" cellspacing="0" style="max-width:520px">${divider}
      ${(f.show_logo && f.logo) ? `<tr><td style="padding-bottom:10px">${logoHtml}</td></tr>` : ''}
      <tr><td style="border-top:3px solid ${clr};padding-top:10px">
        <table><tr>
          ${(f.show_photo && f.photo) ? `<td valign="top" style="padding-right:12px">${photoHtml}</td>` : ''}
          <td valign="top">
            ${nameHtml}${titleHtml}${taglineHtml}${contactHtml}${websiteHtml}
          </td>
        </tr></table>
        ${socialHtml}${ctaBtn}${disclaimer}
      </td></tr>
    </table>`;
  }

  // Pure image signature (Canva export, screenshot, etc.)
  if (f.show_logo && f.logo && f.name === DEFAULT.name && f.template === 'minimal') {
    const sep = f.show_divider ? '<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0"/>' : '';
    return `<div>${sep}<img src="${f.logo}" width="${f.logo_width}" style="display:block;max-width:100%;height:auto" alt="Signature"/></div>`;
  }

  if (f.template === 'minimal') {
    return `<div style="${font}max-width:520px">${divider}
      <div style="font-size:14px;font-weight:700;color:#0f172a">${f.name}</div>
      ${f.title?`<div style="font-size:12px;color:${clr}">${f.title}${f.company?' · '+f.company:''}</div>`:''}
      <div style="font-size:12px;color:#64748b;margin-top:4px">
        ${f.email?`<a href="mailto:${f.email}" style="color:${clr};text-decoration:none">${f.email}</a>`:''}
        ${f.phone?` &nbsp;|&nbsp; ${f.phone}`:''}
        ${f.website?` &nbsp;|&nbsp; <a href="${f.website.startsWith('http')?f.website:'https://'+f.website}" style="color:${clr};text-decoration:none">${f.website}</a>`:''}
      </div>
      ${socialHtml}${disclaimer}
    </div>`;
  }

  if (f.template === 'banner') {
    return `<table cellpadding="0" cellspacing="0" style="max-width:540px">${divider}
      <tr><td style="background:linear-gradient(135deg,${clr},${clr}cc);padding:14px 20px;border-radius:10px">
        <table><tr>
          ${(f.show_photo && f.photo) ? `<td valign="middle" style="padding-right:14px"><img src="${f.photo}" width="${f.photo_size}" height="${f.photo_size}" style="border-radius:50%;border:3px solid white" alt="Photo"/></td>` : ''}
          <td valign="middle">
            <div style="${font}font-size:15px;font-weight:800;color:white">${f.name}</div>
            ${f.title?`<div style="${font}font-size:12px;color:rgba(255,255,255,0.8)">${f.title}${f.company?' | '+f.company:''}</div>`:''}
          </td>
          ${(f.show_logo && f.logo) ? `<td valign="middle" style="padding-left:20px"><img src="${f.logo}" width="${f.logo_width}" style="opacity:0.9;display:block" alt="Logo"/></td>` : ''}
        </tr></table>
      </td></tr>
      <tr><td style="padding:8px 0;${font}font-size:12px;color:#374151">
        ${f.email?`📧 <a href="mailto:${f.email}" style="color:${clr};text-decoration:none">${f.email}</a>&nbsp;&nbsp;`:''}
        ${f.phone?`📱 ${f.phone}&nbsp;&nbsp;`:''}
        ${f.website?`🌐 <a href="${f.website.startsWith('http')?f.website:'https://'+f.website}" style="color:${clr};text-decoration:none">${f.website}</a>`:''}
      </td></tr>
      ${socialLinks?`<tr><td style="padding:2px 0">${socialLinks}</td></tr>`:''}
      ${ctaBtn?`<tr><td style="padding:6px 0">${ctaBtn}</td></tr>`:''}
      ${disclaimer?`<tr><td>${disclaimer}</td></tr>`:''}
    </table>`;
  }

  // Default: same as professional
  return `<table cellpadding="0" cellspacing="0" style="max-width:520px">${divider}<tr>
    ${(f.show_photo && f.photo) ? `<td valign="top" style="padding-right:14px">${photoHtml}</td>` : ''}
    <td valign="top">${logoHtml}${nameHtml}${titleHtml}${taglineHtml}${contactHtml}${websiteHtml}${socialHtml}${ctaBtn}${disclaimer}</td>
  </tr></table>`;
}

// ─── Template cards ───────────────────────────────────────────────────────────
const TEMPLATES = [
  { id:'professional', label:'Professional', desc:'Photo left, details right' },
  { id:'modern',       label:'Modern',       desc:'Colored accent background' },
  { id:'corporate',    label:'Corporate',    desc:'Logo top, bordered' },
  { id:'banner',       label:'Banner',       desc:'Gradient header card' },
  { id:'minimal',      label:'Minimal',      desc:'Clean text only' },
];

const COLORS = ['#1e40af','#1e3a8a','#7c3aed','#db2777','#dc2626','#16a34a','#0891b2','#0f172a','#374151','#92400e'];
const FONTS  = ['Arial','Georgia','Verdana','Trebuchet MS','Times New Roman','Helvetica'];

const DEFAULT: SigFields = {
  name:'Your Name', title:'Job Title', company:'Company Name',
  email:'you@company.com', phone:'+91 98765 43210',
  website:'company.com', linkedin:'', twitter:'', whatsapp:'',
  tagline:'', cta_text:'', cta_url:'', disclaimer:'',
  photo:'', photo_size:60, logo:'', logo_width:120,
  primary_color:'#1e40af', font:'Arial', template:'professional', layout:'left',
  show_photo:false, show_logo:false, show_social:true, show_divider:true,
};

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SignaturesPage() {
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [sigName, setSigName] = useState('My Signature');
  const [fields, setFields] = useState<SigFields>(DEFAULT);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string|null>(null);
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'content'|'design'|'extras'>('content');
  const [defSaving, setDefSaving] = useState<string|null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const { data: sigs, refetch: refetchSigs } = useFetch<Sig[]>('/signatures');
  const { data: accounts } = useFetch<Account[]>('/user-mail/accounts');

  const set = (key: keyof SigFields, val: any) => setFields(prev => ({ ...prev, [key]: val }));

  const showToast = (msg: string, ok = true) => {
    setToast(msg); setToastOk(ok); setTimeout(() => setToast(''), 3500);
  };

  const loadSig = (sig: Sig) => {
    setSelectedId(sig.id);
    setSigName(sig.name);
    // Try to parse stored fields from HTML comment
    try {
      const match = sig.html.match(/<!--FIELDS:([\s\S]*?)-->/);
      if (match) {
        const parsed = JSON.parse(decodeURIComponent(match[1]));
        setFields(parsed);
      }
    } catch { /* use defaults */ }
  };

  const buildFinalHTML = () => {
    const html = generateHTML(fields);
    // Embed fields as HTML comment for re-editing
    return `<!--FIELDS:${encodeURIComponent(JSON.stringify(fields))}-->${html}`;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const html = buildFinalHTML();
      if (selectedId) {
        await apiFetch('/signatures/' + selectedId, { method: 'PUT', body: JSON.stringify({ name: sigName, html }) });
        showToast('Signature saved!');
      } else {
        const r = await apiFetch('/signatures', { method: 'POST', body: JSON.stringify({ name: sigName, html }) });
        setSelectedId(r.id);
        showToast('Signature created!');
      }
      refetchSigs();
    } catch (e: any) { showToast('Save failed: ' + e.message, false); }
    finally { setSaving(false); }
  };

  const handleNew = () => {
    setSelectedId(null);
    setSigName('New Signature');
    setFields(DEFAULT);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this signature?')) return;
    setDeleting(id);
    try {
      await apiFetch('/signatures/' + id, { method: 'DELETE' });
      showToast('Deleted');
      if (selectedId === id) { setSelectedId(null); setFields(DEFAULT); }
      refetchSigs();
    } catch { showToast('Failed', false); }
    finally { setDeleting(null); }
  };

  const handleImageUpload = (key: 'photo' | 'logo') => {
    const ref = key === 'photo' ? photoRef : logoRef;
    ref.current?.click();
  };

  const onImageFile = (key: 'photo' | 'logo') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      set(key, ev.target?.result as string);
      if (key === 'photo') set('show_photo', true);
      if (key === 'logo') set('show_logo', true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const copyHTML = async () => {
    await navigator.clipboard.writeText(generateHTML(fields));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const setAccountDefault = async (accId: string, type: 'new_mail' | 'reply', sigId: string | null) => {
    setDefSaving(accId + type);
    try {
      const acc = (accounts || []).find(a => a.id === accId);
      await apiFetch('/signatures/accounts/' + accId + '/defaults', {
        method: 'PATCH',
        body: JSON.stringify({
          sig_new_mail: type === 'new_mail' ? sigId : (acc?.sig_new_mail || null),
          sig_reply: type === 'reply' ? sigId : (acc?.sig_reply || null),
        })
      });
      showToast('Default updated! Signature will auto-appear in new emails.');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e: any) { showToast('Failed: ' + e.message, false); }
    finally { setDefSaving(null); }
  };

  const INP: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', outline: 'none', color: '#1e293b', boxSizing: 'border-box', background: 'white' };
  const LBL: CSSProperties = { fontSize: '11px', fontWeight: '700', color: '#64748b', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '80px', right: '24px', zIndex: 9999, background: toastOk ? '#1e293b' : '#dc2626', color: 'white', padding: '10px 18px', borderRadius: '10px', fontSize: '13px', boxShadow: '0 8px 30px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {toastOk ? <CheckCircle size={14} color="#22c55e" /> : <X size={14} color="#fca5a5" />}
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '8px' }}>
        <a href='/conversations' style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#64748b', textDecoration: 'none', padding: '4px 0', fontWeight: '500' }}>
          ← Back to Mailbox
        </a>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>Email Signatures</h1>
          <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>Build your signature once — it auto-appears in every email. No typing needed.</p>
        </div>
        <button onClick={handleNew}
          style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 18px', background: 'linear-gradient(135deg,#1e40af,#3b82f6)', color: 'white', border: 'none', borderRadius: '9px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', boxShadow: '0 3px 12px rgba(30,64,175,0.3)' }}>
          <Plus size={14} /> New Signature
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '16px' }}>

        {/* ── LEFT: Signature list ── */}
        <div>
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '12px' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>My Signatures ({(sigs || []).length})</div>
            {!(sigs || []).length && (
              <div style={{ padding: '20px 14px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>No signatures yet.<br />Create your first one →</div>
            )}
            {(sigs || []).map(sig => (
              <div key={sig.id} onClick={() => loadSig(sig)}
                style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', background: selectedId === sig.id ? '#eff6ff' : 'white', borderLeft: selectedId === sig.id ? '3px solid #1e40af' : '3px solid transparent' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: selectedId === sig.id ? '700' : '500', color: selectedId === sig.id ? '#1e40af' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sig.name}</div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>{new Date(sig.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); handleDelete(sig.id); }} style={{ padding: '3px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                  {deleting === sig.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                </button>
              </div>
            ))}
          </div>

          {/* Templates */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Templates</div>
            {TEMPLATES.map(t => (
              <div key={t.id} onClick={() => set('template', t.id)}
                style={{ padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #f8fafc', borderLeft: fields.template === t.id ? '3px solid #1e40af' : '3px solid transparent', background: fields.template === t.id ? '#eff6ff' : 'white' }}>
                <div style={{ fontSize: '12px', fontWeight: fields.template === t.id ? '700' : '500', color: fields.template === t.id ? '#1e40af' : '#374151' }}>{t.label}</div>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── RIGHT: Editor ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Sig name + save */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', flexShrink: 0 }}>Signature Name:</span>
            <input value={sigName} onChange={e => setSigName(e.target.value)} placeholder="e.g. Professional, Recruitment..."
              style={{ ...INP, flex: 1, border: 'none', fontSize: '15px', fontWeight: '700', padding: '4px 0' }} />
            <button onClick={copyHTML}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: '7px', background: copied ? '#f0fdf4' : 'white', color: copied ? '#16a34a' : '#64748b', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
              {copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied!' : 'Copy HTML'}
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 20px', background: saving ? '#94a3b8' : '#1e40af', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {saving ? 'Saving...' : 'Save Signature'}
            </button>
          </div>

          {/* Editor tabs */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            {/* Tab headers */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fafafa' }}>
              {([['content', '👤 Content', 'Name, contact info'],['design','🎨 Design','Colors, fonts, images'],['extras','✨ Extras','Social, CTA, disclaimer']] as [string,string,string][]).map(([key,label,desc])=>(
                <button key={key} onClick={() => setActiveTab(key as any)}
                  style={{ flex: 1, padding: '12px', border: 'none', background: activeTab === key ? 'white' : 'transparent', cursor: 'pointer', borderBottom: activeTab === key ? '2px solid #1e40af' : '2px solid transparent', color: activeTab === key ? '#1e40af' : '#64748b' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700' }}>{label}</div>
                  <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '1px' }}>{desc}</div>
                </button>
              ))}
            </div>

            <div style={{ padding: '16px 20px' }}>
              {/* ── CONTENT TAB ── */}
              {activeTab === 'content' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={LBL}>Full Name *</label>
                    <input value={fields.name} onChange={e => set('name', e.target.value)} placeholder="Mohsin Khan" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Job Title</label>
                    <input value={fields.title} onChange={e => set('title', e.target.value)} placeholder="Senior Recruiter" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Company</label>
                    <input value={fields.company} onChange={e => set('company', e.target.value)} placeholder="AVIIN Jobs Services" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Email</label>
                    <input value={fields.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" type="email" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Phone</label>
                    <input value={fields.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Website</label>
                    <input value={fields.website} onChange={e => set('website', e.target.value)} placeholder="aviinjobs.com" style={INP} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={LBL}>Tagline / Motto</label>
                    <input value={fields.tagline} onChange={e => set('tagline', e.target.value)} placeholder="Connecting Talent with Opportunity" style={INP} />
                  </div>
                </div>
              )}

              {/* ── DESIGN TAB ── */}
              {activeTab === 'design' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Color */}
                  <div>
                    <label style={LBL}>Brand Color</label>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {COLORS.map(clr => (
                        <button key={clr} onClick={() => set('primary_color', clr)}
                          style={{ width: '28px', height: '28px', borderRadius: '50%', background: clr, border: fields.primary_color === clr ? '3px solid #1e40af' : '2px solid rgba(0,0,0,0.1)', cursor: 'pointer', boxShadow: fields.primary_color === clr ? '0 0 0 2px white, 0 0 0 4px ' + clr : 'none' }} />
                      ))}
                      <input type="color" value={fields.primary_color} onChange={e => set('primary_color', e.target.value)}
                        style={{ width: '28px', height: '28px', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0 }} title="Custom color" />
                      <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '4px' }}>{fields.primary_color}</span>
                    </div>
                  </div>

                  {/* Font */}
                  <div>
                    <label style={LBL}>Font</label>
                    <select value={fields.font} onChange={e => set('font', e.target.value)} style={{ ...INP, cursor: 'pointer' }}>
                      {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                    </select>
                  </div>

                  {/* ── Canva / Any image as full signature ── */}
                  <div style={{padding:'14px',background:'linear-gradient(135deg,#f0fdf4,#eff6ff)',borderRadius:'10px',border:'1px solid #bfdbfe',marginBottom:'16px'}}>
                    <div style={{fontSize:'12px',fontWeight:'800',color:'#1e40af',marginBottom:'6px'}}>
                      ✨ Upload Canva / Custom Signature Image
                    </div>
                    <div style={{fontSize:'11px',color:'#64748b',marginBottom:'10px',lineHeight:'1.6'}}>
                      Design in Canva, Photoshop, or any tool → export as PNG → upload here.
                      This replaces the form below and uses your image as the complete signature.
                    </div>
                    <div style={{display:'flex',gap:'8px',marginBottom:fields.logo?'10px':'0'}}>
                      <button onClick={()=>logoRef.current?.click()}
                        style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 16px',border:'2px dashed #3b82f6',borderRadius:'8px',background:'white',color:'#1e40af',fontSize:'12px',fontWeight:'700',cursor:'pointer'}}>
                        <Upload size={13}/> Upload PNG / JPG / GIF
                      </button>
                      <input type='text' value={fields.logo} onChange={e=>set('logo',e.target.value)}
                        placeholder='Or paste image URL from Canva share link...'
                        style={{flex:1,padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'12px',outline:'none',color:'#1e293b'}}/>
                    </div>
                    {fields.logo && (
                      <div>
                        <img src={fields.logo} alt='Signature' style={{maxWidth:'100%',maxHeight:'160px',objectFit:'contain',display:'block',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'8px',background:'white',marginBottom:'10px'}}/>
                        <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'12px'}}>
                          <span style={{color:'#374151',flexShrink:0}}>Width: {fields.logo_width}px</span>
                          <input type='range' min={100} max={600} value={fields.logo_width}
                            onChange={e=>set('logo_width',+e.target.value)}
                            style={{flex:1,accentColor:'#1e40af'}}/>
                          <button onClick={()=>{set('show_logo',true);set('show_photo',false);set('template','minimal');}}
                            style={{padding:'6px 12px',background:'#1e40af',color:'white',border:'none',borderRadius:'7px',fontSize:'11px',fontWeight:'700',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>
                            Use as Full Signature
                          </button>
                          <button onClick={()=>set('logo','')}
                            style={{padding:'6px 10px',background:'#fff5f5',color:'#dc2626',border:'1px solid #fca5a5',borderRadius:'7px',fontSize:'11px',cursor:'pointer',flexShrink:0}}>
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Profile Photo */}
                  <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <label style={{ ...LBL, margin: 0 }}>Profile Photo</label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#374151' }}>
                        <input type="checkbox" checked={fields.show_photo} onChange={e => set('show_photo', e.target.checked)} />
                        Show
                      </label>
                    </div>
                    {fields.photo ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                        <img src={fields.photo} alt="Photo" style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0' }} />
                        <button onClick={() => set('photo', '')} style={{ padding: '4px 10px', border: '1px solid #fca5a5', borderRadius: '6px', background: '#fff5f5', color: '#dc2626', fontSize: '11px', cursor: 'pointer' }}>Remove</button>
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                      <button onClick={() => handleImageUpload('photo')}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', border: '1.5px dashed #3b82f6', borderRadius: '7px', background: '#eff6ff', color: '#1e40af', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                        <Upload size={12} /> Upload Photo
                      </button>
                      <input type="text" value={fields.photo} onChange={e => { set('photo', e.target.value); if (e.target.value) set('show_photo', true); }}
                        placeholder="Or paste image URL..." style={{ ...INP, flex: 1 }} />
                    </div>
                    <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageFile('photo')} />
                    <label style={LBL}>Photo Size: {fields.photo_size}px</label>
                    <input type="range" min={40} max={120} value={fields.photo_size} onChange={e => set('photo_size', +e.target.value)}
                      style={{ width: '100%', accentColor: '#1e40af' }} />
                  </div>

                  {/* Company Logo */}
                  <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <label style={{ ...LBL, margin: 0 }}>Company Logo</label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: '#374151' }}>
                        <input type="checkbox" checked={fields.show_logo} onChange={e => set('show_logo', e.target.checked)} />
                        Show
                      </label>
                    </div>
                    {fields.logo ? (
                      <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img src={fields.logo} alt="Logo" style={{ maxWidth: `${fields.logo_width}px`, maxHeight: '50px', objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '4px', background: 'white' }} />
                        <button onClick={() => set('logo', '')} style={{ padding: '4px 10px', border: '1px solid #fca5a5', borderRadius: '6px', background: '#fff5f5', color: '#dc2626', fontSize: '11px', cursor: 'pointer' }}>Remove</button>
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                      <button onClick={() => handleImageUpload('logo')}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', border: '1.5px dashed #3b82f6', borderRadius: '7px', background: '#eff6ff', color: '#1e40af', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                        <Upload size={12} /> Upload Logo
                      </button>
                      <input type="text" value={fields.logo} onChange={e => { set('logo', e.target.value); if (e.target.value) set('show_logo', true); }}
                        placeholder="Or paste logo URL..." style={{ ...INP, flex: 1 }} />
                    </div>
                    <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onImageFile('logo')} />
                    <label style={LBL}>Logo Width: {fields.logo_width}px</label>
                    <input type="range" min={60} max={250} value={fields.logo_width} onChange={e => set('logo_width', +e.target.value)}
                      style={{ width: '100%', accentColor: '#1e40af' }} />
                  </div>

                  {/* Divider toggle */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
                    <input type="checkbox" checked={fields.show_divider} onChange={e => set('show_divider', e.target.checked)} />
                    Show separator line above signature
                  </label>
                </div>
              )}

              {/* ── EXTRAS TAB ── */}
              {activeTab === 'extras' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={LBL}>LinkedIn Profile URL</label>
                    <input value={fields.linkedin} onChange={e => set('linkedin', e.target.value)} placeholder="linkedin.com/in/yourprofile" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>Twitter / X Handle</label>
                    <input value={fields.twitter} onChange={e => set('twitter', e.target.value)} placeholder="@yourhandle or twitter.com/handle" style={INP} />
                  </div>
                  <div>
                    <label style={LBL}>WhatsApp Number</label>
                    <input value={fields.whatsapp} onChange={e => set('whatsapp', e.target.value)} placeholder="+919876543210" style={INP} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
                    <input type="checkbox" checked={fields.show_social} onChange={e => set('show_social', e.target.checked)} />
                    Show social media badges
                  </label>
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
                    <label style={LBL}>Call to Action Button</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <input value={fields.cta_text} onChange={e => set('cta_text', e.target.value)} placeholder="Book a Call" style={INP} />
                      <input value={fields.cta_url} onChange={e => set('cta_url', e.target.value)} placeholder="https://calendly.com/..." style={INP} />
                    </div>
                  </div>
                  <div>
                    <label style={LBL}>Legal Disclaimer (optional)</label>
                    <textarea value={fields.disclaimer} onChange={e => set('disclaimer', e.target.value)}
                      placeholder="This email is confidential..."
                      rows={3} style={{ ...INP, resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── LIVE PREVIEW ── */}
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                👁 Live Preview — updates as you type
              </div>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Template: {fields.template}</span>
            </div>
            <div style={{ padding: '20px 24px', background: 'white', minHeight: '100px' }}>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '10px', fontStyle: 'italic' }}>Hi [Candidate Name],</div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>Thank you for your interest in this position...</div>
              <div dangerouslySetInnerHTML={{ __html: generateHTML(fields) }} />
            </div>
          </div>

          {/* ── ACCOUNT DEFAULTS ── */}
          {(accounts || []).length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', background: '#fafafa' }}>
                <div style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>Set as Default Signature</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Choose which signature auto-appears for new emails and replies — set once, works forever.</div>
              </div>
              {(accounts || []).map(acc => (
                <div key={acc.id} style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '800', color: '#1e40af' }}>
                      {acc.provider[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b' }}>{acc.display_name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{acc.email}</div>
                    </div>
                    {acc.is_default && <span style={{ fontSize: '10px', background: '#eff6ff', color: '#1e40af', padding: '1px 7px', borderRadius: '10px', fontWeight: '700', border: '1px solid #bfdbfe' }}>Default</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', ...LBL, marginBottom: '6px' }}>
                        <Mail size={11} color="#1e40af" /> New Mail
                      </label>
                      <select value={acc.sig_new_mail || ''}
                        onChange={e => setAccountDefault(acc.id, 'new_mail', e.target.value || null)}
                        style={{ ...INP, cursor: 'pointer' }}>
                        <option value="">(None — no auto signature)</option>
                        {(sigs || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {acc.sig_new_mail && <div style={{ fontSize: '10px', color: '#16a34a', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '3px' }}><CheckCircle size={10} /> Auto-appears in new emails ✓</div>}
                    </div>
                    <div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '5px', ...LBL, marginBottom: '6px' }}>
                        <Reply size={11} color="#16a34a" /> Replies & Forwards
                      </label>
                      <select value={acc.sig_reply || ''}
                        onChange={e => setAccountDefault(acc.id, 'reply', e.target.value || null)}
                        style={{ ...INP, cursor: 'pointer' }}>
                        <option value="">(None)</option>
                        {(sigs || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {acc.sig_reply && <div style={{ fontSize: '10px', color: '#16a34a', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '3px' }}><CheckCircle size={10} /> Auto-appears in replies ✓</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .animate-spin{animation:spin 1s linear infinite}
        input[type=range]{height:4px;border-radius:2px}
      `}</style>
    </div>
  );
}
