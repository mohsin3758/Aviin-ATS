'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts';
import { TrendingUp, AlertTriangle, Target, Users } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch } from '@/lib/useFetch';

interface FunnelRow { client_id: string; client_name: string; submittals_count: number; offers_count: number; placements_count: number; }
interface CapacityRow { recruiter_id: string; full_name: string; capacity_weekly: number; active_assignments: number; utilization_pct: number; }
interface SkillGapRow { skill: string; demand_count: number; supply_count: number; gap: number; }
interface RedeployRow { candidate_name: string; client_name: string; end_date: string; days_remaining: number; }

const COLOR_PRIMARY = '#4f46e5';
const COLOR_SECONDARY = '#10b981';
const COLOR_AMBER = '#f59e0b';
const COLOR_RED = '#ef4444';

function utilColor(pct: number): string {
  if (pct >= 90) return COLOR_RED;
  if (pct >= 70) return COLOR_AMBER;
  return COLOR_SECONDARY;
}

export default function AnalyticsPage() {
  const { data: funnel, loading: funnelLoading } = useFetch<FunnelRow[]>('/analytics/agency-funnel');
  const { data: capacity, loading: capLoading } = useFetch<CapacityRow[]>('/analytics/recruiter-capacity');
  const { data: skillGap, loading: gapLoading } = useFetch<SkillGapRow[]>('/analytics/skill-gap');
  const { data: redeployQueue } = useFetch<RedeployRow[]>('/analytics/redeployment-queue');

  // Rule-based predictive models (zero-token)
  const hiringDifficulty = skillGap
    ? skillGap.filter(s => s.gap > 0).slice(0, 5).map(s => ({
        skill: s.skill,
        difficulty: Math.min(Math.round((s.gap / Math.max(s.demand_count, 1)) * 100), 100),
        demand: s.demand_count,
        supply: s.supply_count,
      }))
    : [];

  const redeployRisk = redeployQueue
    ? redeployQueue.filter(r => r.days_remaining <= 14)
    : [];

  const totalPlacements = funnel?.reduce((s, r) => s + (r.placements_count ?? 0), 0) ?? 0;
  const totalSubmittals = funnel?.reduce((s, r) => s + (r.submittals_count ?? 0), 0) ?? 0;
  const conversionRate = totalSubmittals > 0
    ? Math.round((totalPlacements / totalSubmittals) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">T4 Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Business intelligence — rule-based, zero-token</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="analytics-kpi">
        <MiniStat icon={TrendingUp} label="Placement Rate" value={`${conversionRate}%`} color="text-green-600" bg="bg-green-50" />
        <MiniStat icon={Users} label="Skill Gaps" value={skillGap ? skillGap.filter(s => s.gap > 0).length : '…'} color="text-red-600" bg="bg-red-50" />
        <MiniStat icon={AlertTriangle} label="Redeployment Risk" value={redeployRisk.length} color="text-amber-600" bg="bg-amber-50" />
        <MiniStat icon={Target} label="Avg Utilization" value={capacity ? `${Math.round(capacity.reduce((s, r) => s + r.utilization_pct, 0) / Math.max(capacity.length, 1))}%` : '…'} color="text-blue-600" bg="bg-blue-50" />
      </div>

      {/* Agency Funnel + Recruiter Capacity side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Agency Funnel by Client</h2>
            <p className="text-xs text-gray-400 mt-0.5">Submittals → Offers → Placements</p>
          </CardHeader>
          <CardContent>
            {funnelLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <div data-testid="funnel-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={funnel ?? []} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="client_name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="submittals_count" name="Submittals" fill={COLOR_PRIMARY} radius={[3,3,0,0]} />
                    <Bar dataKey="offers_count" name="Offers" fill={COLOR_AMBER} radius={[3,3,0,0]} />
                    <Bar dataKey="placements_count" name="Placements" fill={COLOR_SECONDARY} radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Recruiter Utilization</h2>
            <p className="text-xs text-gray-400 mt-0.5">Active assignments vs weekly capacity</p>
          </CardHeader>
          <CardContent>
            {capLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <div data-testid="capacity-chart">
                <ResponsiveContainer width="100%" height={220}>
                <BarChart data={capacity ?? []} margin={{ top: 5, right: 10, left: -20, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="full_name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="utilization_pct" name="Utilization %" radius={[3,3,0,0]}>
                    {(capacity ?? []).map((r, i) => (
                      <Cell key={i} fill={utilColor(r.utilization_pct)} />
                    ))}
                  </Bar>
                </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Skill Gap + Predictive Models */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Skill Demand vs Supply</h2>
            <p className="text-xs text-gray-400 mt-0.5">Open requisition skills vs candidate pool</p>
          </CardHeader>
          <CardContent>
            {gapLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <div data-testid="skill-gap-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={(skillGap ?? []).slice(0, 10)}
                    margin={{ top: 5, right: 10, left: -20, bottom: 50 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="skill" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="demand_count" name="Demand" fill={COLOR_PRIMARY} radius={[3,3,0,0]} />
                    <Bar dataKey="supply_count" name="Supply" fill={COLOR_SECONDARY} radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Target className="h-4 w-4 text-red-500" />
              Hiring Difficulty Forecast
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Rule-based: gap / demand ratio · zero-token</p>
          </CardHeader>
          <CardContent className="p-0" data-testid="difficulty-panel">
            <Table>
              <Thead>
                <tr>
                  <Th>Skill</Th>
                  <Th>Demand</Th>
                  <Th>Supply</Th>
                  <Th>Difficulty</Th>
                </tr>
              </Thead>
              <Tbody>
                {hiringDifficulty.length === 0 ? (
                  <Tr><Td colSpan={4} className="text-center text-gray-400 py-6">No skill gaps detected</Td></Tr>
                ) : hiringDifficulty.map(h => (
                  <Tr key={h.skill}>
                    <Td className="font-medium text-gray-800">{h.skill}</Td>
                    <Td>{h.demand}</Td>
                    <Td>{h.supply}</Td>
                    <Td>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        h.difficulty >= 80 ? 'bg-red-100 text-red-700' :
                        h.difficulty >= 50 ? 'bg-amber-100 text-amber-700' :
                        'bg-yellow-50 text-yellow-700'
                      }`}>
                        {h.difficulty}% hard
                      </span>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Redeployment risk */}
      {redeployRisk.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Redeployment Risk Alert
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Contractors ending in ≤14 days — act now</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <Thead><tr><Th>Candidate</Th><Th>Client</Th><Th>Days Left</Th></tr></Thead>
              <Tbody>
                {redeployRisk.map((r, i) => (
                  <Tr key={i}>
                    <Td className="font-medium text-gray-800">{r.candidate_name}</Td>
                    <Td>{r.client_name ?? '—'}</Td>
                    <Td>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.days_remaining <= 7 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {r.days_remaining}d
                      </span>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, color, bg }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number; color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
