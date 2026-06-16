'use client';

import { useState } from 'react';
import {
  MessageCircle, Phone, Globe, CheckCircle, XCircle,
  RefreshCw, Send, Users, Shield, Wifi, WifiOff,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';

type WaTab = 'session' | 'outreach' | 'templates' | 'consent';

const LANG_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu',
  kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', gu: 'Gujarati',
  pa: 'Punjabi', bn: 'Bengali', or: 'Odia', as: 'Assamese',
  ur: 'Urdu', kok: 'Konkani',
};

interface SessionStatus { session: string; status: string; info: Record<string, unknown>; }
interface Template { template_key: string; languages: string[]; sample_en: string; }
interface ConsentRecord {
  id: string; candidate_id: string; data_category: string;
  channel: string | null; consent_given: boolean; created_at: string;
}
interface Candidate { id: string; full_name: string; email: string; phone: string | null; }

const TABS: { key: WaTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'session', label: 'Session', icon: Wifi },
  { key: 'outreach', label: 'Outreach', icon: Send },
  { key: 'templates', label: 'Templates', icon: Globe },
  { key: 'consent', label: 'Consent Log', icon: Shield },
];

export default function WhatsAppPage() {
  const [tab, setTab] = useState<WaTab>('session');
  const { data: session, loading: sessLoading, refetch: refetchSession } =
    useFetch<SessionStatus>('/whatsapp/session/status');
  const { data: templates } = useFetch<Template[]>('/whatsapp/templates');
  const { data: consentRecords } = useFetch<ConsentRecord[]>('/consent-records');
  const { data: candidates } = useFetch<Candidate[]>('/candidates');

  const waConsents = consentRecords?.filter(c => c.channel === 'whatsapp') ?? [];
  const consentedIds = new Set(waConsents.filter(c => c.consent_given).map(c => c.candidate_id));

  const connected = session?.status === 'WORKING' || session?.status === 'CONNECTED';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-green-500/10">
          <MessageCircle className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Outreach</h1>
          <p className="text-sm text-gray-500">WAHA · consent-gated · India DPDP 2023 · 14 languages</p>
        </div>
        <div className="ml-auto">
          <StatusPill status={session?.status} loading={sessLoading} />
        </div>
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
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Session tab */}
      {tab === 'session' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="session-panel">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                {connected ? (
                  <><Wifi className="h-4 w-4 text-green-500" /> Session Connected</>
                ) : (
                  <><WifiOff className="h-4 w-4 text-red-400" /> Session Disconnected</>
                )}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">WAHA self-hosted · session: default</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-[--color-surface-alt] rounded-lg p-4 space-y-2">
                <InfoRow label="Status" value={session?.status ?? '…'} />
                <InfoRow label="Session" value={session?.session ?? 'default'} />
              </div>
              <div className="flex gap-2">
                <SessionBtn label="Start Session" endpoint="/whatsapp/session/start" onDone={refetchSession} />
                <button
                  onClick={() => refetchSession()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800">Link WhatsApp Account</h2>
              <p className="text-xs text-gray-400 mt-0.5">Scan QR with WhatsApp on your phone</p>
            </CardHeader>
            <CardContent>
              <QRPanel connected={connected} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Outreach tab */}
      {tab === 'outreach' && (
        <Card data-testid="outreach-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Send className="h-4 w-4" />
              Template-Based Outreach
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Only consented candidates are shown · HARD RULE #7/#12</p>
          </CardHeader>
          <CardContent>
            <OutreachForm
              candidates={candidates?.filter(c => consentedIds.has(c.id)) ?? []}
              templates={templates ?? []}
              connected={connected}
            />
          </CardContent>
        </Card>
      )}

      {/* Templates tab */}
      {tab === 'templates' && (
        <Card data-testid="templates-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Message Templates · 14 Languages
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Rule-based i18n — zero-token, no LLM needed</p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <Thead>
                <tr>
                  <Th>Template</Th>
                  <Th>Languages</Th>
                  <Th>Sample (English)</Th>
                </tr>
              </Thead>
              <Tbody>
                {(!templates || templates.length === 0) ? (
                  <Tr><Td colSpan={3} className="text-center text-gray-400 py-6">Loading…</Td></Tr>
                ) : templates.map(t => (
                  <Tr key={t.template_key}>
                    <Td className="font-medium text-gray-800 whitespace-nowrap">
                      {t.template_key.replace('_', ' ')}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {t.languages.map(l => (
                          <span key={l} className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
                            {LANG_NAMES[l] ?? l}
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td className="text-xs text-gray-500 max-w-xs truncate">{t.sample_en}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Consent Log tab */}
      {tab === 'consent' && (
        <Card data-testid="consent-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <Shield className="h-4 w-4 text-green-600" />
              WhatsApp Consent Log (DPDP 2023)
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {consentedIds.size} consented · every send is blocked without a consent record
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <Thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Category</Th>
                  <Th>Consent</Th>
                  <Th>Date</Th>
                </tr>
              </Thead>
              <Tbody>
                {waConsents.length === 0 ? (
                  <Tr>
                    <Td colSpan={4} className="text-center text-gray-400 py-8 text-sm">
                      No WhatsApp consent records found. Collect consent before outreach.
                    </Td>
                  </Tr>
                ) : waConsents.map(c => (
                  <Tr key={c.id}>
                    <Td className="text-xs font-mono text-gray-500">{c.candidate_id?.slice(0, 8)}…</Td>
                    <Td className="text-sm text-gray-700">{c.data_category}</Td>
                    <Td>
                      {c.consent_given ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                          <CheckCircle className="h-3.5 w-3.5" /> Given
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
                          <XCircle className="h-3.5 w-3.5" /> Withdrawn
                        </span>
                      )}
                    </Td>
                    <Td className="text-xs text-gray-400">{c.created_at?.slice(0, 10)}</Td>
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

function StatusPill({ status, loading }: { status?: string; loading: boolean }) {
  if (loading) return <Spinner size="sm" />;
  const connected = status === 'WORKING' || status === 'CONNECTED';
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full ${
      connected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
      {status ?? 'Unknown'}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}

function SessionBtn({ label, endpoint, onDone }: { label: string; endpoint: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const handle = async () => {
    setLoading(true);
    try {
      await apiFetch(endpoint, { method: 'POST' });
      setMsg('Done');
      onDone();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handle}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {loading ? <Spinner size="sm" /> : <Wifi className="h-3.5 w-3.5" />}
        {label}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  );
}

function QRPanel({ connected }: { connected: boolean }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const fetchQR = async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await apiFetch('/whatsapp/session/qr');
      setQrUrl(data.qr_data_url);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'QR not available');
    } finally {
      setLoading(false);
    }
  };
  if (connected) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <div className="p-3 rounded-full bg-green-50">
          <CheckCircle className="h-10 w-10 text-green-500" />
        </div>
        <p className="text-sm font-medium text-green-700">WhatsApp Connected</p>
        <p className="text-xs text-gray-400">Phone is linked and ready to send messages</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-4">
      {!qrUrl ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="p-3 rounded-full bg-gray-50">
            <Phone className="h-10 w-10 text-gray-300" />
          </div>
          <p className="text-xs text-gray-400 text-center">
            Start a session first, then load QR code
          </p>
          <button
            onClick={fetchQR}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Spinner size="sm" /> : null}
            Load QR Code
          </button>
          {err && <p className="text-xs text-red-500 text-center">{err}</p>}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <img src={qrUrl} alt="WhatsApp QR Code" className="w-48 h-48 border border-gray-200 rounded-lg" />
          <p className="text-xs text-gray-500 text-center">
            Open WhatsApp → Linked Devices → Link a device → Scan this QR
          </p>
          <button
            onClick={fetchQR}
            className="text-xs text-green-600 underline"
          >
            Refresh QR
          </button>
        </div>
      )}
    </div>
  );
}

function OutreachForm({
  candidates, templates, connected,
}: {
  candidates: Candidate[];
  templates: Template[];
  connected: boolean;
}) {
  const [candidateId, setCandidateId] = useState('');
  const [phone, setPhone] = useState('');
  const [templateKey, setTemplateKey] = useState('job_opportunity');
  const [lang, setLang] = useState('en');
  const [varName, setVarName] = useState('');
  const [varRole, setVarRole] = useState('');
  const [varClient, setVarClient] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string>('');

  const onCandidateChange = (id: string) => {
    setCandidateId(id);
    const c = candidates.find(c => c.id === id);
    if (c) {
      setVarName(c.full_name);
      setPhone(c.phone ?? '');
    }
  };

  const send = async () => {
    if (!candidateId || !phone || !templateKey) return;
    setSending(true);
    setResult('');
    try {
      const res = await apiFetch('/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidateId,
          phone,
          template_key: templateKey,
          lang,
          vars: { name: varName, role: varRole, client: varClient, date: '', status: '' },
        }),
      });
      setResult(`Sent: "${res.text}"`);
    } catch (e: unknown) {
      setResult(e instanceof Error ? e.message : 'Error sending');
    } finally {
      setSending(false);
    }
  };

  if (!connected) {
    return (
      <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <WifiOff className="h-5 w-5 text-amber-500 shrink-0" />
        <p className="text-sm text-amber-700">
          WhatsApp session not connected. Go to the Session tab to link your phone.
        </p>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <Users className="h-5 w-5 text-blue-500 shrink-0" />
        <p className="text-sm text-blue-700">
          No consented candidates found. Add a WhatsApp consent record for candidates via{' '}
          <code className="text-xs bg-blue-100 px-1 rounded">POST /consent-records</code> first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Candidate (consented)</label>
          <select
            value={candidateId}
            onChange={e => onCandidateChange(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            <option value="">Select candidate…</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Phone (E.164)</label>
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+919876543210"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Template</label>
          <select
            value={templateKey}
            onChange={e => setTemplateKey(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            {templates.map(t => (
              <option key={t.template_key} value={t.template_key}>{t.template_key.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Language</label>
          <select
            value={lang}
            onChange={e => setLang(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
          >
            {Object.entries(LANG_NAMES).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <input
            type="text"
            value={varRole}
            onChange={e => setVarRole(e.target.value)}
            placeholder="Senior Java Developer"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
          <input
            type="text"
            value={varClient}
            onChange={e => setVarClient(e.target.value)}
            placeholder="Globex Manufacturing"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
          />
        </div>
      </div>
      <button
        onClick={send}
        disabled={sending || !candidateId || !phone}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {sending ? <Spinner size="sm" /> : <Send className="h-4 w-4" />}
        Send WhatsApp Message
      </button>
      {result && (
        <p className="text-xs text-gray-600 bg-[--color-surface-alt] rounded-lg p-3 mt-2 break-words">
          {result}
        </p>
      )}
    </div>
  );
}
