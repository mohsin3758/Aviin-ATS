'use client';
import { useState } from 'react';
import { BookOpen, Search, HelpCircle } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch } from '@/lib/useFetch';
const DIFF_COLOR:Record<string,string>={easy:'bg-green-100 text-green-700',medium:'bg-amber-100 text-amber-700',hard:'bg-red-100 text-red-700'};
const CAT_COLOR:Record<string,string>={tech:'bg-blue-100 text-blue-700',hr:'bg-purple-100 text-purple-700',behavioural:'bg-pink-100 text-pink-700',case:'bg-orange-100 text-orange-700',domain:'bg-teal-100 text-teal-700'};
export default function QuestionBankPage(){
  const [cat,setCat]=useState('');const [diff,setDiff]=useState('');const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<any>(null);
  const {data:questions,loading}=useFetch<any[]>((() => { const p: Record<string,string> = {}; if(cat) p.category=cat; if(diff) p.difficulty=diff; if(search) p.search=search; const qs = Object.keys(p).length ? "?" + new URLSearchParams(p).toString() : ""; return `/question-bank${qs}`; })());
  return(
    <div className="space-y-6" data-testid="question-bank-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-50"><BookOpen className="h-5 w-5 text-teal-600"/></div>
        <div><h1 className="text-2xl font-bold text-gray-900">Interview Question Bank</h1>
        <p className="text-sm text-gray-500">{questions?.length||0} questions · Tech · HR · Behavioural · Case</p></div>
      </div>
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400"/>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search questions..." className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"/></div>
        <select value={cat} onChange={e=>setCat(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Categories</option>
          {['tech','hr','behavioural','case','domain'].map(c=><option key={c} value={c} className="capitalize">{c}</option>)}
        </select>
        <select value={diff} onChange={e=>setDiff(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Levels</option>
          {['easy','medium','hard'].map(d=><option key={d} value={d} className="capitalize">{d}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(questions||[]).map((q:any)=>(
            <Card key={q.id} className={`cursor-pointer transition-all ${selected?.id===q.id?'ring-2 ring-teal-500':''}`} onClick={()=>setSelected(q)}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-2">
                  <HelpCircle className="h-4 w-4 text-gray-400 shrink-0 mt-0.5"/>
                  <div><p className="text-sm text-gray-800 leading-relaxed">{q.question}</p>
                    <div className="flex gap-1.5 mt-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${CAT_COLOR[q.category]||'bg-gray-100 text-gray-600'}`}>{q.category}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${DIFF_COLOR[q.difficulty]||''}`}>{q.difficulty}</span>
                      {q.role_type&&<span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{q.role_type}</span>}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div>
          {selected?(
            <Card className="sticky top-4">
              <CardHeader>
                <div className="flex gap-2 flex-wrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${CAT_COLOR[selected.category]||''}`}>{selected.category}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${DIFF_COLOR[selected.difficulty]||''}`}>{selected.difficulty}</span>
                </div>
              </CardHeader>
              <CardContent>
                <h3 className="font-medium text-gray-900 mb-4 leading-relaxed">{selected.question}</h3>
                {selected.expected_answer&&(
                  <div className="bg-green-50 rounded-xl p-4">
                    <div className="text-xs font-semibold text-green-700 mb-2">💡 Expected Answer / Evaluation Guide</div>
                    <p className="text-sm text-green-800 leading-relaxed">{selected.expected_answer}</p>
                  </div>
                )}
                {selected.tags?.length>0&&(
                  <div className="flex flex-wrap gap-1 mt-3">
                    {selected.tags.map((t:string)=><span key={t} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{t}</span>)}
                  </div>
                )}
              </CardContent>
            </Card>
          ):(
            <Card className="h-48 flex items-center justify-center">
              <div className="text-center text-gray-400"><BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30"/>
                <p className="text-sm">Select a question to see the answer guide</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}