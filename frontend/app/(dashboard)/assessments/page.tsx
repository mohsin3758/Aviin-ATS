'use client';
import { ClipboardCheck, Video, AlertTriangle, CheckCircle2, BarChart3 } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch } from '@/lib/useFetch';

function KpiCard({icon:Icon,label,value,color,bg}:any){return(<Card><CardContent className="flex items-center gap-3 py-5"><div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}><Icon className="h-5 w-5"/></div><div className="min-w-0"><p className="text-xl font-bold text-gray-900 truncate">{value===null?<Spinner size="sm"/>:value}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p></div></CardContent></Card>);}

export default function AssessmentsPage(){
  const {data:stats,loading:statsLoading}=useFetch<any>('/assessments/stats');
  const {data:assessments,loading}=useFetch<any[]>('/assessments');
  const STATUS_COLOR:Record<string,string>={pending:'bg-gray-100 text-gray-500',in_progress:'bg-blue-100 text-blue-700',completed:'bg-green-100 text-green-700',flagged:'bg-red-100 text-red-600'};
  return(
    <div className="space-y-6" data-testid="assessments-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[--color-primary]/10"><ClipboardCheck className="h-5 w-5 text-[--color-primary]"/></div>
        <div><h1 className="text-2xl font-bold text-gray-900">P20 Technical Assessments</h1><p className="text-sm text-gray-500">MCQ · Coding · Video Intelligence · Anti-cheat</p></div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="assessment-kpis">
        <KpiCard icon={ClipboardCheck} label="Total" color="text-blue-600" bg="bg-blue-50" value={statsLoading?null:stats?.total}/>
        <KpiCard icon={CheckCircle2} label="Completed" color="text-green-600" bg="bg-green-50" value={statsLoading?null:stats?.completed}/>
        <KpiCard icon={AlertTriangle} label="Flagged (Anti-cheat)" color="text-red-600" bg="bg-red-50" value={statsLoading?null:stats?.flagged}/>
        <KpiCard icon={Video} label="Video Assessments" color="text-purple-600" bg="bg-purple-50" value={statsLoading?null:stats?.video_count}/>
      </div>
      <Card>
        <CardHeader><h2 className="font-semibold text-gray-800">All Assessments</h2><p className="text-xs text-gray-400 mt-0.5">POST /assessments to create. PATCH /assessments/:id/submit to submit. POST /assessments/:id/video-analysis for video intelligence.</p></CardHeader>
        <CardContent className="p-0">
          {loading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
            <Table><Thead><tr><Th>Candidate</Th><Th>Type</Th><Th>Score</Th><Th>Anti-cheat</Th><Th>Video Conf.</Th><Th>Status</Th></tr></Thead>
              <Tbody>
                {!assessments?.length?<Tr><Td colSpan={6} className="text-center text-gray-400 py-10 text-sm">No assessments yet. POST /assessments to create.</Td></Tr>:assessments.map(a=>(
                  <Tr key={a.id}>
                    <Td className="font-medium text-sm">{a.candidate_name}</Td>
                    <Td><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{a.assessment_type}</span></Td>
                    <Td>{a.score!=null?<span className={`font-bold ${a.score>=70?'text-green-700':a.score>=50?'text-amber-600':'text-red-600'}`}>{a.score}/{a.max_score}</span>:'—'}</Td>
                    <Td className="text-xs">{a.tab_switches>0&&<span className="text-amber-600 mr-1">{a.tab_switches} tabs</span>}{a.suspicious_flag&&<span className="text-red-600 font-medium">⚠ Suspicious</span>}</Td>
                    <Td>{a.confidence_score!=null?<div className="flex items-center gap-1"><div className="w-12 bg-gray-200 rounded-full h-1.5"><div className="bg-purple-600 h-1.5 rounded-full" style={{width:`${a.confidence_score*100}%`}}/></div><span className="text-xs">{(a.confidence_score*100).toFixed(0)}%</span></div>:'—'}</Td>
                    <Td><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[a.status]||''}`}>{a.status}</span></Td>
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
