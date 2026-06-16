'use client';

import Link from 'next/link';
import { Briefcase, ChevronRight, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch } from '@/lib/useFetch';

interface Requisition {
  id: string;
  title: string;
  status: string;
  location: string;
  employment_type: string;
  skills_required: string[];
}

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  on_hold: 'bg-amber-100 text-amber-700',
  closed: 'bg-gray-100 text-gray-500',
  filled: 'bg-blue-100 text-blue-700',
};

export default function PipelinePage() {
  const { data: reqs, loading } = useFetch<Requisition[]>('/requisitions');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">T2 Kanban</h1>
        <p className="text-sm text-gray-500 mt-1">Select a requisition to view its pipeline</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : (
        <div className="grid gap-3" data-testid="requisition-list">
          {(reqs ?? []).map(req => (
            <Link key={req.id} href={`/pipeline/${req.id}`}>
              <Card className="hover:border-[--color-primary] transition-colors cursor-pointer">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="p-2 bg-[--color-surface-alt] rounded-lg shrink-0">
                    <Briefcase className="h-5 w-5 text-[--color-primary]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">{req.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[req.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {req.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      {req.location && (
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />{req.location}
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{req.employment_type}</span>
                      {req.skills_required?.slice(0, 3).map(s => (
                        <span key={s} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{s}</span>
                      ))}
                      {(req.skills_required?.length ?? 0) > 3 && (
                        <span className="text-xs text-gray-400">+{req.skills_required.length - 3}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
          {reqs?.length === 0 && (
            <p className="text-center text-gray-400 py-12">No requisitions found</p>
          )}
        </div>
      )}
    </div>
  );
}
