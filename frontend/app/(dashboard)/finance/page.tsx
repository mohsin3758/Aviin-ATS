'use client';

import { useState } from 'react';
import {
  DollarSign, Users, TrendingUp, Clock, AlertTriangle,
  FileText, CreditCard, Wallet, Plus, ShieldCheck, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';

type FinTab = 'contractors' | 'timesheets' | 'invoices' | 'payroll';

interface Placement {
  id: string; candidate_id: string; client_id: string;
  candidate_name: string; client_name: string; req_title: string;
  start_date: string; end_date: string | null; bill_rate: number | null;
  pay_rate: number | null; status: string;
}

interface Timesheet {
  id: string; placement_id: string; candidate_id: string;
  candidate_name: string; client_name: string | null;
  week_start: string; week_end: string; regular_hours: number;
  overtime_hours: number; total_hours: number; status: string;
  submitted_at: string | null; approved_at: string | null;
}

interface Invoice {
  id: string; invoice_number: string; invoice_date: string; due_date: string;
  subtotal: number; gst_amount: number; total_amount: number;
  status: string; paid_at: string | null; client_name: string;
}

interface PayrollRun {
  id: string; pay_period_start: string; pay_period_end: string; status: string;
  total_gross: number; total_tds: number; total_pf: number; total_net: number;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  ending_soon: 'bg-amber-100 text-amber-700',
  ended: 'bg-gray-100 text-gray-500',
  converted_fte: 'bg-blue-100 text-blue-700',
};

const TABS: { key: FinTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'contractors', label: 'Contractors', icon: Users },
  { key: 'timesheets', label: 'Timesheets', icon: Clock },
  { key: 'invoices', label: 'Invoices', icon: FileText },
  { key: 'payroll', label: 'Payroll', icon: CreditCard },
];

