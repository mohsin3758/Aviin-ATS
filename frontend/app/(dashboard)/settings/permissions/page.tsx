'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { KeyRound, Shield, ShieldAlert, Save, RotateCcw, Activity, Check, X, Eye, ChevronDown, ChevronRight } from 'lucide-react';

interface Role {
  id: string;
  role_code: string;
  role_name: string;
  department: string;
  level: number;
  permissions: Record<string, string[]>;
  is_system: boolean;
  user_count: number;
  job_visibility_scope: 'all' | 'assigned_only';
}

interface FeatureDef { key: string; label: string; }
interface FeatureGroupDef { id: string; label: string; features: FeatureDef[]; }

export default function PermissionsSettings() {
  const { data: roles, refetch: refetchRoles } = useFetch<Role[]>('/roles');
  const { data: featureData } = useFetch<{ groups: FeatureGroupDef[]; features: FeatureDef[]; actions: string[] }>('/roles/features');
  const { data: enforcement, refetch: refetchEnforcement } = useFetch<{ enabled: boolean }>('/roles/enforcement');

  const [selectedRoleCode, setSelectedRoleCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [togglingEnforcement, setTogglingEnforcement] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  // 2026-08-17: feature-level permissions — 73 individual features across
  // 11 groups (mirrors the sidebar's own NAV_GROUPS) would be unwieldy as
  // one flat table, so each group is a collapsible section, default
  // collapsed so the page opens manageable rather than an 11-table wall.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const sortedRoles = [...(roles || [])].sort((a, b) => a.department.localeCompare(b.department) || b.level - a.level);
  const selectedRole = sortedRoles.find(r => r.role_code === selectedRoleCode) || null;

  useEffect(() => {
    if (!selectedRoleCode && sortedRoles.length > 0) setSelectedRoleCode(sortedRoles[0].role_code);
  }, [sortedRoles.length]);

  useEffect(() => {
    if (selectedRole) setDraft(JSON.parse(JSON.stringify(selectedRole.permissions || {})));
  }, [selectedRoleCode, selectedRole?.permissions]);

  const groups = featureData?.groups || [];
  const actions = featureData?.actions || ['create', 'read', 'update', 'delete', 'export'];

  function hasAction(feature: string, action: string) {
    const acts = draft[feature] || [];
    return acts.includes('*') || acts.includes(action);
  }
  function toggleAction(feature: string, action: string) {
    setDraft(prev => {
      const acts = new Set(prev[feature] || []);
      if (acts.has('*')) {
        // Expand wildcard into explicit actions minus the one being unchecked
        actions.forEach(a => { if (a !== action) acts.add(a); });
        acts.delete('*');
      } else if (acts.has(action)) {
        acts.delete(action);
      } else {
        acts.add(action);
      }
      const next = { ...prev };
      if (acts.size === 0) delete next[feature]; else next[feature] = Array.from(acts);
      return next;
    });
  }
  function isFeatureFullyGranted(feature: string) {
    return hasAction(feature, '*') || actions.every(a => hasAction(feature, a));
  }
  function isGroupFullyGranted(groupFeatures: FeatureDef[]) {
    return groupFeatures.length > 0 && groupFeatures.every(f => isFeatureFullyGranted(f.key));
  }
  function toggleGroupAll(groupFeatures: FeatureDef[]) {
    const allGranted = isGroupFullyGranted(groupFeatures);
    setDraft(prev => {
      const next = { ...prev };
      groupFeatures.forEach(f => {
        if (allGranted) delete next[f.key]; else next[f.key] = ['*'];
      });
      return next;
    });
  }
  const toggleGroupOpen = (id: string) => setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }));

  async function save() {
    if (!selectedRole) return;
    setSaving(true); setMsg(null);
    try {
      await apiFetch(`/roles/${selectedRole.id}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions: draft }) });
      setMsg({ text: `Saved permissions for "${selectedRole.role_name}"`, ok: true });
      refetchRoles();
    } catch (e: any) {
      setMsg({ text: e?.message || 'Save failed', ok: false });
    } finally { setSaving(false); }
  }

  function resetDraft() {
    if (selectedRole) setDraft(JSON.parse(JSON.stringify(selectedRole.permissions || {})));
  }

  async function setVisibility(scope: 'all' | 'assigned_only') {
    if (!selectedRole || scope === selectedRole.job_visibility_scope) return;
    setSavingVisibility(true);
    try {
      await apiFetch(`/roles/${selectedRole.id}/visibility`, { method: 'PUT', body: JSON.stringify({ job_visibility_scope: scope }) });
      refetchRoles();
    } finally { setSavingVisibility(false); }
  }

  async function toggleEnforcement() {
    const next = !enforcement?.enabled;
    if (next && !confirm(
      'Turn ON real enforcement?\n\nOnce enabled, any role\'s access to a feature/action not explicitly granted will be BLOCKED (403), not just logged. Review the Activity Log below first to see what would be affected.\n\nContinue?'
    )) return;
    setTogglingEnforcement(true);
    try {
      await apiFetch('/roles/enforcement', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      refetchEnforcement();
    } finally { setTogglingEnforcement(false); }
  }

  return (
    <div style={{ maxWidth: 980 }} className="anim-fade-up">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <KeyRound size={20} style={{ color: '#1e40af' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>Permissions</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
            Real per-feature, per-role access control. Pick a role below, check off what it can do — admin always has full access regardless of these settings.
          </p>
        </div>
      </div>

      {/* Enforcement toggle */}
      <div style={{
        marginBottom: 20, padding: '14px 18px', borderRadius: 12,
        background: enforcement?.enabled ? '#fef2f2' : '#fffbeb',
        border: `1px solid ${enforcement?.enabled ? '#fecaca' : '#fde68a'}`,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        {enforcement?.enabled ? <ShieldAlert size={22} style={{ color: '#dc2626', flexShrink: 0 }} /> : <Shield size={22} style={{ color: '#b45309', flexShrink: 0 }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: enforcement?.enabled ? '#991b1b' : '#92400e' }}>
            {enforcement?.enabled ? 'Enforcement is ON' : 'Enforcement is OFF (log only)'}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {enforcement?.enabled
              ? 'Access not explicitly granted to a role is blocked (403) right now.'
              : 'Nothing is actually restricted yet — denials are logged below so you can review real usage before turning this on.'}
          </div>
        </div>
        <button onClick={toggleEnforcement} disabled={togglingEnforcement || !enforcement}
          style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: enforcement?.enabled ? '#fff' : '#1e40af',
            color: enforcement?.enabled ? '#dc2626' : '#fff',
            border: enforcement?.enabled ? '1px solid #fecaca' : 'none',
          } as any}>
          {togglingEnforcement ? 'Updating…' : enforcement?.enabled ? 'Turn Off' : 'Turn On Enforcement'}
        </button>
      </div>

      {msg && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: msg.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msg.ok ? '#bbf7d0' : '#fecaca'}`, fontSize: 13, color: msg.ok ? '#16a34a' : '#dc2626' }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16 }}>
        {/* Role list */}
        <div style={{ width: 260, flexShrink: 0, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', maxHeight: 560, overflowY: 'auto' }}>
          {sortedRoles.map((r, i) => {
            const prevDept = i > 0 ? sortedRoles[i - 1].department : null;
            return (
              <div key={r.role_code}>
                {r.department !== prevDept && (
                  <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', background: '#f8fafc' }}>{r.department}</div>
                )}
                <button onClick={() => setSelectedRoleCode(r.role_code)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none', cursor: 'pointer',
                    background: r.role_code === selectedRoleCode ? '#eff6ff' : 'transparent', borderBottom: '1px solid #f1f5f9',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                  <span style={{ fontSize: 12, fontWeight: r.role_code === selectedRoleCode ? 700 : 600, color: r.role_code === selectedRoleCode ? '#1d4ed8' : '#374151' }}>{r.role_name}</span>
                  {r.user_count > 0 && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8' }}>{r.user_count}</span>}
                </button>
              </div>
            );
          })}
          {sortedRoles.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading roles…</div>}
        </div>

        {/* Permission grid for selected role */}
        <div style={{ flex: 1, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 18 }}>
          {selectedRole ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{selectedRole.role_name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{selectedRole.role_code} · {selectedRole.user_count} user{selectedRole.user_count !== 1 ? 's' : ''} currently assigned</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={resetDraft} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>
                    <RotateCcw size={12} /> Reset
                  </button>
                  <button onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', border: 'none', borderRadius: 8, background: '#1e40af', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
                    <Save size={12} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 18, padding: '12px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
                <Eye size={16} style={{ color: '#64748b', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Job visibility</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Which requisitions this role sees on Requisitions, Pipeline, and the Dashboard.</div>
                </div>
                <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setVisibility('all')} disabled={savingVisibility}
                    style={{
                      padding: '6px 12px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      background: selectedRole.job_visibility_scope === 'all' ? '#1e40af' : '#fff',
                      color: selectedRole.job_visibility_scope === 'all' ? '#fff' : '#64748b',
                    }}>All jobs</button>
                  <button onClick={() => setVisibility('assigned_only')} disabled={savingVisibility}
                    style={{
                      padding: '6px 12px', border: 'none', borderLeft: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      background: selectedRole.job_visibility_scope === 'assigned_only' ? '#1e40af' : '#fff',
                      color: selectedRole.job_visibility_scope === 'assigned_only' ? '#fff' : '#64748b',
                    }}>Assigned jobs only</button>
                </div>
              </div>

              <div>
                {groups.map(g => {
                  const isOpen = !!openGroups[g.id];
                  const allGranted = isGroupFullyGranted(g.features);
                  const grantedCount = g.features.filter(f => draft[f.key]?.length).length;
                  return (
                    <div key={g.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }} data-testid={`perm-group-${g.id}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: '#f8fafc', cursor: 'pointer' }}
                        onClick={() => toggleGroupOpen(g.id)}>
                        {isOpen ? <ChevronDown size={14} style={{ color: '#64748b', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: '#64748b', flexShrink: 0 }} />}
                        <div style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>
                          {g.label} <span style={{ fontWeight: 500, color: '#94a3b8' }}>({grantedCount}/{g.features.length} granted)</span>
                        </div>
                        <button
                          data-testid={`perm-group-all-${g.id}`}
                          onClick={e => { e.stopPropagation(); toggleGroupAll(g.features); }}
                          title={allGranted ? `Clear all access in ${g.label}` : `Grant full access to every feature in ${g.label}`}
                          style={{
                            padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                            background: allGranted ? '#1e40af' : '#fff', color: allGranted ? '#fff' : '#64748b',
                            border: `1px solid ${allGranted ? '#1e40af' : '#e2e8f0'}`,
                          }}>
                          {allGranted ? '✓ All' : 'All'}
                        </button>
                      </div>
                      {isOpen && (
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Feature</th>
                                {actions.map(a => (
                                  <th key={a} style={{ textAlign: 'center', padding: '6px 10px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{a}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {g.features.map(f => (
                                <tr key={f.key} data-testid={`perm-feature-${f.key}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{f.label}</td>
                                  {actions.map(a => (
                                    <td key={a} style={{ textAlign: 'center', padding: '8px 10px' }}>
                                      <button onClick={() => toggleAction(f.key, a)}
                                        title={`${f.label} — ${a}`}
                                        style={{
                                          width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
                                          border: hasAction(f.key, a) ? '1px solid #86efac' : '1px solid #e2e8f0',
                                          background: hasAction(f.key, a) ? '#f0fdf4' : '#fff',
                                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                                        }}>
                                        {hasAction(f.key, a) ? <Check size={13} style={{ color: '#16a34a' }} /> : null}
                                      </button>
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
                {groups.length === 0 && (
                  <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading features…</div>
                )}
              </div>
            </>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Select a role on the left</div>
          )}
        </div>
      </div>

      <PermissionActivityLog />
    </div>
  );
}

function PermissionActivityLog() {
  const { data: log } = useFetch<any[]>('/roles/permission-log?days=14');
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Activity size={16} style={{ color: '#7c3aed' }} />
        <h2 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Activity Log — last 14 days</h2>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        Every time a role's real permissions didn't cover a feature/action it tried to use — whether or not enforcement is on. Review this before turning enforcement on, so you don't lock out something people actually use.
      </p>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {(log || []).length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No gaps logged in the last 14 days.</div>
        )}
        {(log || []).length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Feature</th>
                <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Action</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Attempts</th>
                <th style={{ textAlign: 'right', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Users</th>
                <th style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {(log || []).map((r: any, i: number) => (
                <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#1e293b' }}>{r.role_code || '—'}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#374151' }}>{r.feature}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#374151' }}>{r.action}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#374151', textAlign: 'right' }}>{r.attempts}</td>
                  <td style={{ padding: '8px 14px', fontSize: 12, color: '#374151', textAlign: 'right' }}>{r.distinct_users}</td>
                  <td style={{ padding: '8px 14px', fontSize: 11, color: '#94a3b8' }}>{new Date(r.last_seen).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
