'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { authHeaders, API } from '@/lib/auth';
import { EditableCell } from '@/components/sourcing-tracker/EditableCell';
import { ProjectDetailsCell } from '@/components/sourcing-tracker/ProjectDetailsCell';
import { Modal } from '@/components/ui/Modal';
import { Plus, Download } from 'lucide-react';

// Sourcing Tracker — ATS-internal, spreadsheet-styled grid for the
// sourcing-through-role-assignment workflow (5 recruiters, ~60+ profiles
// per role). Built entirely on existing tables/endpoints
// (candidates/applications/requisitions/clients) plus two new candidate
// columns (sourcing_status, remarks) — no external API, no new grid
// library, no Google Sheets integration. See
// docs/recruitment-workflow-gap-analysis.md for the audit this came from.
//
// Phase 1 follow-ups added 2026-09-18 (reported live: "build the all gaps
// and complete it"): multi-select + bulk client/role assignment, bulk
// sourcing-status set, column sorting (reuses the same sort_by allow-list
// GET /candidates already enforces), CSV export (same client-side pattern
// resume-inbox/page.tsx already uses), a real Project Details count, and
// an optional resume upload on Quick Add.

const SOURCING_STATUSES = [
  { value: 'sourced', label: 'Sourced' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'whatsapp_sent', label: 'WhatsApp Sent' },
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'screening_pending', label: 'Screening Pending' },
  { value: 'screening_completed', label: 'Screening Completed' },
  { value: 'qualified', label: 'Qualified' },
];
const STATUS_LABEL = Object.fromEntries(SOURCING_STATUSES.map(s => [s.value, s.label]));
const SORTABLE = new Set(['full_name', 'total_exp_mo', 'expected_ctc']); // matches candidates.py's ALLOWED sort_by set

const th: React.CSSProperties = { padding: '8px 10px', background: '#1E3A8A', color: '#fff', textAlign: 'left', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', position: 'sticky', top: 0 };
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', fontSize: 12 };
const selSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: '#fff' };
const inputSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: '#fff' };
const esc = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

// Multipart upload, same shape as candidates/page.tsx's uploadCandidateDocument
// — apiFetch hardcodes JSON content-type so can't carry FormData.
async function uploadResume(candidateId: string, file: File) {
  const fd = new FormData();
  fd.append('document_type', 'resume');
  fd.append('file', file);
  const resp = await fetch(`${API}/candidates/${candidateId}/upload-document`, { method: 'POST', headers: authHeaders(), body: fd });
  if (!resp.ok) { const t = await resp.json().catch(() => ({})); throw new Error(t?.detail || 'Resume upload failed: ' + resp.status); }
  return resp.json();
}

