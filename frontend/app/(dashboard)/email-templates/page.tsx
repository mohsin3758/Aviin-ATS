'use client';
import { useState } from 'react';
import { safeSanitizeHtml } from '@/lib/sanitize';
import { Mail, Search, Plus, ChevronRight, Copy, Pencil, Lock, Eye } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch, apiFetch } from '@/lib/useFetch';

const CATEGORIES = ['follow_up', 'interview_invite', 'offer', 'rejection', 'shortlist', 'onboarding'];
// Full variable set found across the 6 real seeded templates (2026-08-10 audit) —
// shown as insertable chips so a recruiter never has to guess a placeholder name.
const KNOWN_VARS = [
  'candidate_name', 'role', 'client_name', 'company', 'recruiter_name', 'recruiter_phone',
  'ctc', 'date', 'time', 'mode', 'meeting_link', 'interviewer_name', 'joining_date', 'location',
];

interface Tmpl {
  id: string; name: string; category: string; subject: string; body_html: string;
  variables: string[]; is_system: boolean; sent_count: number;
}

export default function EmailTemplatesPage() {
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const { data: templates, loading, refetch } = useFetch<Tmpl[]>(`/email-templates${cat ? `?category=${cat}` : ''}`);
  const [selected, setSelected] = useState<Tmpl | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'follow_up', subject: '', body_html: '', variables: '' });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body_html: string } | null>(null);

  const list = templates || [];
  const filtered = list.filter(t => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  function openEdit(t: Tmpl) {
    setSelected(t);
    setCreating(false);
    setEditing(true);
    setForm({ name: t.name, category: t.category, subject: t.subject, body_html: t.body_html, variables: (t.variables || []).join(', ') });
    setPreview(null);
  }

  function openCreate() {
    setSelected(null);
    setCreating(true);
    setEditing(true);
    setForm({ name: '', category: 'follow_up', subject: '', body_html: '', variables: '' });
    setPreview(null);
  }

  async function save() {
    setSaving(true);
    try {
      const variables = form.variables.split(',').map(v => v.trim()).filter(Boolean);
      if (creating) {
        await apiFetch('/email-templates', { method: 'POST', body: JSON.stringify({ ...form, variables }) });
      } else if (selected) {
        await apiFetch(`/email-templates/${selected.id}`, { method: 'PUT', body: JSON.stringify({ subject: form.subject, body_html: form.body_html }) });
      }
      setEditing(false); setCreating(false); setSelected(null);
      refetch();
    } catch (e: any) {
      alert(e?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  async function runPreview(t: Tmpl) {
    const sample: Record<string, string> = {
      candidate_name: 'Ravi Kumar', role: 'Senior Backend Developer', client_name: 'Acme Corp',
      company: 'Aviin Tech', recruiter_name: 'Neha Joshi', recruiter_phone: '+91-98765-43210',
      ctc: '12,00,000', date: '15 Aug 2026', time: '03:30 PM', mode: 'Video', meeting_link: 'https://meet.google.com/abc-defg',
      interviewer_name: 'Amit Shah', joining_date: '01 Sep 2026', location: 'Bangalore',
    };
    try {
      const r = await apiFetch(`/email-templates/${t.id}/preview`, { method: 'POST', body: JSON.stringify(sample) });
      setPreview(r);
    } catch { setPreview(null); }
  }

  function insertVar(v: string) {
    setForm(f => ({ ...f, body_html: f.body_html + `{${v}}` }));
  }

  return (
    <div className="space-y-6" data-testid="email-templates-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50"><Mail className="h-5 w-5 text-blue-600" /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Email Template Engine</h1>
            <p className="text-sm text-gray-500">{list.length} templates · click a template to preview, or create your own</p>
          </div>
        </div>
        <button onClick={openCreate} data-testid="new-template-btn"
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New Template
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates..."
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm" />
        </div>
        <select value={cat} onChange={e => setCat(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-2">
          {loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : filtered.map(t => (
            <Card key={t.id} data-testid="email-template-row"
              className={`cursor-pointer transition-all ${selected?.id === t.id && !editing ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => { setSelected(t); setEditing(false); runPreview(t); }}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm text-gray-900 flex items-center gap-1.5">
                      {t.name} {t.is_system && <Lock className="h-3 w-3 text-gray-400" />}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{t.category.replace('_', ' ')} · used {t.sent_count || 0}x</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="lg:col-span-2">
          {editing ? (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-gray-900">{creating ? 'New Template' : `Edit: ${selected?.name}`}</h2>
              </CardHeader>
              <CardContent className="space-y-3">
                {creating && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Name</label>
                      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Second-Round Invite" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">Category</label>
                      <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                        className="w-full border rounded-lg px-3 py-2 text-sm">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Subject</label>
                  <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Interview scheduled: {role} on {date}" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Body (HTML)</label>
                  <textarea value={form.body_html} onChange={e => setForm(f => ({ ...f, body_html: e.target.value }))}
                    rows={8} className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
                {creating && (
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Declared variables (comma separated)</label>
                    <input value={form.variables} onChange={e => setForm(f => ({ ...f, variables: e.target.value }))}
                      className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="candidate_name, role, date" />
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Insert placeholder</label>
                  <div className="flex flex-wrap gap-1.5">
                    {KNOWN_VARS.map(v => (
                      <button key={v} type="button" onClick={() => insertVar(v)}
                        className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded hover:bg-blue-100">{`{${v}}`}</button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={save} disabled={saving} data-testid="save-template-btn"
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => { setEditing(false); setCreating(false); }}
                    className="border px-4 py-2 rounded-lg text-sm">Cancel</button>
                </div>
              </CardContent>
            </Card>
          ) : selected ? (
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900">{selected.name}</h2>
                    <p className="text-xs text-gray-400 mt-0.5">{selected.category.replace('_', ' ')} · used {selected.sent_count || 0} times</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => runPreview(selected)}
                      className="flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">
                      <Eye className="h-3 w-3" /> Preview with sample data
                    </button>
                    {!selected.is_system && (
                      <button onClick={() => openEdit(selected)}
                        className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700">
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                    )}
                    <button onClick={() => { navigator.clipboard.writeText(selected.body_html); }}
                      className="flex items-center gap-1.5 border px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-50">
                      <Copy className="h-3 w-3" /> Copy HTML
                    </button>
                  </div>
                </div>
                {selected.is_system && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1"><Lock className="h-3 w-3" /> System template — create a new one to customize.</p>
                )}
              </CardHeader>
              <CardContent>
                {preview ? (
                  <div data-testid="template-preview" className="border rounded-lg p-4 bg-gray-50">
                    <div className="text-xs text-gray-400 mb-1">Subject (with sample data)</div>
                    <div className="text-sm font-semibold text-gray-800 mb-3">{preview.subject}</div>
                    <div className="text-xs text-gray-400 mb-1">Body</div>
                    {/* QA sweep (2026-09-01) defense-in-depth — this
                        specific call site only ever sends fixed sample
                        data (never real candidate data), so it's not
                        itself exploitable, but the backend preview
                        endpoint's substitution has no escaping and
                        accepts arbitrary variables from any caller;
                        sanitizing here costs nothing and closes that off
                        regardless of what future caller might send. */}
                    <div className="text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: safeSanitizeHtml(preview.body_html) }} />
                  </div>
                ) : (
                  <div className="text-sm text-gray-400">Loading preview...</div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="h-64 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <Mail className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a template to preview, or create a new one.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
