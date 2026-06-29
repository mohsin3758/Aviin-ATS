'use client';
import { useState } from 'react';
import { Sparkles, TrendingUp, AlertTriangle, Target } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';

const GRADE_COLOR:Record<string,string>={'A+':'bg-emerald-100 text-emerald-700 font-bold','A':'bg-green-100 text-green-700 font-bold','B':'bg-blue-100 text-blue-700 font-bold','C':'bg-amber-100 text-amber-700','D':'bg-red-100 text-red-600'};
function KpiCard({icon:Icon,label,value,color,bg}:any){return(<Card><CardContent className="flex items-center gap-3 py-5"><div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}><Icon className="h-5 w-5"/></div><div className="min-w-0"><p className="text-xl font-bold text-gray-900 truncate">{value===null?<Spinner size="sm"/>:value}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p></div></CardContent></Card>);}

export default function PredictionsPage(){
  const {data:stats,loading:statsLoading}=useFetch<any>('/predictions/stats');
  const {data:predictions,loading,refetch}=useFetch<any[]>('/predictions');
  const [running,setRunning]=useState(false);

  async function runBulk(){
    setRunning(true);
    try{await apiFetch('/predictions/bulk',{method:'POST',body:JSON.stringify({limit:100})});refetch();}
    catch(e:any){alert(e.message);}
    finally{setRunning(false);}
  }

  return(
    <div className="space-y-6" data-testid="predictions-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[--color-primary]/10"><Sparkles className="h-5 w-5 text-[--color-primary]"/></div>
          <div><h1 className="text-2xl font-bold text-gray-900">P21 Predictive Hiring</h1><p className="text-sm text-gray-500">scikit-learn LogisticRegression · Zero external LLM · Local ML</p></div>
        </div>
        <button onClick={runBulk} disabled={running} className="bg-[--color-primary] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2">
          {running?<Spinner size="sm"/>:<Sparkles className="h-4 w-4"/>} Run Bulk Predictions
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="prediction-kpis">
        <KpiCard icon={Target} label="Total Predictions" color="text-blue-600" bg="bg-blue-50" value={statsLoading?null:stats?.total_predictions}/>
        <KpiCard icon={TrendingUp} label="Avg Placement Prob" color="text-green-600" bg="bg-green-50" value={statsLoading?null:(stats?.avg_placement_prob!=null?`${stats.avg_placement_prob}%`:null)}/>
        <KpiCard icon={Sparkles} label="High Confidence (A/A+)" color="text-purple-600" bg="bg-purple-50" value={statsLoading?null:stats?.high_confidence}/>
        <KpiCard icon={AlertTriangle} label="Offer Drop Risk" color="text-amber-600" bg="bg-amber-50" value={statsLoading?null:stats?.offer_drop_risk}/>
      </div>
      <Card>
        <CardHeader><h2 className="font-semibold text-gray-800">Placement Predictions</h2><p className="text-xs text-gray-400 mt-0.5">Trained on historical placements. Falls back to rule-based scoring when training data insufficient.</p></CardHeader>
        <CardContent className="p-0">
          {loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
            <Table><Thead><tr><Th>Candidate</Th><Th>Placement Prob</Th><Th>Offer Drop Risk</Th><Th>Grade</Th><Th>Model</Th><Th>Outcome</Th></tr></Thead>
              <Tbody>
                {!predictions?.length?<Tr><Td colSpan={6} className="text-center text-gray-400 py-10 text-sm">No predictions. Click "Run Bulk Predictions" or POST /predictions/predict.</Td></Tr>:predictions.map(p=>(
                  <Tr key={p.id}>
                    <Td className="font-medium text-sm">{p.full_name}</Td>
                    <Td><div className="flex items-center gap-2"><div className="w-20 bg-gray-200 rounded-full h-2"><div className={`h-2 rounded-full ${p.placement_prob>=0.7?'bg-green-500':p.placement_prob>=0.5?'bg-blue-500':'bg-gray-400'}`} style={{width:`${p.placement_prob*100}%`}}/></div><span className="text-sm font-medium">{(p.placement_prob*100).toFixed(1)}%</span></div></Td>
                    <Td><span className={`text-sm ${p.offer_drop_prob>0.3?'text-red-600 font-medium':'text-gray-500'}`}>{(p.offer_drop_prob*100).toFixed(1)}%</span></Td>
                    <Td><span className={`text-xs px-2 py-0.5 rounded-full ${GRADE_COLOR[p.predicted_grade]||''}`}>{p.predicted_grade}</span></Td>
                    <Td className="text-xs text-gray-400">{p.model_version}</Td>
                    <Td>{p.actual_outcome?<span className={`text-xs px-2 py-0.5 rounded-full ${p.actual_outcome==='placed'?'bg-green-100 text-green-700':p.actual_outcome==='offer_drop'?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-500'}`}>{p.actual_outcome}</span>:<span className="text-xs text-gray-300">—</span>}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