export default function SourcingTrackerPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [search, setSearch] = useState('');
  const [ownedFilter, setOwnedFilter] = useState('mine');
  const [statusFilter, setStatusFilter] = useState('');
  const [filterClientId, setFilterClientId] = useState('');
  const [filterReqId, setFilterReqId] = useState('');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>({ by: 'created_at', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkClientId, setBulkClientId] = useState('');
  const [bulkReqId, setBulkReqId] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');

  const { data: clients } = useFetch<any[]>(mounted ? '/clients' : null);
  const { data: filterReqs } = useFetch<any[]>(mounted && filterClientId ? `/requisitions?client_id=${filterClientId}&status=open` : null);
  const { data: bulkReqs } = useFetch<any[]>(mounted && bulkClientId ? `/requisitions?client_id=${bulkClientId}&status=open` : null);
  const { data: stageConfig } = useFetch<any[]>(mounted ? '/settings/pipeline-stages' : null);
  const liveStages = (stageConfig || [])
    .filter((s: any) => s.is_visible)
    .sort((a: any, b: any) => a.display_order - b.display_order);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set('search', search.trim());
    if (ownedFilter) p.set('owned', ownedFilter);
    if (statusFilter) p.set('sourcing_status', statusFilter);
    if (filterReqId) p.set('requisition_id', filterReqId);
    p.set('limit', '200');
    p.set('sort_by', sort.by);
    p.set('sort_dir', sort.dir);
    return p.toString();
  }, [search, ownedFilter, statusFilter, filterReqId, sort]);

  const { data, loading, refetch } = useFetch<any>(mounted ? `/candidates?${qs}` : null);
  const items: any[] = data?.items || [];

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  async function patchField(candidateId: string, field: string, value: any) {
    await apiFetch(`/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
    refetch();
  }

  function handleSort(col: string) {
    if (!SORTABLE.has(col)) return;
    setSort(s => (s.by === col ? { by: col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by: col, dir: 'desc' }));
  }

  const allSelected = items.length > 0 && items.every(i => selected.has(i.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)));
  const toggleSel = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  async function bulkAssignRole() {
    if (!bulkReqId || !selected.size) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    // No bulk endpoint exists for (many candidates, one requisition) — each
    // is its own POST /applications, same pattern already used by
    // assignments/page.tsx's QuickAssignForm, so one already-linked
    // candidate (409) doesn't block the rest.
    const outcomes = await Promise.allSettled(
      ids.map(id => apiFetch('/applications', { method: 'POST', body: JSON.stringify({ candidate_id: id, requisition_id: bulkReqId }) }))
    );
    const ok = outcomes.filter(o => o.status === 'fulfilled').length;
    const failed = outcomes.length - ok;
    showToast(`Assigned ${ok} candidate${ok === 1 ? '' : 's'} to the role` + (failed ? ` (${failed} already linked or failed)` : ''), failed === 0);
    setBulkBusy(false); setSelected(new Set()); setBulkClientId(''); setBulkReqId('');
    refetch();
  }

  async function bulkSetStatus() {
    if (!bulkStatus || !selected.size) return;
    setBulkBusy(true);
    const ids = Array.from(selected);
    const outcomes = await Promise.allSettled(
      ids.map(id => apiFetch(`/candidates/${id}`, { method: 'PATCH', body: JSON.stringify({ sourcing_status: bulkStatus }) }))
    );
    const ok = outcomes.filter(o => o.status === 'fulfilled').length;
    showToast(`Updated status on ${ok} candidate${ok === 1 ? '' : 's'}`, true);
    setBulkBusy(false); setSelected(new Set()); setBulkStatus('');
    refetch();
  }

  function exportCsv() {
    const rows = selected.size ? items.filter(r => selected.has(r.id)) : items;
    if (!rows.length) { showToast('Nothing to export', false); return; }
    const cols = ['Name', 'Mobile', 'Email', 'Location', 'Total Exp (mo)', 'Current CTC', 'Expected CTC', 'Notice (days)', 'Skills', 'Client', 'Role', 'Stage / Sourcing Status', 'Remarks', 'Owner'];
    const lines = [cols.map(esc).join(',')];
    for (const r of rows) {
      const app = r.active_application;
      lines.push([
        r.full_name || '', r.phone || '', r.email || '', r.location || '', r.total_exp_mo ?? '',
        r.current_ctc ?? '', r.expected_ctc ?? '', r.notice_period_days ?? '', (r.skills || []).join('; '),
        app?.client_name || '', app?.requisition_title || '',
        app ? app.stage : (STATUS_LABEL[r.sourcing_status] || r.sourcing_status),
        r.remarks || '', r.owner?.recruiter_name || '',
      ].map(esc).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sourcing-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Sourcing Tracker</h1>
          <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
            Spreadsheet-style tracking for sourced candidates — click any cell to edit directly.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#fff', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Download size={13} /> Export CSV
          </button>
          <button onClick={() => setQuickAddOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={14} /> Quick Add Candidate
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Search name, email, phone, skill…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputSm, width: 240 }} />
        <select value={ownedFilter} onChange={e => setOwnedFilter(e.target.value)} style={selSm}>
          <option value="mine">My Candidates</option>
          <option value="">Everyone</option>
          <option value="unowned">Unowned</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selSm}>
          <option value="">All Sourcing Statuses</option>
          {SOURCING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={filterClientId} onChange={e => { setFilterClientId(e.target.value); setFilterReqId(''); }} style={selSm}>
          <option value="">Filter by Client…</option>
          {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterReqId} onChange={e => setFilterReqId(e.target.value)} disabled={!filterClientId} style={selSm}>
          <option value="">Filter by Role…</option>
          {(filterReqs || []).map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
          <b>{selected.size} selected</b>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select value={bulkClientId} onChange={e => { setBulkClientId(e.target.value); setBulkReqId(''); }} style={{ ...selSm, fontSize: 11, padding: '5px 8px' }}>
              <option value="">Client…</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={bulkReqId} onChange={e => setBulkReqId(e.target.value)} disabled={!bulkClientId} style={{ ...selSm, fontSize: 11, padding: '5px 8px' }}>
              <option value="">Role…</option>
              {(bulkReqs || []).map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <button onClick={bulkAssignRole} disabled={!bulkReqId || bulkBusy}
              style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: bulkReqId ? '#1e40af' : '#94a3b8', color: '#fff', fontSize: 11, fontWeight: 700, cursor: bulkReqId && !bulkBusy ? 'pointer' : 'not-allowed' }}>
              Assign to Role
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ ...selSm, fontSize: 11, padding: '5px 8px' }}>
              <option value="">Set Sourcing Status…</option>
              {SOURCING_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button onClick={bulkSetStatus} disabled={!bulkStatus || bulkBusy}
              style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: bulkStatus ? '#16a34a' : '#94a3b8', color: '#fff', fontSize: 11, fontWeight: 700, cursor: bulkStatus && !bulkBusy ? 'pointer' : 'not-allowed' }}>
              Apply
            </button>
          </div>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Clear selection</button>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1440 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
              {[
                ['Name', 'full_name'], ['Mobile', null], ['Email', null], ['Location', null],
                ['Total Exp (mo)', 'total_exp_mo'], ['Current CTC', null], ['Expected CTC', 'expected_ctc'],
                ['Notice (days)', null], ['Skills', null], ['Client / Role / Status', null],
                ['Remarks', null], ['Project Details', null], ['Owner', null],
              ].map(([label, col]) => (
                <th key={label as string} style={{ ...th, cursor: col ? 'pointer' : 'default' }} onClick={() => col && handleSort(col as string)}>
                  {label}{col && sort.by === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(row => (
              <TrackerRow
                key={row.id}
                row={row}
                clients={clients || []}
                liveStages={liveStages}
                selected={selected.has(row.id)}
                onToggleSel={() => toggleSel(row.id)}
                onPatch={(field, value) => patchField(row.id, field, value)}
                onChanged={refetch}
                showToast={showToast}
              />
            ))}
          </tbody>
        </table>
        {loading && <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>}
        {!loading && items.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No candidates match these filters yet.</div>
        )}
      </div>

      {quickAddOpen && (
        <QuickAddModal
          onClose={() => setQuickAddOpen(false)}
          onAdded={() => { setQuickAddOpen(false); refetch(); showToast('Candidate added'); }}
          showToast={showToast}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: toast.ok ? '#16a34a' : '#ef4444', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,.15)', zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function TrackerRow({ row, clients, liveStages, selected, onToggleSel, onPatch, onChanged, showToast }: { row: any; clients: any[]; liveStages: any[]; selected: boolean; onToggleSel: () => void; onPatch: (field: string, value: any) => Promise<void>; onChanged: () => void; showToast: (msg: string, ok?: boolean) => void }) {
  return (
    <tr style={{ background: selected ? '#f8fafc' : undefined }}>
      <td style={td}><input type="checkbox" checked={selected} onChange={onToggleSel} /></td>
      <td style={{ ...td, fontWeight: 700 }}>{row.full_name}</td>
      <td style={td}>{row.phone || '—'}</td>
      <td style={td}>{row.email || '—'}</td>
      <td style={td}><EditableCell value={row.location || ''} onSave={v => onPatch('location', v)} placeholder="Location" /></td>
      <td style={td}><EditableCell value={String(row.total_exp_mo ?? '')} variant="number" onSave={v => onPatch('total_exp_mo', v === '' ? null : Number(v))} placeholder="0" /></td>
      <td style={td}><EditableCell value={row.current_ctc != null ? String(row.current_ctc) : ''} variant="number" onSave={v => onPatch('current_ctc', v === '' ? null : Number(v))} placeholder="—" /></td>
      <td style={td}><EditableCell value={row.expected_ctc != null ? String(row.expected_ctc) : ''} variant="number" onSave={v => onPatch('expected_ctc', v === '' ? null : Number(v))} placeholder="—" /></td>
      <td style={td}><EditableCell value={row.notice_period_days != null ? String(row.notice_period_days) : ''} variant="number" onSave={v => onPatch('notice_period_days', v === '' ? null : Number(v))} placeholder="—" /></td>
      <td style={{ ...td, minWidth: 180 }}>
        <EditableCell
          value={(row.skills || []).join(', ')}
          onSave={v => onPatch('skills', v.split(',').map((s: string) => s.trim()).filter(Boolean))}
          placeholder="comma, separated, skills"
        />
      </td>
      <td style={{ ...td, minWidth: 240 }}>
        <ClientRoleStatusCell row={row} clients={clients} liveStages={liveStages} onPatch={onPatch} onChanged={onChanged} showToast={showToast} />
      </td>
      <td style={{ ...td, minWidth: 160 }}><EditableCell value={row.remarks || ''} onSave={v => onPatch('remarks', v)} placeholder="Add a remark" /></td>
      <td style={td}><ProjectDetailsCell candidateId={row.id} candidateName={row.full_name} projectCount={row.project_count} /></td>
      <td style={{ ...td, color: '#64748b' }}>{row.owner?.recruiter_name || '—'}</td>
    </tr>
  );
}

function ClientRoleStatusCell({ row, clients, liveStages, onPatch, onChanged, showToast }: { row: any; clients: any[]; liveStages: any[]; onPatch: (field: string, value: any) => Promise<void>; onChanged: () => void; showToast: (msg: string, ok?: boolean) => void }) {
  const app = row.active_application;
  const [clientId, setClientId] = useState('');
  const [linking, setLinking] = useState(false);
  const { data: reqs } = useFetch<any[]>(clientId ? `/requisitions?client_id=${clientId}&status=open` : null);

  // Once a real role is assigned, sourcing_status is frozen — the real,
  // customizable pipeline stage takes over as the status of record. This
  // is purely a rendering decision (nothing writes to sourcing_status
  // after this point), matching the plan's "hand off cleanly, never both
  // at once" design.
  if (app) {
    return (
      <div>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{app.client_name || '—'}</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{app.requisition_title}</div>
        <select
          value={app.stage}
          onChange={async e => {
            try {
              await apiFetch(`/applications/${app.application_id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: e.target.value }) });
              onChanged();
            } catch (err: any) {
              showToast(err?.message || 'Could not change stage', false);
            }
          }}
          style={{ ...selSm, fontSize: 11, padding: '4px 6px', width: '100%' }}
        >
          {liveStages.map((s: any) => <option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
        </select>
        <div title="Now tracked via pipeline stage, not Sourcing Status" style={{ fontSize: 10, color: '#cbd5e1', marginTop: 3 }}>
          Sourcing Status: {STATUS_LABEL[row.sourcing_status] || row.sourcing_status} (frozen)
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...selSm, fontSize: 11, padding: '4px 6px', flex: 1 }}>
          <option value="">Client…</option>
          {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          disabled={!clientId || linking}
          onChange={async e => {
            const requisitionId = e.target.value;
            if (!requisitionId) return;
            setLinking(true);
            try {
              await apiFetch('/applications', { method: 'POST', body: JSON.stringify({ candidate_id: row.id, requisition_id: requisitionId }) });
              onChanged();
            } catch (err: any) {
              const msg = (err?.message || '').toLowerCase();
              if (msg.includes('409') || msg.includes('already')) {
                onChanged(); // already linked (e.g. race with another tab) — just refresh
              } else {
                showToast(err?.message || 'Could not assign role', false);
              }
            } finally {
              setLinking(false);
            }
          }}
          style={{ ...selSm, fontSize: 11, padding: '4px 6px', flex: 1 }}
          defaultValue=""
        >
          <option value="">Role…</option>
          {(reqs || []).map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </div>
      <EditableCell
        value={row.sourcing_status || 'sourced'}
        variant="select"
        options={SOURCING_STATUSES}
        onSave={v => onPatch('sourcing_status', v)}
        display={STATUS_LABEL[row.sourcing_status] || row.sourcing_status}
      />
    </div>
  );
}