function fmt(n: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const inputCls = 'text-sm px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-[--color-primary]';
const btnCls = 'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[--color-primary] text-white hover:opacity-90 disabled:opacity-40';

export default function FinancePage() {
  const [tab, setTab] = useState<FinTab>('contractors');
  const { data: placements, loading } = useFetch<Placement[]>('/analytics/active-placements');
  const { data: timesheets, loading: tsLoading, refetch: refetchTs } =
    useFetch<Timesheet[]>(tab === 'timesheets' ? '/erp/timesheets' : null);
  const { data: invoices, loading: invLoading, refetch: refetchInv } =
    useFetch<Invoice[]>(tab === 'invoices' ? '/erp/invoices' : null);
  const { data: payrollRuns, loading: prLoading, refetch: refetchPr } =
    useFetch<PayrollRun[]>(tab === 'payroll' ? '/erp/payroll-runs' : null);
  const { data: clientsRaw } = useFetch<any>(tab === 'invoices' ? '/clients' : null);
  const clients = clientsRaw?.items || clientsRaw || [];

  const active = placements?.filter(p => p.status === 'active') ?? [];
  const endingSoon = placements?.filter(p => p.status === 'ending_soon') ?? [];

  const totalMonthlyBill = active.reduce((s, p) => s + (p.bill_rate ?? 0), 0);
  const totalMonthlyPay = active.reduce((s, p) => s + (p.pay_rate ?? 0), 0);
  const grossMargin = totalMonthlyBill - totalMonthlyPay;
  const marginPct = totalMonthlyBill > 0 ? Math.round((grossMargin / totalMonthlyBill) * 100) : 0;

  async function submitTs(id: string) {
    await apiFetch(`/erp/timesheets/${id}/submit`, { method: 'POST' });
    refetchTs();
  }
  async function approveTs(id: string, status: 'approved' | 'rejected') {
    await apiFetch(`/erp/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({ status }) });
    refetchTs();
  }
  async function markPaid(id: string) {
    await apiFetch(`/erp/invoices/${id}/mark-paid`, { method: 'POST' });
    refetchInv();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[--color-primary]/10">
          <Wallet className="h-5 w-5 text-[--color-primary]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">T6 Finance ERP</h1>
          <p className="text-sm text-gray-500">Contractor billing · timesheet · payroll overview</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="finance-kpis">
        <FinKPI
          icon={Users}
          label="Active Contractors"
          value={loading ? null : active.length}
          color="text-blue-600" bg="bg-blue-50"
        />
        <FinKPI
          icon={DollarSign}
          label="Monthly Bill (INR)"
          value={loading ? null : fmt(totalMonthlyBill)}
          color="text-green-600" bg="bg-green-50"
        />
        <FinKPI
          icon={TrendingUp}
          label={`Gross Margin ${marginPct ? `(${marginPct}%)` : ''}`}
          value={loading ? null : fmt(grossMargin)}
          color="text-purple-600" bg="bg-purple-50"
        />
        <FinKPI
          icon={AlertTriangle}
          label="Ending Soon"
          value={loading ? null : endingSoon.length}
          color="text-amber-600" bg="bg-amber-50"
        />
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-tab={t.key}
            className={[
              'flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2',
              tab === t.key
                ? 'border-[--color-primary] text-[--color-primary]'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Contractors tab */}
      {tab === 'contractors' && (
        <div className="space-y-6">
          <Card data-testid="contractors-panel">
            <CardHeader>
              <h2 className="font-semibold text-gray-800">Contractor Billing Grid</h2>
              <p className="text-xs text-gray-400 mt-0.5">Active contractor engagements · bill rate vs pay rate</p>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center py-10"><Spinner size="lg" /></div>
              ) : (
                <Table>
                  <Thead>
                    <tr>
                      <Th>Contractor</Th>
                      <Th>Client</Th>
                      <Th>Role</Th>
                      <Th>Start</Th>
                      <Th>End</Th>
                      <Th>Bill/Mo</Th>
                      <Th>Pay/Mo</Th>
                      <Th>Margin</Th>
                      <Th>Status</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {(!placements || placements.length === 0) ? (
                      <Tr>
                        <Td colSpan={9} className="text-center text-gray-400 py-10 text-sm">
                          No placements found
                        </Td>
                      </Tr>
                    ) : placements.map(p => {
                      const margin = (p.bill_rate ?? 0) - (p.pay_rate ?? 0);
                      return (
                        <Tr key={p.id}>
                          <Td className="font-medium text-gray-800">{p.candidate_name}</Td>
                          <Td className="text-gray-600 text-sm">{p.client_name}</Td>
                          <Td className="text-gray-500 text-xs max-w-[160px] truncate">{p.req_title}</Td>
                          <Td className="text-xs text-gray-500">{p.start_date}</Td>
                          <Td className="text-xs text-gray-500">{p.end_date ?? '—'}</Td>
                          <Td className="text-sm font-medium text-gray-800">{fmt(p.bill_rate)}</Td>
                          <Td className="text-sm text-gray-600">{fmt(p.pay_rate)}</Td>
                          <Td>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              margin > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {fmt(margin)}
                            </span>
                          </Td>
                          <Td>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[p.status] ?? 'bg-gray-100 text-gray-500'}`}>
                              {p.status.replace('_', ' ')}
                            </span>
                          </Td>
                        </Tr>
                      );
                    })}
                  </Tbody>
                </Table>
              )}
            </CardContent>
          </Card>

          <ContractorPiiForm placements={placements ?? []} />
        </div>
      )}

      {/* Timesheets tab — real ERP data (P12) */}
      {tab === 'timesheets' && (
        <Card data-testid="timesheets-panel">
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Clock className="h-4 w-4" /> Timesheet Management
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Weekly timesheets · draft → submitted → approved → billed
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <NewTimesheetForm placements={placements ?? []} onCreated={refetchTs} />
          </CardContent>
          <CardContent className="p-0 border-t border-gray-100">
            {tsLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Contractor</Th><Th>Client</Th><Th>Week</Th>
                    <Th>Reg hrs</Th><Th>OT hrs</Th><Th>Total</Th><Th>Status</Th><Th>Action</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!timesheets || timesheets.length === 0) ? (
                    <Tr><Td colSpan={8} className="text-center text-gray-400 py-10 text-sm">
                      No timesheets yet — create one above.
                    </Td></Tr>
                  ) : timesheets.map(ts => (
                    <Tr key={ts.id}>
                      <Td className="font-medium text-gray-800">{ts.candidate_name}</Td>
                      <Td className="text-sm text-gray-600">{ts.client_name ?? '—'}</Td>
                      <Td className="text-xs text-gray-500">{ts.week_start} – {ts.week_end}</Td>
                      <Td>{ts.regular_hours}h</Td>
                      <Td>{ts.overtime_hours}h</Td>
                      <Td className="font-medium">{ts.total_hours}h</Td>
                      <Td>
                        <TsStatusBadge status={ts.status} />
                      </Td>
                      <Td>
                        {ts.status === 'draft' && (
                          <button onClick={() => submitTs(ts.id)} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">Submit</button>
                        )}
                        {ts.status === 'submitted' && (
                          <div className="flex gap-1">
                            <button onClick={() => approveTs(ts.id, 'approved')} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">Approve</button>
                            <button onClick={() => approveTs(ts.id, 'rejected')} className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">Reject</button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invoices tab — real ERP data (P12) */}
      {tab === 'invoices' && (
        <Card data-testid="invoices-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Invoice Management
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Auto-generated from approved timesheets · GST 18% included
            </p>
          </CardHeader>
          <CardContent>
            <NewInvoiceForm clients={clients} onCreated={refetchInv} />
          </CardContent>
          <CardContent className="p-0 border-t border-gray-100">
            {invLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Invoice #</Th><Th>Client</Th><Th>Date</Th>
                    <Th>Subtotal</Th><Th>GST</Th><Th>Total</Th><Th>Status</Th><Th>Action</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!invoices || invoices.length === 0) ? (
                    <Tr><Td colSpan={8} className="text-center text-gray-400 py-10 text-sm">
                      No invoices yet — approve timesheets, then generate one above.
                    </Td></Tr>
                  ) : invoices.map(inv => (
                    <Tr key={inv.id}>
                      <Td className="font-mono text-xs font-medium text-gray-800">{inv.invoice_number}</Td>
                      <Td className="text-sm text-gray-700">{inv.client_name}</Td>
                      <Td className="text-xs text-gray-500">{inv.invoice_date}</Td>
                      <Td>{fmt(inv.subtotal)}</Td>
                      <Td className="text-gray-500 text-sm">{fmt(inv.gst_amount)}</Td>
                      <Td className="font-semibold text-gray-900">{fmt(inv.total_amount)}</Td>
                      <Td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                          inv.status === 'overdue' ? 'bg-red-100 text-red-700' :
                          inv.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{inv.status}</span>
                      </Td>
                      <Td>
                        {inv.status !== 'paid' && (
                          <button onClick={() => markPaid(inv.id)} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">Mark Paid</button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payroll tab — real ERP data (P12) */}
      {tab === 'payroll' && (
        <Card data-testid="payroll-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> Payroll Runs
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              TDS 10% + PF 12% auto-deducted · Aadhaar/PAN encrypted at rest (HARD RULE #11)
            </p>
          </CardHeader>
          <CardContent>
            <NewPayrollRunForm onCreated={refetchPr} />
          </CardContent>
          <CardContent className="p-0 border-t border-gray-100">
            {prLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th></Th><Th>Pay Period</Th><Th>Gross</Th><Th>TDS</Th><Th>PF</Th><Th>Net</Th><Th>Status</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!payrollRuns || payrollRuns.length === 0) ? (
                    <Tr><Td colSpan={7} className="text-center text-gray-400 py-10 text-sm">
                      No payroll runs yet — generate one above from approved timesheets.
                    </Td></Tr>
                  ) : payrollRuns.map(pr => (
                    <PayrollRunRow key={pr.id} pr={pr} />
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      {tab === 'payroll' && <PayrollWebhooksCard />}
    </div>
  );
}

// Payroll webhook export (Time Champ gap-analysis, 2026-08-11) — a
// generic "bring your own endpoint" webhook, since no named-vendor
// payroll integration is buildable without real OAuth credentials
// (same constraint documented for Naukri/LinkedIn/MS Teams elsewhere in
// this codebase). Fires the full structured payslip data on every
// payroll run generated above.
interface PayrollWebhook {
  id: string; name: string; webhook_url: string; is_active: boolean;
  last_sent_at: string | null; send_count: number;
}
function PayrollWebhooksCard() {
  const { data: hooks, refetch } = useFetch<PayrollWebhook[]>('/erp/payroll-webhooks');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/erp/payroll-webhooks', { method: 'POST', body: JSON.stringify({ name, webhook_url: url }) });
      setName(''); setUrl(''); refetch();
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    await apiFetch(`/erp/payroll-webhooks/${id}`, { method: 'DELETE' });
    refetch();
  };

  return (
    <Card data-testid="payroll-webhooks-panel">
      <CardHeader>
        <h2 className="font-semibold text-gray-800 text-sm">Payroll Export Webhooks</h2>
        <p className="text-xs text-gray-400 mt-0.5">Every payroll run generated above POSTs the full structured payslip data (JSON) to each active webhook — no named payroll-vendor OAuth exists yet, so this is a bring-your-own-endpoint integration.</p>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-3">
          <input className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs flex-1" placeholder="Name (e.g. Accounting System)" value={name} onChange={e => setName(e.target.value)} />
          <input className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs flex-1" placeholder="https://your-endpoint.example.com/webhook" value={url} onChange={e => setUrl(e.target.value)} />
          <button onClick={create} disabled={saving} className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-xs font-semibold">{saving ? '…' : 'Add'}</button>
        </div>
        {(!hooks || hooks.length === 0) ? (
          <div className="text-xs text-gray-400 text-center py-4">No payroll export webhooks configured.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {hooks.map(h => (
              <div key={h.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2 text-xs">
                <div className="flex-1">
                  <div className="font-semibold">{h.name}</div>
                  <div className="text-gray-400">{h.webhook_url}</div>
                </div>
                <div className="text-gray-400">{h.send_count} sent{h.last_sent_at ? ` · last ${new Date(h.last_sent_at).toLocaleDateString()}` : ''}</div>
                <button onClick={() => remove(h.id)} className="text-red-500 font-semibold">Remove</button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Payslip {
  id: string; candidate_id: string; candidate_name: string;
  gross_pay: number; tds_amount: number; pf_amount: number; net_pay: number;
  hours_worked: number; pay_rate: number;
}

function PayrollRunRow({ pr }: { pr: PayrollRun }) {
  const [open, setOpen] = useState(false);
  const { data: payslips, loading } = useFetch<Payslip[]>(open ? `/erp/payroll-runs/${pr.id}/payslips` : null);
  return (
    <>
      <Tr className="cursor-pointer" onClick={() => setOpen(o => !o)}>
        <Td className="w-6">{open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}</Td>
        <Td className="text-xs text-gray-700">{pr.pay_period_start} – {pr.pay_period_end}</Td>
        <Td>{fmt(pr.total_gross)}</Td>
        <Td className="text-red-600 text-sm">-{fmt(pr.total_tds)}</Td>
        <Td className="text-blue-600 text-sm">-{fmt(pr.total_pf)}</Td>
        <Td className="font-semibold text-green-700">{fmt(pr.total_net)}</Td>
        <Td>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            pr.status === 'paid' ? 'bg-green-100 text-green-700' :
            pr.status === 'approved' ? 'bg-blue-100 text-blue-700' :
            'bg-gray-100 text-gray-500'
          }`}>{pr.status}</span>
        </Td>
      </Tr>
      {open && (
        <Tr data-testid="payslip-drilldown">
          <Td colSpan={7} className="bg-gray-50 p-0">
            {loading ? (
              <div className="flex justify-center py-6"><Spinner size="sm" /></div>
            ) : !payslips || payslips.length === 0 ? (
              <div className="text-center text-gray-400 py-6 text-xs">No payslips in this run.</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-200">
                    <th className="text-left font-medium py-2 pl-10">Candidate</th>
                    <th className="text-right font-medium py-2">Hours</th>
                    <th className="text-right font-medium py-2">Rate</th>
                    <th className="text-right font-medium py-2">Gross</th>
                    <th className="text-right font-medium py-2">TDS</th>
                    <th className="text-right font-medium py-2">PF</th>
                    <th className="text-right font-medium py-2 pr-10">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map(ps => (
                    <tr key={ps.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pl-10 text-gray-700">{ps.candidate_name}</td>
                      <td className="py-2 text-right">{ps.hours_worked}</td>
                      <td className="py-2 text-right">{fmt(ps.pay_rate)}</td>
                      <td className="py-2 text-right">{fmt(ps.gross_pay)}</td>
                      <td className="py-2 text-right text-red-600">-{fmt(ps.tds_amount)}</td>
                      <td className="py-2 text-right text-blue-600">-{fmt(ps.pf_amount)}</td>
                      <td className="py-2 text-right pr-10 font-semibold text-green-700">{fmt(ps.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Td>
        </Tr>
      )}
    </>
  );
}

function NewTimesheetForm({ placements, onCreated }: { placements: Placement[]; onCreated: () => void }) {
  const [placementId, setPlacementId] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [regHours, setRegHours] = useState('40');
  const [otHours, setOtHours] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const selected = placements.find(p => p.id === placementId);

  async function submit() {
    if (!selected || !weekStart) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/erp/timesheets', {
        method: 'POST',
        body: JSON.stringify({
          placement_id: selected.id, candidate_id: selected.candidate_id, client_id: selected.client_id,
          week_start: weekStart, regular_hours: parseFloat(regHours) || 0, overtime_hours: parseFloat(otHours) || 0,
          notes: notes || undefined,
        }),
      });
      setPlacementId(''); setWeekStart(''); setRegHours('40'); setOtHours('0'); setNotes('');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to create timesheet'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 pb-2">
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Contractor</label>
        <select value={placementId} onChange={e => setPlacementId(e.target.value)} className={inputCls} style={{ minWidth: 220 }}>
          <option value="">Select placement…</option>
          {placements.map(p => <option key={p.id} value={p.id}>{p.candidate_name} — {p.client_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Week Start</label>
        <input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Reg Hours</label>
        <input type="number" value={regHours} onChange={e => setRegHours(e.target.value)} className={inputCls} style={{ width: 70 }} />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">OT Hours</label>
        <input type="number" value={otHours} onChange={e => setOtHours(e.target.value)} className={inputCls} style={{ width: 70 }} />
      </div>
      <div className="flex-1 min-w-[160px]">
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} style={{ width: '100%' }} placeholder="Optional" />
      </div>
      <button onClick={submit} disabled={!selected || !weekStart || busy} className={btnCls}>
        <Plus className="h-3 w-3" /> {busy ? 'Creating…' : 'New Timesheet'}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

function NewInvoiceForm({ clients, onCreated }: { clients: any[]; onCreated: () => void }) {
  const [clientId, setClientId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [gstRate, setGstRate] = useState('18');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!clientId || !periodStart || !periodEnd) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/erp/invoices/generate', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, period_start: periodStart, period_end: periodEnd, gst_rate: parseFloat(gstRate) || 18 }),
      });
      setClientId(''); setPeriodStart(''); setPeriodEnd('');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to generate invoice'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 pb-2">
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Client</label>
        <select value={clientId} onChange={e => setClientId(e.target.value)} className={inputCls} style={{ minWidth: 200 }}>
          <option value="">Select client…</option>
          {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Period Start</label>
        <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Period End</label>
        <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">GST %</label>
        <input type="number" value={gstRate} onChange={e => setGstRate(e.target.value)} className={inputCls} style={{ width: 70 }} />
      </div>
      <button onClick={submit} disabled={!clientId || !periodStart || !periodEnd || busy} className={btnCls}>
        <Plus className="h-3 w-3" /> {busy ? 'Generating…' : 'Generate Invoice'}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

function NewPayrollRunForm({ onCreated }: { onCreated: () => void }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!start || !end) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/erp/payroll-runs', { method: 'POST', body: JSON.stringify({ pay_period_start: start, pay_period_end: end }) });
      setStart(''); setEnd('');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to create payroll run'); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 pb-2">
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Pay Period Start</label>
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Pay Period End</label>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inputCls} />
      </div>
      <button onClick={submit} disabled={!start || !end || busy} className={btnCls}>
        <Plus className="h-3 w-3" /> {busy ? 'Generating…' : 'New Payroll Run'}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

function ContractorPiiForm({ placements }: { placements: Placement[] }) {
  const [candidateId, setCandidateId] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const [pf, setPf] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [onFile, setOnFile] = useState<any | null>(null);

  const uniqueCandidates = Array.from(new Map(placements.map(p => [p.candidate_id, p])).values());

  async function checkOnFile(candId: string) {
    setOnFile(null);
    if (!candId) return;
    try { setOnFile(await apiFetch(`/erp/contractor-pii/${candId}`)); }
    catch { setOnFile({ none: true }); }
  }

  async function submit() {
    if (!candidateId) return;
    setBusy(true); setMsg(null);
    try {
      await apiFetch('/erp/contractor-pii', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidateId,
          aadhaar: aadhaar || undefined, pan: pan || undefined, pf_number: pf || undefined,
          bank_account: bankAccount || undefined, bank_ifsc: bankIfsc || undefined, bank_name: bankName || undefined,
        }),
      });
      setMsg({ text: 'Saved — sensitive fields encrypted at rest (HARD RULE #11).', ok: true });
      setAadhaar(''); setPan(''); setPf(''); setBankAccount('');
      checkOnFile(candidateId);
    } catch (e: any) { setMsg({ text: e.message || 'Save failed', ok: false }); }
    finally { setBusy(false); }
  }

  return (
    <Card data-testid="contractor-pii-panel">
      <CardHeader>
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Contractor PII (Aadhaar / PAN / PF / Bank)
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Encrypted at rest via pgcrypto (HARD RULE #11) — values are never returned once saved, only whether a field is on file.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Contractor</label>
            <select value={candidateId} onChange={e => { setCandidateId(e.target.value); checkOnFile(e.target.value); }} className={inputCls} style={{ minWidth: 220 }}>
              <option value="">Select contractor…</option>
              {uniqueCandidates.map(p => <option key={p.candidate_id} value={p.candidate_id}>{p.candidate_name}</option>)}
            </select>
          </div>
        </div>
        {candidateId && (
          <div className="text-xs text-gray-500">
            On file: {onFile?.none ? 'nothing yet' : onFile ? (
              <>
                {onFile.has_aadhaar && <span className="mr-2 text-green-600 font-medium">✓ Aadhaar</span>}
                {onFile.has_pan && <span className="mr-2 text-green-600 font-medium">✓ PAN</span>}
                {onFile.has_pf && <span className="mr-2 text-green-600 font-medium">✓ PF</span>}
                {onFile.has_bank_account && <span className="mr-2 text-green-600 font-medium">✓ Bank A/C</span>}
                {onFile.bank_name && <span className="text-gray-400">({onFile.bank_name}, {onFile.bank_ifsc})</span>}
                {!onFile.has_aadhaar && !onFile.has_pan && !onFile.has_pf && !onFile.has_bank_account && 'nothing yet'}
              </>
            ) : '…'}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Aadhaar Number</label>
            <input value={aadhaar} onChange={e => setAadhaar(e.target.value)} className={inputCls} style={{ width: '100%' }} placeholder="Leave blank to keep existing" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">PAN</label>
            <input value={pan} onChange={e => setPan(e.target.value)} className={inputCls} style={{ width: '100%' }} placeholder="Leave blank to keep existing" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">PF Number</label>
            <input value={pf} onChange={e => setPf(e.target.value)} className={inputCls} style={{ width: '100%' }} placeholder="Leave blank to keep existing" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Bank Account</label>
            <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} className={inputCls} style={{ width: '100%' }} placeholder="Leave blank to keep existing" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">IFSC</label>
            <input value={bankIfsc} onChange={e => setBankIfsc(e.target.value)} className={inputCls} style={{ width: '100%' }} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Bank Name</label>
            <input value={bankName} onChange={e => setBankName(e.target.value)} className={inputCls} style={{ width: '100%' }} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={!candidateId || busy} className={btnCls}>
            {busy ? 'Saving…' : 'Save (Encrypted)'}
          </button>
          {msg && <span className={`text-xs ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function FinKPI({
  icon: Icon, label, value, color, bg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number | null;
  color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-gray-900 truncate">
            {value === null ? <Spinner size="sm" /> : value}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TsStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-500',
    submitted: 'bg-blue-100 text-blue-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    billed: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}
