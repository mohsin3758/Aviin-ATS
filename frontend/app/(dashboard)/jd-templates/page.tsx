'use client';
import { useState } from 'react';
import { FileText, Search, Plus, ChevronRight, Copy } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch } from '@/lib/useFetch';
export default function JdTemplatesPage() {
  const [search,setSearch]=useState(''); const [cat,setCat]=useState('');
  const {data:templates,loading}=useFetch<any[]>(`/jd-templates${cat?`?category=${cat}`:''}`);
  const {data:cats}=useFetch<any[]>('/jd-templates/categories/list');
  const [selected,setSelected]=useState<any>(null);
  const filtered=(templates||[]).filter(t=>!search||t.title.toLowerCase().includes(search.toLowerCase()));
  return(
    <div className="space-y-6" data-testid="jd-templates-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-50"><FileText className="h-5 w-5 text-blue-600"/></div>
        <div><h1 className="text-2xl font-bold text-gray-900">JD Template Library</h1>
        <p className="text-sm text-gray-500">{templates?.length||0} templates · Click to use or copy</p></div>
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
            <Card key={t.id} className={`cursor-pointer transition-all ${selected?.id===t.id?'ring-2 ring-blue-500':''}`}
              onClick={()=>setSelected(t)}>
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
          {selected?(
            <Card className="h-full">
              <CardHeader><div className="flex items-center justify-between">
                <div><h2 className="font-semibold text-gray-900">{selected.title}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">{selected.category} · {selected.role_level} · Used {selected.usage_count} times</p>
                </div>
                <button onClick={()=>{navigator.clipboard.writeText(selected.jd_text);alert('JD copied!');}}
                  className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700">
                  <Copy className="h-3 w-3"/>Copy JD
                </button>
              </div></CardHeader>
              <CardContent><pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{selected.jd_text}</pre></CardContent>
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