function QuickAddModal({ onClose, onAdded, showToast }: { onClose: () => void; onAdded: () => void; showToast: (msg: string, ok?: boolean) => void }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [skills, setSkills] = useState('');
  const [source, setSource] = useState('linkedin');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [dup, setDup] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Same debounced live-duplicate check the main Candidates page uses
  // (GET /candidates/check-duplicate) — reused as-is, no second dedup
  // implementation.
  useEffect(() => {
    const t = setTimeout(async () => {
      const p = new URLSearchParams();
      if (email.trim()) p.append('email', email.trim());
      if (phone.replace(/\D/g, '').length >= 7) p.append('phone', phone.trim());
      if (!p.toString()) { setDup(null); return; }
      try { setDup(await apiFetch(`/candidates/check-duplicate?${p.toString()}`)); }
      catch { /* non-blocking */ }
    }, 500);
    return () => clearTimeout(t);
  }, [email, phone]);

  const save = async () => {
    if (!fullName.trim()) { setErr('Full name is required'); return; }
    setSaving(true); setErr('');
    try {
      const created = await apiFetch('/candidates', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          skills: skills.split(',').map(s => s.trim()).filter(Boolean),
          source,
        }),
      });
      if (resumeFile) {
        try { await uploadResume(created.id, resumeFile); }
        catch (upErr: any) { showToast('Candidate added, but resume upload failed: ' + (upErr?.message || 'unknown error'), false); }
      }
      onAdded();
    } catch (e: any) {
      setErr(e?.message || 'Could not add candidate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Quick Add Candidate" subtitle="Resume optional — for sourcing off LinkedIn/Naukri/referrals before a resume is in hand">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input style={inputSm} placeholder="Full Name *" value={fullName} onChange={e => setFullName(e.target.value)} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input style={inputSm} placeholder="Mobile" value={phone} onChange={e => setPhone(e.target.value)} />
          <input style={inputSm} placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <input style={inputSm} placeholder="Skills (comma separated)" value={skills} onChange={e => setSkills(e.target.value)} />
        <select style={inputSm} value={source} onChange={e => setSource(e.target.value)}>
          <option value="linkedin">LinkedIn</option>
          <option value="naukri">Naukri</option>
          <option value="referral">Referral</option>
          <option value="database">Internal Database</option>
          <option value="job_board">Job Board</option>
        </select>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Resume (optional)</label>
          <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={e => setResumeFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          {resumeFile && <div style={{ fontSize: 11, color: '#166534', marginTop: 4 }}>✓ {resumeFile.name}</div>}
        </div>
        {dup?.has_duplicate && (
          <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
            Possible duplicate — a candidate with this email/phone may already exist. Saving will still work if this is genuinely a different person.
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: '#ef4444' }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontSize: 13, fontWeight: 500, color: '#374151', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: '#1e40af', color: 'white', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Adding…' : 'Add Candidate'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
