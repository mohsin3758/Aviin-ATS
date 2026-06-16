'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, Mail, Phone, MapPin, Briefcase, Star,
  FileText, CheckSquare, Video, Activity,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch } from '@/lib/useFetch';

type Tab = 'profile' | 'applications' | 'scorecards' | 'assessment' | 'video';

const STAGE_COLOR: Record<string, string> = {
  sourced: 'bg-gray-100 text-gray-600',
  screened: 'bg-blue-100 text-blue-700',
  submitted: 'bg-indigo-100 text-indigo-700',
  interview: 'bg-purple-100 text-purple-700',
  offer: 'bg-amber-100 text-amber-700',
  placed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

interface Candidate {
  id: string; full_name: string; email: string; phone: string | null;
  skills: string[]; total_exp_mo: number; location: string; current_employer: string | null;
  resume_text: string | null; source: string | null; created_at: string;
}

interface Application {
  id: string; requisition_id: string; requisition_title: string;
  stage: string; fit_score: number | null; created_at: string; updated_at: string;
}

interface Scorecard {
  id: string; application_id: string; interviewer_id: string;
  overall_rating: number | null; notes: string | null; created_at: string;
}

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'profile', label: 'Profile', icon: FileText },
  { key: 'applications', label: 'Applications', icon: Activity },
  { key: 'scorecards', label: 'Scorecards', icon: Star },
  { key: 'assessment', label: 'Assessment', icon: CheckSquare },
  { key: 'video', label: 'Video', icon: Video },
];

