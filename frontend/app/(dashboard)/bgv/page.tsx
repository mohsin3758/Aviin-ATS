'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Shield, CheckCircle, XCircle, Clock, AlertTriangle,
  Search, Star, FileText, Network, Globe,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';

type BgvTab = 'overview' | 'checks' | 'trust-graph' | 'india-verify';

interface Candidate { id: string; full_name: string; email: string; }
interface TrustScore {
  candidate_id: string; full_name: string;
  bgv_score: number; trust_graph_score: number; fraud_flags: number;
  total_score: number; trust_rating: string;
  total_checks: number; checks_clear: number;
}
interface BGVCheck {
  id: string; check_type: string; status: string; result: string | null;
  score_points: number; vendor: string | null; initiated_at: string | null;
  completed_at: string | null; notes: string | null;
}
interface TrustEdge {
  id: string; source_type: string; source_id: string;
  target_type: string; target_id: string; edge_type: string;
  weight: number; created_at: string;
}

const CHECK_TYPES = [
  { key: 'identity', label: 'Identity', pts: 25 },
  { key: 'education', label: 'Education', pts: 20 },
  { key: 'employment', label: 'Employment', pts: 30 },
  { key: 'criminal', label: 'Criminal', pts: 10 },
  { key: 'credit', label: 'Credit', pts: 10 },
  { key: 'address', label: 'Address', pts: 10 },
  { key: 'reference', label: 'Reference', pts: 15 },
  { key: 'digilocker', label: 'DigiLocker', pts: 20 },
];

const TABS: { key: BgvTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Trust Overview', icon: Shield },
  { key: 'checks', label: 'BGV Checks', icon: CheckCircle },
  { key: 'trust-graph', label: 'Trust Graph', icon: Network },
  { key: 'india-verify', label: 'India Verify', icon: Globe },
];

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
};

const RESULT_ICON = ({ result }: { result: string | null }) => {
  if (result === 'clear') return <CheckCircle className="h-4 w-4 text-green-500" />;
  if (result === 'flagged') return <XCircle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-gray-400" />;
};

