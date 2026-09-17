'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { SkillExperienceEditor } from '@/components/candidates/SkillExperienceEditor';

interface Props {
  candidateId: string;
  candidateName: string;
  projectCount?: number; // optional hint from the row so the summary doesn't need its own fetch
}

export function ProjectDetailsCell({ candidateId, candidateName, projectCount }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        style={{ border: '1px solid #e2e8f0', background: '#f8fafc', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
        {projectCount ? `${projectCount} project${projectCount === 1 ? '' : 's'}` : 'Add projects'}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Project / Skill Details" subtitle={candidateName} size="lg">
        <SkillExperienceEditor candidateId={candidateId} onSaved={() => setOpen(false)} />
      </Modal>
    </>
  );
}