export default function Candidate360Page() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('profile');

  const { data: candidate, loading: candLoading } = useFetch<Candidate>(id ? `/candidates/${id}` : null);
  const { data: applications, loading: appsLoading } = useFetch<Application[]>(
    tab === 'applications' && id ? `/candidates/${id}/applications` : null
  );
  const { data: scorecards, loading: scoreLoading } = useFetch<Scorecard[]>(
    tab === 'scorecards' ? `/interview-scorecards` : null
  );

  const expYears = candidate ? Math.floor(candidate.total_exp_mo / 12) : 0;
  const expMonths = candidate ? candidate.total_exp_mo % 12 : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/candidates" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        {candLoading ? (
          <Spinner size="sm" />
        ) : candidate ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-12 h-12 rounded-full bg-[--color-primary]/10 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-[--color-primary]">
                {candidate.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{candidate.full_name}</h1>
              <p className="text-sm text-gray-500">
                {expYears > 0 && `${expYears}y `}{expMonths > 0 && `${expMonths}mo `}experience
                {candidate.location && ` · ${candidate.location}`}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Candidate not found</p>
        )}
      </div>

      {/* Tabs */}
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

      {/* Tab Panels */}
      {tab === 'profile' && candidate && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="profile-panel">
          {/* Contact + meta */}
          <Card>
            <CardHeader><h2 className="font-semibold text-gray-800">Contact & Info</h2></CardHeader>
            <CardContent className="space-y-3">
              {candidate.email && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail className="h-4 w-4 text-gray-400 shrink-0" />
                  <a href={`mailto:${candidate.email}`} className="hover:underline truncate">{candidate.email}</a>
                </div>
              )}
              {candidate.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone className="h-4 w-4 text-gray-400 shrink-0" />
                  {candidate.phone}
                </div>
              )}
              {candidate.location && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                  {candidate.location}
                </div>
              )}
              {candidate.current_employer && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Briefcase className="h-4 w-4 text-gray-400 shrink-0" />
                  {candidate.current_employer}
                </div>
              )}
              {candidate.source && (
                <p className="text-xs text-gray-400 pt-1">Source: {candidate.source}</p>
              )}
            </CardContent>
          </Card>

          {/* Skills */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-gray-800">Skills</h2>
              <p className="text-xs text-gray-400 mt-0.5">{candidate.skills?.length ?? 0} skills</p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {candidate.skills?.map(s => (
                  <span key={s} className="text-sm bg-[--color-surface-alt] border border-gray-200 text-gray-700 px-2.5 py-1 rounded-lg">
                    {s}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Resume */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <h2 className="font-semibold text-gray-800">Resume Extract</h2>
              <p className="text-xs text-gray-400 mt-0.5">{expYears}y {expMonths}mo experience</p>
            </CardHeader>
            <CardContent>
              {candidate.resume_text ? (
                <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-12">
                  {candidate.resume_text}
                </p>
              ) : (
                <p className="text-sm text-gray-400">No resume text available</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'applications' && (
        <Card data-testid="applications-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">Application History</h2></CardHeader>
          <CardContent className="p-0">
            {appsLoading ? (
              <div className="flex justify-center p-6"><Spinner /></div>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>Requisition</Th>
                    <Th>Stage</Th>
                    <Th>Fit Score</Th>
                    <Th>Applied</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {(!applications || applications.length === 0) ? (
                    <Tr><Td colSpan={4} className="text-center text-gray-400 py-6">No applications found</Td></Tr>
                  ) : applications.map(app => (
                    <Tr key={app.id}>
                      <Td>
                        <Link href={`/pipeline/${app.requisition_id}`} className="text-[--color-primary] hover:underline font-medium">
                          {app.requisition_title}
                        </Link>
                      </Td>
                      <Td>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STAGE_COLOR[app.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                          {app.stage}
                        </span>
                      </Td>
                      <Td>{app.fit_score !== null ? `${app.fit_score}%` : '—'}</Td>
                      <Td className="text-gray-500 text-xs">{app.created_at?.slice(0, 10)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'scorecards' && (
        <Card data-testid="scorecards-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">Interview Scorecards</h2></CardHeader>
          <CardContent className="p-0">
            {scoreLoading ? (
              <div className="flex justify-center p-6"><Spinner /></div>
            ) : (
              <Table>
                <Thead>
                  <tr><Th>Application</Th><Th>Rating</Th><Th>Notes</Th><Th>Date</Th></tr>
                </Thead>
                <Tbody>
                  {(!scorecards || scorecards.length === 0) ? (
                    <Tr><Td colSpan={4} className="text-center text-gray-400 py-6">No scorecards yet</Td></Tr>
                  ) : scorecards.map(sc => (
                    <Tr key={sc.id}>
                      <Td className="text-xs text-gray-500 font-mono">{sc.application_id?.slice(0, 8)}…</Td>
                      <Td>
                        {sc.overall_rating !== null ? (
                          <div className="flex items-center gap-0.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className={`h-3.5 w-3.5 ${i < sc.overall_rating! ? 'text-amber-400 fill-current' : 'text-gray-200'}`} />
                            ))}
                          </div>
                        ) : '—'}
                      </Td>
                      <Td className="text-sm text-gray-600 max-w-xs truncate">{sc.notes ?? '—'}</Td>
                      <Td className="text-xs text-gray-400">{sc.created_at?.slice(0, 10)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'assessment' && (
        <Card data-testid="assessment-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Skills Assessment</h2>
            <p className="text-xs text-gray-400 mt-0.5">MCQ + coding test — rule-based scoring (no LLM)</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {candidate?.skills?.slice(0, 3).map((skill, i) => (
                <AssessmentQuestion key={skill} skill={skill} questionNum={i + 1} />
              ))}
              {(!candidate?.skills || candidate.skills.length === 0) && (
                <p className="text-sm text-gray-400">No skills defined for this candidate</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'video' && (
        <Card data-testid="video-panel">
          <CardHeader>
            <h2 className="font-semibold text-gray-800">Async Video Screening</h2>
            <p className="text-xs text-gray-400 mt-0.5">One-way video interview — candidates record responses on their schedule</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-gray-400">
              <Video className="h-16 w-16 text-gray-200" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600">Video screening not yet configured</p>
                <p className="text-xs mt-1">Send the candidate a video screening link to collect responses</p>
              </div>
              <button className="px-4 py-2 text-sm font-medium bg-[--color-primary] text-white rounded-lg hover:bg-[--color-primary-dark] transition-colors">
                Send Screening Link
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const MOCK_QUESTIONS: Record<string, { q: string; options: string[]; correct: number }> = {
  Python: {
    q: 'Which of the following is NOT a valid Python data type?',
    options: ['list', 'tuple', 'pointer', 'dict'],
    correct: 2,
  },
  SQL: {
    q: 'Which SQL clause is used to filter grouped results?',
    options: ['WHERE', 'HAVING', 'GROUP BY', 'ORDER BY'],
    correct: 1,
  },
  Java: {
    q: 'Which keyword makes a variable constant in Java?',
    options: ['const', 'final', 'static', 'immutable'],
    correct: 1,
  },
};

function AssessmentQuestion({ skill, questionNum }: { skill: string; questionNum: number }) {
  const [selected, setSelected] = useState<number | null>(null);
  const q = MOCK_QUESTIONS[skill] ?? {
    q: `What is the primary use case of ${skill}?`,
    options: ['Data processing', 'UI development', 'Networking', 'Database management'],
    correct: 0,
  };
  const answered = selected !== null;
  const correct = selected === q.correct;

  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-gray-800">
        Q{questionNum} ({skill}): {q.q}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {q.options.map((opt, i) => (
          <button
            key={i}
            disabled={answered}
            onClick={() => setSelected(i)}
            className={[
              'text-left text-sm px-3 py-2 rounded-lg border transition-colors',
              answered && i === q.correct ? 'border-green-400 bg-green-50 text-green-700' :
              answered && i === selected ? 'border-red-300 bg-red-50 text-red-700' :
              !answered ? 'border-gray-200 hover:border-[--color-primary] hover:bg-[--color-surface-alt]' :
              'border-gray-100 text-gray-400',
            ].join(' ')}
          >
            {opt}
          </button>
        ))}
      </div>
      {answered && (
        <p className={`text-xs font-medium ${correct ? 'text-green-600' : 'text-red-600'}`}>
          {correct ? '✓ Correct!' : `✗ Correct answer: ${q.options[q.correct]}`}
        </p>
      )}
    </div>
  );
}