function TrustBadge({ rating }: { rating: string }) {
  const colors: Record<string, string> = {
    Excellent: 'bg-green-100 text-green-700',
    Good: 'bg-blue-100 text-blue-700',
    Fair: 'bg-amber-100 text-amber-700',
    Low: 'bg-orange-100 text-orange-700',
    Flagged: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors[rating] ?? 'bg-gray-100 text-gray-500'}`}>
      {rating}
    </span>
  );
}

export default function BGVPage() {
  const [tab, setTab] = useState<BgvTab>('overview');
  const [selectedCand, setSelectedCand] = useState<string>('');
  const { data: candidates } = useFetch<Candidate[]>('/candidates');
  const { data: trustScore, loading: tsLoading, refetch: refetchTs } =
    useFetch<TrustScore>(selectedCand ? `/bgv/trust-score/${selectedCand}` : null);
  const { data: checks, loading: checksLoading, refetch: refetchChecks } =
    useFetch<BGVCheck[]>(selectedCand && tab === 'checks' ? `/bgv/checks/${selectedCand}` : null);
  const { data: edges, loading: edgesLoading } =
    useFetch<TrustEdge[]>(tab === 'trust-graph' ? '/bgv/trust-graph' : null);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-indigo-500/10">
          <Shield className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">BGV + Trust Intelligence</h1>
          <p className="text-sm text-gray-500">Background verification · trust graph · India verify (Aadhaar + DigiLocker)</p>
        </div>
      </div>

      {/* Candidate selector */}
      <Card>
        <CardContent className="py-4 flex items-center gap-4">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <select
            value={selectedCand}
            onChange={e => { setSelectedCand(e.target.value); }}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">Select a candidate to view BGV…</option>
            {candidates?.map(c => (
              <option key={c.id} value={c.id}>{c.full_name} — {c.email}</option>
            ))}
          </select>
          {trustScore && !tsLoading && (
            <TrustBadge rating={trustScore.trust_rating} />
          )}
        </CardContent>
      </Card>

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
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Trust Overview */}
      {tab === 'overview' && (
        <div data-testid="trust-overview">
          {!selectedCand ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-14 gap-3 text-gray-400">
                <Shield className="h-12 w-12 text-gray-200" />
                <p className="text-sm">Select a candidate to view their trust score and BGV status</p>
              </CardContent>
            </Card>
          ) : tsLoading ? (
            <div className="flex justify-center py-10"><Spinner size="lg" /></div>
          ) : trustScore ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <h2 className="font-semibold text-gray-800">Trust Score — {trustScore.full_name}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Rule-based aggregate (BGV + trust graph) · zero-token</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center">
                    <div className="relative w-32 h-32">
                      <svg className="w-full h-full" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3" />
                        <circle
                          cx="18" cy="18" r="15.9" fill="none"
                          stroke={trustScore.total_score >= 70 ? '#10b981' : trustScore.total_score >= 50 ? '#f59e0b' : '#ef4444'}
                          strokeWidth="3"
                          strokeDasharray={`${(Math.max(0, trustScore.total_score) / 100) * 100} 100`}
                          strokeLinecap="round"
                          transform="rotate(-90 18 18)"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold text-gray-900">{Math.max(0, trustScore.total_score)}</span>
                        <span className="text-xs text-gray-400">/100</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="bg-[--color-surface-alt] rounded-lg p-2">
                      <p className="text-lg font-bold text-gray-900">{trustScore.bgv_score}</p>
                      <p className="text-xs text-gray-400">BGV pts</p>
                    </div>
                    <div className="bg-[--color-surface-alt] rounded-lg p-2">
                      <p className="text-lg font-bold text-gray-900">{trustScore.trust_graph_score}</p>
                      <p className="text-xs text-gray-400">Graph pts</p>
                    </div>
                    <div className={`rounded-lg p-2 ${trustScore.fraud_flags > 0 ? 'bg-red-50' : 'bg-[--color-surface-alt]'}`}>
                      <p className={`text-lg font-bold ${trustScore.fraud_flags > 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {trustScore.fraud_flags}
                      </p>
                      <p className="text-xs text-gray-400">Fraud flags</p>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">BGV Checks</span>
                    <span className="font-medium">{trustScore.checks_clear}/{trustScore.total_checks} clear</span>
                  </div>
                  <div className="flex justify-center">
                    <TrustBadge rating={trustScore.trust_rating} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <h2 className="font-semibold text-gray-800">BGV Score Breakdown</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Max points per check type</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {CHECK_TYPES.map(ct => (
                    <div key={ct.key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">{ct.label}</span>
                      <span className="text-xs text-gray-400">+{ct.pts} pts</span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                    <span>Max possible</span>
                    <span className="text-indigo-600">140 pts</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="text-center py-8 text-gray-400 text-sm">
                Candidate not found
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* BGV Checks tab */}
      {tab === 'checks' && (
        <Card data-testid="bgv-checks-panel">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">Background Verification Checks</h2>
                <p className="text-xs text-gray-400 mt-0.5">8 check types · identity/education/employment/criminal/credit/address/reference/digilocker</p>
              </div>
              {selectedCand && (
                <InitiateCheckBtn candidateId={selectedCand} onDone={refetchChecks} />
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!selectedCand ? (
              <div className="text-center py-8 text-gray-400 text-sm">Select a candidate above</div>
            ) : checksLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <Table>
                <Thead>
                  <tr><Th>Check Type</Th><Th>Status</Th><Th>Result</Th><Th>Score</Th><Th>Vendor</Th><Th>Date</Th></tr>
                </Thead>
                <Tbody>
                  {(!checks || checks.length === 0) ? (
                    <Tr><Td colSpan={6} className="text-center text-gray-400 py-8 text-sm">
                      No BGV checks initiated yet. Use the button above to start one.
                    </Td></Tr>
                  ) : checks.map(c => (
                    <Tr key={c.id}>
                      <Td className="font-medium text-gray-800 capitalize">{c.check_type}</Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status] ?? 'bg-gray-100 text-gray-500'}`}>{c.status}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <RESULT_ICON result={c.result} />
                          <span className="text-xs text-gray-600">{c.result ?? '—'}</span>
                        </div>
                      </Td>
                      <Td>{c.result === 'clear' ? `+${c.score_points}` : '—'}</Td>
                      <Td className="text-xs text-gray-500">{c.vendor ?? '—'}</Td>
                      <Td className="text-xs text-gray-400">{c.completed_at?.slice(0, 10) ?? c.initiated_at?.slice(0, 10) ?? '—'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Trust Graph tab */}
      {tab === 'trust-graph' && (
        <Card data-testid="trust-graph-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Network className="h-4 w-4" />
              Trust Graph Edges
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              referral · worked_with · placed · vouched · reported_fraud · weight [-1,1]
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {edgesLoading ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <Table>
                <Thead>
                  <tr><Th>From</Th><Th>Type</Th><Th>To</Th><Th>Weight</Th><Th>Date</Th></tr>
                </Thead>
                <Tbody>
                  {(!edges || edges.length === 0) ? (
                    <Tr><Td colSpan={5} className="text-center text-gray-400 py-8 text-sm">
                      No trust graph edges yet. Edges are created automatically from placements and referrals.
                    </Td></Tr>
                  ) : edges.map(e => (
                    <Tr key={e.id}>
                      <Td className="text-xs font-mono text-gray-500">{e.source_type}/{e.source_id.slice(0,8)}…</Td>
                      <Td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          e.edge_type === 'reported_fraud' ? 'bg-red-100 text-red-700' :
                          e.edge_type === 'placed' ? 'bg-green-100 text-green-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{e.edge_type.replace('_', ' ')}</span>
                      </Td>
                      <Td className="text-xs font-mono text-gray-500">{e.target_type}/{e.target_id.slice(0,8)}…</Td>
                      <Td className={`font-semibold text-sm ${e.weight < 0 ? 'text-red-600' : 'text-green-600'}`}>{e.weight}</Td>
                      <Td className="text-xs text-gray-400">{e.created_at?.slice(0, 10)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* India Verify tab */}
      {tab === 'india-verify' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="india-verify-panel">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Shield className="h-4 w-4 text-orange-500" />
                Aadhaar OTP Verification
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">UIDAI Aadhaar Authentication API · e-KYC</p>
            </CardHeader>
            <CardContent>
              <AadhaarPanel candidateId={selectedCand} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <FileText className="h-4 w-4 text-green-600" />
                DigiLocker Document Pull
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">NIC DigiLocker OAuth2 · degree/PAN/DL fetch</p>
            </CardHeader>
            <CardContent>
              <DigiLockerPanel candidateId={selectedCand} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function InitiateCheckBtn({ candidateId, onDone }: { candidateId: string; onDone: () => void }) {
  const [type, setType] = useState('employment');
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      await apiFetch('/bgv/checks', {
        method: 'POST',
        body: JSON.stringify({ candidate_id: candidateId, check_type: type }),
      });
      onDone();
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <select
        value={type}
        onChange={e => setType(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
      >
        {CHECK_TYPES.map(ct => (
          <option key={ct.key} value={ct.key}>{ct.label}</option>
        ))}
      </select>
      <button
        onClick={run}
        disabled={loading}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? <Spinner size="sm" /> : <CheckCircle className="h-3 w-3" />}
        Initiate Check
      </button>
    </div>
  );
}

function AadhaarPanel({ candidateId }: { candidateId: string }) {
  const [aadhaar, setAadhaar] = useState('');
  const [mobile4, setMobile4] = useState('');
  const [txnId, setTxnId] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [step, setStep] = useState<'init' | 'otp'>('init');

  const initiate = async () => {
    if (!candidateId) { setMsg('Select a candidate first'); return; }
    setLoading(true);
    try {
      const r = await apiFetch('/bgv/aadhaar/initiate', {
        method: 'POST',
        body: JSON.stringify({ candidate_id: candidateId, aadhaar_number: aadhaar, mobile_last4: mobile4 }),
      });
      setTxnId(r.transaction_id);
      setStep('otp');
      setMsg(r.message);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    try {
      const r = await apiFetch('/bgv/aadhaar/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ transaction_id: txnId, otp, candidate_id: candidateId }),
      });
      setMsg(`Verified: ${r.message} (Score +${r.score_points})`);
      setStep('init');
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
        Demo mode: auto-passes OTP. Production requires UIDAI ASA onboarding.
      </div>
      {step === 'init' ? (
        <>
          <input
            type="text" value={aadhaar} onChange={e => setAadhaar(e.target.value)}
            placeholder="Aadhaar number (12 digits)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
          <input
            type="text" value={mobile4} onChange={e => setMobile4(e.target.value)}
            placeholder="Last 4 digits of registered mobile"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
          <button
            onClick={initiate} disabled={loading || !aadhaar}
            className="w-full py-2 text-sm font-medium bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {loading ? <Spinner size="sm" /> : 'Send OTP'}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500">TxnID: {txnId}</p>
          <input
            type="text" value={otp} onChange={e => setOtp(e.target.value)}
            placeholder="Enter OTP (demo: any value)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
          <button
            onClick={verify} disabled={loading}
            className="w-full py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Spinner size="sm" /> : 'Verify OTP'}
          </button>
        </>
      )}
      {msg && <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{msg}</p>}
    </div>
  );
}

function DigiLockerPanel({ candidateId }: { candidateId: string }) {
  const [docType, setDocType] = useState('degree');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ auth_url: string; message: string } | null>(null);

  const initiate = async () => {
    if (!candidateId) return;
    setLoading(true);
    try {
      const r = await apiFetch('/bgv/digilocker/initiate', {
        method: 'POST',
        body: JSON.stringify({ candidate_id: candidateId, document_type: docType }),
      });
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
        Demo mode: generates mock auth URL. Production requires NIC partner credentials.
      </div>
      <select
        value={docType}
        onChange={e => setDocType(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
      >
        <option value="degree">Degree Certificate</option>
        <option value="pan_card">PAN Card</option>
        <option value="driving_licence">Driving Licence</option>
        <option value="aadhaar">Aadhaar Card</option>
      </select>
      <button
        onClick={initiate}
        disabled={loading || !candidateId}
        className="w-full py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {loading ? <Spinner size="sm" /> : 'Initiate DigiLocker'}
      </button>
      {result && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-xs text-gray-500">{result.message}</p>
          <p className="text-xs text-blue-600 break-all font-mono">{result.auth_url}</p>
        </div>
      )}
    </div>
  );
}
