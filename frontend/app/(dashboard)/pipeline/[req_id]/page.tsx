'use client';

import { useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Zap, X } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch, apiFetch } from '@/lib/useFetch';

const STAGES = ['sourced', 'contacted', 'interested', 'nda', 'screened', 'submitted', 'l1_interview', 'l2_interview', 'offer', 'offer_accepted', 'placed', 'rejected', 'hold'] as const;
const STAGE_LABEL: Record<string, string> = {
  sourced: 'Sourced',
  screened: 'Screened',
  submitted: 'Submitted',
  interview: 'Interview',
  offer: 'Offer',
  placed: 'Placed',
  rejected: 'Rejected',
};
const STAGE_COLOR: Record<string, string> = {
  sourced: 'border-t-gray-400',
  screened: 'border-t-blue-400',
  submitted: 'border-t-indigo-400',
  interview: 'border-t-purple-400',
  offer: 'border-t-amber-400',
  placed: 'border-t-green-500',
  rejected: 'border-t-red-400',
};

type Stage = (typeof STAGES)[number] | 'rejected';

interface PipelineCard {
  id: string;
  candidate_id: string;
  candidate_name: string;
  skills: string[];
  total_exp_mo: number;
  stage: Stage;
  fit_score: number | null;
}

interface MatchCandidate {
  candidate_id: string;
  full_name: string;
  fit_score: number;
  skill_overlap: number;
  skills: string[];
}

interface Requisition {
  id: string;
  title: string;
  status: string;
  location: string;
  skills_required: string[];
}

export default function KanbanPage() {
  const { req_id } = useParams<{ req_id: string }>();
  const { data: req } = useFetch<Requisition>(req_id ? `/requisitions/${req_id}` : null);
  const { data: pipeline, loading, refetch } = useFetch<Record<string, PipelineCard[]>>(
    req_id ? `/requisitions/${req_id}/pipeline` : null
  );

  const [moving, setMoving] = useState<string | null>(null);
  const [matchOpen, setMatchOpen] = useState(false);
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  const moveCard = useCallback(async (appId: string, newStage: string) => {
    setMoving(appId);
    try {
      await apiFetch(`/applications/${appId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: newStage }),
      });
      refetch();
    } catch {
      // stage transition failed (e.g. non-admin rejecting)
    } finally {
      setMoving(null);
    }
  }, [refetch]);

  const loadMatches = useCallback(async () => {
    setMatchOpen(true);
    setMatchLoading(true);
    setMatchError(null);
    try {
      const data = await apiFetch(`/requisitions/${req_id}/match-candidates?limit=5`);
      setMatches(data);
    } catch (e) {
      setMatchError(String(e));
    } finally {
      setMatchLoading(false);
    }
  }, [req_id]);

  const allStages: Stage[] = [...STAGES, 'rejected'];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/pipeline" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{req?.title ?? 'Pipeline'}</h1>
          {req && (
            <p className="text-sm text-gray-500">{req.location} · {req.skills_required?.slice(0, 3).join(', ')}</p>
          )}
        </div>
        <button
          onClick={loadMatches}
          disabled={matchLoading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-[--color-primary] text-white rounded-lg hover:bg-[--color-primary-dark] disabled:opacity-60 transition-colors"
        >
          {matchLoading ? <Spinner size="sm" /> : <Zap className="h-4 w-4" />}
          Match Candidates
        </button>
      </div>

      {/* AI Matches panel */}
      {matchOpen && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Zap className="h-4 w-4 text-[--color-primary]" />
                Top Candidate Matches
              </h2>
              <button onClick={() => setMatchOpen(false)} aria-label="Close matches">
                <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {matchLoading ? (
              <div className="flex justify-center py-4"><Spinner /></div>
            ) : (
              <div className="flex flex-wrap gap-3" data-testid="match-cards">
                {matchError && (
                  <p className="text-sm text-red-600 w-full">{matchError}</p>
                )}
                {matches.map(m => (
                  <div key={m.candidate_id} className="flex-1 min-w-[160px] p-3 bg-[--color-surface-alt] rounded-lg">
                    <p className="font-medium text-sm text-gray-800">{m.full_name}</p>
                    <p className="text-xs text-[--color-primary] font-semibold mt-0.5">
                      Fit: {m.fit_score}% · {m.skill_overlap} skills matched
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {m.skills?.slice(0, 3).map(s => (
                        <span key={s} className="text-xs bg-white border border-gray-200 text-gray-600 px-1 rounded">{s}</span>
                      ))}
                    </div>
                  </div>
                ))}
                {!matchError && matches.length === 0 && (
                  <p className="text-sm text-gray-400">No matches found</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Kanban board */}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4" data-testid="kanban-board">
          {allStages.map(stage => {
            const cards = pipeline?.[stage] ?? [];
            return (
              <div
                key={stage}
                className={`flex-shrink-0 w-64 bg-gray-50 rounded-xl border-t-4 ${STAGE_COLOR[stage]} border border-gray-200`}
                data-stage={stage}
              >
                <div className="px-3 py-2.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    {STAGE_LABEL[stage]}
                  </span>
                  <span className="text-xs bg-white border border-gray-200 rounded-full px-2 py-0.5 text-gray-500">
                    {cards.length}
                  </span>
                </div>

                <div className="px-2 pb-2 space-y-2 min-h-[120px]">
                  {cards.map(card => (
                    <ApplicationCard
                      key={card.id}
                      card={card}
                      stages={allStages}
                      moving={moving === card.id}
                      onMove={(newStage) => moveCard(card.id, newStage)}
                    />
                  ))}
                  {cards.length === 0 && (
                    <p className="text-xs text-gray-300 text-center pt-6">Empty</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ApplicationCard({
  card, stages, moving, onMove,
}: {
  card: PipelineCard;
  stages: Stage[];
  moving: boolean;
  onMove: (stage: string) => void;
}) {
  const currentIdx = stages.indexOf(card.stage);
  const prevStage = currentIdx > 0 ? stages[currentIdx - 1] : null;
  const nextStage = currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;
  const expYears = Math.floor(card.total_exp_mo / 12);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 leading-tight">{card.candidate_name}</p>
        {card.fit_score !== null && (
          <span className="text-xs font-semibold text-[--color-primary] shrink-0">{card.fit_score}%</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{expYears}y exp</p>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {card.skills?.slice(0, 3).map(s => (
          <span key={s} className="text-xs bg-gray-50 border border-gray-100 text-gray-500 px-1 rounded">{s}</span>
        ))}
      </div>
      {moving ? (
        <div className="flex justify-center mt-2"><Spinner size="sm" /></div>
      ) : (
        <div className="flex gap-1 mt-2">
          {prevStage && (
            <button
              onClick={() => onMove(prevStage)}
              className="flex-1 text-xs py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors"
            >
              ← {STAGE_LABEL[prevStage]}
            </button>
          )}
          {nextStage && (
            <button
              onClick={() => onMove(nextStage)}
              className="flex-1 text-xs py-1 rounded bg-[--color-primary] hover:bg-[--color-primary-dark] text-white transition-colors"
            >
              {STAGE_LABEL[nextStage]} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
