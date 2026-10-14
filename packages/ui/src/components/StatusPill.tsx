import { type JobStatus, JOB_STATUS_LABELS as LABELS } from '@factwright/core';
import type { Tone } from '../tokens.ts';
import { Pill } from './Pill.tsx';

/**
 * How each job status reads on screen, and its tint: cool before applying, a color for each
 * step after, and gray once it's closed.
 */
export const JOB_STATUS_DISPLAY: Readonly<Record<JobStatus, { label: string; tone: Tone }>> = {
  new: { label: LABELS.new, tone: 'gray' },
  review: { label: LABELS.review, tone: 'slate' },
  apply: { label: LABELS.apply, tone: 'violet' },
  later: { label: LABELS.later, tone: 'amber' },
  applied: { label: LABELS.applied, tone: 'blue' },
  screen: { label: LABELS.screen, tone: 'teal' },
  interview: { label: LABELS.interview, tone: 'purple' },
  offer: { label: LABELS.offer, tone: 'green' },
  accepted: { label: LABELS.accepted, tone: 'green' },
  declined: { label: LABELS.declined, tone: 'gray' },
  rejected: { label: LABELS.rejected, tone: 'gray' },
  ghosted: { label: LABELS.ghosted, tone: 'gray' },
  withdrawn: { label: LABELS.withdrawn, tone: 'gray' },
  passed: { label: LABELS.passed, tone: 'gray' },
  'role-closed': { label: LABELS['role-closed'], tone: 'gray' },
};

/** A job's status as a tinted label. */
export function StatusPill({ status }: { status: JobStatus }) {
  const { label, tone } = JOB_STATUS_DISPLAY[status];
  return <Pill tone={tone}>{label}</Pill>;
}
