'use client';
import { useState, useEffect, CSSProperties } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { Building2, Save, Loader2, CheckCircle, XCircle, Shield, Globe } from 'lucide-react';

/*
 * Real, live gap fixed (2026-09-04): tenants.name (the real company/org
 * display name shown on the public careers page, e-signed offer/NDA
 * letters, etc. - already wired to real, live consumers) had no write
 * path anywhere in the app - not one endpoint, not one settings page.
 * Reported live: the tenant's own careers page showed the seed/demo
 * name "Acme Staffing India" with no way to change it from the admin
 * panel. This page + PUT /tenants/me close that gap.
 *
 * Real defensive guard, same SSR-safe deferred pattern already
 * established on settings/users/page.tsx for the identical class of
 * problem (2026-09-04, same day) - `!mounted` starts permissive to
 * avoid flashing "Access Restricted" at a legitimate admin during the
 * one-tick loading window, then resolves against the real role_
 * definitions row for this role (admin/super_admin, or any role
 * genuinely holding a real full or company_profile wildcard).
 */
export default function CompanyProfilePage() {
  const { data: tenant, loading, refetch } = useFetch<any>('/tenants/me');
  const { data: roles } = useFetch<any[]>('/roles');

  const [myRole, setMyRole] = useState('');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMyRole(getTokenPayload()?.role || ''); setMounted(true); }, []);

  const canManage = !mounted || ['admin', 'super_admin'].includes(myRole) || (() => {
    const mine = (roles || []).find((r: any) => r.role_code === myRole);
    const perms = mine?.permissions || {};
    const wildcard = perms['*'];
    const acts = perms['company_profile'];
    return Boolean((wildcard && (wildcard.includes('*') || wildcard.includes('read'))) ||
      (acts && (acts.includes('*') || acts.includes('read'))));
  })();

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);

  useEffect(() => { if (tenant?.name) setName(tenant.name); }, [tenant]);

  const showToast = (msg: string, ok = true) => {
    setToast(msg); setToastOk(ok);
    setTimeout(() => setToast(''), 3500);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { showToast('Company name cannot be blank', false); return; }
    setSaving(true);
    try {
      await apiFetch('/tenants/me', { method: 'PUT', body: JSON.stringify({ name: trimmed }) });
      showToast('Company name updated — the public careers page will reflect it immediately.');
      refetch();
    } catch (e: any) {
      showToast('Update failed: ' + e.message, false);
    } finally { setSaving(false); }
  };

  const INP: CSSProperties = {
    width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0',
    borderRadius: '8px', fontSize: '14px', outline: 'none',
    color: '#1e293b', boxSizing: 'border-box', background: 'white',
  };

  if (!canManage) {
    return (
      <div className="anim-fade-up space-y-6">
        <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }}>
          <Shield size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>Access Restricted</h2>
          <p style={{ fontSize: '13px' }}>Editing the company profile is limited to admin/manager accounts.<br />Contact your admin if you believe you should have access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-fade-up space-y-6" style={{ maxWidth: '640px' }}>
      {toast && (
        <div style={{
          position: 'fixed', top: '80px', right: '24px', zIndex: 9999,
          background: toastOk ? '#1e293b' : '#dc2626', color: 'white',
          padding: '10px 18px', borderRadius: '10px', fontSize: '13px',
          display: 'flex', alignItems: 'center', gap: '8px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.25)', maxWidth: '380px',
        }}>
          {toastOk ? <CheckCircle size={14} color="#22c55e" /> : <XCircle size={14} color="#fca5a5" />}
          {toast}
        </div>
      )}

      <div>
        <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={20} /> Company Profile
        </h1>
        <p style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
          Your organization's name, shown on the public careers page, e-signed offer/NDA letters, and tracking-sheet emails.
        </p>
      </div>

      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '24px' }}>
        <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '6px' }}>
          Company Name
        </label>
        {loading ? (
          <div style={{ ...INP, background: '#f8fafc', color: '#94a3b8' }}>Loading…</div>
        ) : (
          <input value={name} onChange={e => setName(e.target.value)} style={INP} placeholder="e.g. Aviin Technology Business Solutions Pvt Ltd" maxLength={255} />
        )}
        <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
          {name.length}/255 characters
        </p>

        <button onClick={handleSave} disabled={saving || loading || name.trim() === (tenant?.name || '')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', marginTop: '14px',
            background: (saving || loading || name.trim() === (tenant?.name || '')) ? '#94a3b8' : '#1e40af',
            color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '700',
            cursor: (saving || loading || name.trim() === (tenant?.name || '')) ? 'not-allowed' : 'pointer',
          }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {tenant?.name && (
        <div style={{ background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Globe size={16} color="#1e40af" />
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Currently live on your public careers page as <strong style={{ color: '#1e293b' }}>{tenant.name}</strong>.
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .animate-spin{animation:spin 1s linear infinite}
      `}</style>
    </div>
  );
}
