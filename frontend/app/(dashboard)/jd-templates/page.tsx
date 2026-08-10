'use client';
import { useState } from 'react';
import { FileText, Search, Plus, ChevronRight, Copy } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch, apiFetch } from '@/lib/useFetch';

const ROLE_LEVELS = ['junior', 'mid', 'senior', 'lead', 'manager'];

export default function JdTemplatesPage() {
  const [search,setSearch]=useState(''); const [cat,setCat]=useState('');
  const {data:templates,loading,refetch}=useFetch<any[]>(`/jd-templates${cat?`?category=${cat}`:''}`);
  const {data:cats}=useFetch<any[]>('/jd-templates/categories/list');
  const [selected,setSelected]=useState<any>(null);
  const [selLoading,setSelLoading]=useState(false);
  const [creating,setCreating]=useState(false);
  const [saving,setSaving]=useState(false);
  const [form,setForm]=useState({ title:'', category:'IT', role_level:'mid', skills_required:'', experience_min:0, experience_max:'', jd_text:'' });
  const filtered=(templates||[]).filter(t=>!search||t.title.toLowerCase().includes(search.toLowerCase()));

  // BUG FIX (2026-08-10 audit): the list endpoint deliberately omits
  // jd_text (keeps the list lightweight), so selecting straight from the
  // list row made "selected.jd_text" undefined — the preview pane was
  // always blank and "Copy JD" copied the literal string "undefined".
  // GET /jd-templates/{id} has jd_text AND is the endpoint that increments
  // usage_count — calling it on select fixes both bugs in the same motion
  // (usage_count was stuck at 0 for the same underlying reason: nothing
  // ever called the detail endpoint).
  async function selectTemplate(row: any) {
    setSelLoading(true);
    setCreating(false);
    try {
      const full = await apiFetch(`/jd-templates/${row.id}`);
      setSelected(full);
    } catch {
      setSelected(row);
    } finally { setSelLoading(false); }
  }

  async function createTemplate() {
    if (!form.title || !form.jd_text) { alert('Title and JD text are required'); return; }
    setSaving(true);
    try {
      const skills_required = form.skills_required.split(',').map(s => s.trim()).filter(Boolean);
      const body: any = { ...form, skills_required, experience_max: form.experience_max ? Number(form.experience_max) : null };
      const created = await apiFetch('/jd-templates', { method: 'POST', body: JSON.stringify(body) });
      setCreating(false);
      setForm({ title:'', category:'IT', role_level:'mid', skills_required:'', experience_min:0, experience_max:'', jd_text:'' });
      refetch();
      setSelected(created);
    } catch (e: any) {
      alert(e?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  return(
    <div className="space-y-6" data-testid="jd-templates-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50"><FileText className="h-5 w-5 text-blue-600"/></div>
          <div><h1 className="text-2xl font-bold text-gray-900">JD Template Library</h1>
          <p className="text-sm text-gray-500">{templates?.length||0} templates · Click to use or copy</p></div>
        </div>
        <button onClick={() => { setCreating(true); setSelected(null); }} data-testid="new-jd-template-btn"
          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New Template
        </button>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search templates..." className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"/></div>
        <select value={cat} onChange={e=>setCat(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {(cats||[]).map((c:any)=><option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-2">
          {loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:filtered.map((t:any)=>(
            <Card key={t.id} data-testid="jd-template-row" className={`cursor-pointer transition-all ${selected?.id===t.id?'ring-2 ring-blue-500':''}`}
              onClick={()=>selectTemplate(t)}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div><div className="font-medium text-sm text-gray-900">{t.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{t.category} · {t.role_level} · {t.experience_min}-{t.experience_max||'∞'}yr</div>
                  </div><ChevronRight className="h-4 w-4 text-gray-300"/>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {(t.skills_required||[]).slice(0,3).map((s:string)=>(
                    <span key={s} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{s}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="lg:col-span-2">
          {creating ? (
            <Card>
              <CardHeader><h2 className="font-semibold text-gray-900">New JD Template</h2></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Title</label>
                  <input value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. DevOps Engineer" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Category</label>
                    <input value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}
                      className="w-full border rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Role Level</label>
                    <select value={form.role_level} onChange={e=>setForm(f=>({...f,role_level:e.target.value}))}
                      className="w-full border rounded-lg px-3 py-2 text-sm">
                      {ROLE_LEVELS.map(r=><option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">Exp min-max (yrs)</label>
                    <div className="flex gap-1">
                      <input type="number" value={form.experience_min} onChange={e=>setForm(f=>({...f,experience_min:Number(e.target.value)}))}
                        className="w-full border rounded-lg px-2 py-2 text-sm" />
                      <input type="number" value={form.experience_max} onChange={e=>setForm(f=>({...f,experience_max:e.target.value}))}
                        className="w-full border rounded-lg px-2 py-2 text-sm" placeholder="∞" />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">Skills (comma separated)</label>
                  <input value={form.skills_required} onChange={e=>setForm(f=>({...f,skills_required:e.target.value}))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Python, AWS, Docker" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">JD Text</label>
                  <textarea value={form.jd_text} onChange={e=>setForm(f=>({...f,jd_text:e.target.value}))}
                    rows={12} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={createTemplate} disabled={saving} data-testid="save-jd-template-btn"
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={()=>setCreating(false)} className="border px-4 py-2 rounded-lg text-sm">Cancel</button>
                </div>
              </CardContent>
            </Card>
          ) : selLoading ? (
            <Card className="h-64 flex items-center justify-center"><Spinner size="lg" /></Card>
          ) : selected?(
            <Card className="h-full">
              <CardHeader><div className="flex items-center justify-between">
                <div><h2 className="font-semibold text-gray-900">{selected.title}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{selected.category} · {selected.role_level} · Used {selected.usage_count} times</p>
                </div>
                <button data-testid="copy-jd-btn" onClick={()=>{navigator.clipboard.writeText(selected.jd_text||'');alert('JD copied!');}}
                  className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700">
                  <Copy className="h-3 w-3"/>Copy JD
                </button>
              </div></CardHeader>
              <CardContent><pre data-testid="jd-text-preview" className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{selected.jd_text}</pre></CardContent>
            </Card>
          ):(
            <Card className="h-64 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-30"/>
                <p className="text-sm">Select a template to preview</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
