import type { JobStatus } from '@factwright/core';
import type { Tone } from '../tokens.ts';
import { Pill } from './Pill.tsx';

/** How each job status reads on screen, and its tint. */
export const JOB_STATUS_DISPLAY: Readonly<Record<JobStatus, { label: string; tone: Tone }>> = {
  new: { label: 'New', tone: 'gray' },
  checked: { label: 'Checked', tone: 'slate' },
  resume: { label: 'Resume ready', tone: 'violet' },
  applied: { label: 'Applied', tone: 'blue' },
  screen: { label: 'Screen', tone: 'teal' },
  interview: { label: 'Interview', tone: 'purple' },
  offer: { label: 'Offer', tone: 'green' },
  accepted: { label: 'Accepted', tone: 'green' },
  declined: { label: 'Declined', tone: 'gray' },
  rejected: { label: 'Rejected', tone: 'gray' },
  ghosted: { label: 'No reply', tone: 'gray' },
  passed: { label: 'Passed', tone: 'gray' },
  withdrawn: { label: 'Withdrawn', tone: 'gray' },
};

/** A job's status as a tinted label. */
export function StatusPill({ status }: { status: JobStatus }) {
  const { label, tone } = JOB_STATUS_DISPLAY[status];
  return <Pill tone={tone}>{label}</Pill>;
}
