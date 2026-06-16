'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Users, Search, MapPin, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch } from '@/lib/useFetch';

interface Candidate {
  id: string;
  full_name: string;
  email: string;
  skills: string[];
  total_exp_mo: number;
  location: string;
  current_employer: string | null;
  source: string | null;
}

export default function CandidatesPage() {
  const [search, setSearch] = useState('');
  const query = search.length >= 2 ? `?q=${encodeURIComponent(search)}` : '';
  const { data: candidates, loading } = useFetch<Candidate[]>(`/candidates${query}`);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Candidates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {candidates ? `${candidates.length} candidates` : 'Loading...'}
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or resume…"
            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-[--color-primary] w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <div className="grid gap-3" data-testid="candidate-list">
          {(candidates ?? []).map(c => (
            <Link key={c.id} href={`/candidates/${c.id}`}>
              <Card className="hover:border-[--color-primary] transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="w-10 h-10 rounded-full bg-[--color-primary]/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-[--color-primary]">
                      {c.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{c.full_name}</span>
                      {c.current_employer && (
                        <span className="text-xs text-gray-400">@ {c.current_employer}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-500">{Math.floor(c.total_exp_mo / 12)}y exp</span>
                      {c.location && (
                        <span className="text-xs text-gray-500 flex items-center gap-0.5">
                          <MapPin className="h-3 w-3" />{c.location}
                        </span>
                      )}
                      {c.skills?.slice(0, 4).map(s => (
                        <span key={s} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{s}</span>
                      ))}
                      {(c.skills?.length ?? 0) > 4 && (
                        <span className="text-xs text-gray-400">+{c.skills.length - 4}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
          {candidates?.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2 text-gray-400">
              <Users className="h-10 w-10" />
              <p className="text-sm">No candidates found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
