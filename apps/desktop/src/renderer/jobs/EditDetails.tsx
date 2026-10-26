import { JOB_STATUS_LABELS, type Job, type OwnDetails } from '@factwright/core';
import { Button, Input, Notice } from '@factwright/ui';
import { useId, useState } from 'react';
import type { FactwrightApi, JobChanges } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './EditDetails.module.css';

/** Each detail the user can set, in the order Edit details shows them. */
const FIELDS: readonly {
  field: keyof OwnDetails;
  label: string;
  limit: number;
  placeholder?: string;
}[] = [
  { field: 'company', label: 'Company', limit: LIMITS.company },
  { field: 'role', label: 'Role', limit: LIMITS.role },
  { field: 'pay', label: 'Pay', limit: LIMITS.pay, placeholder: 'Such as $150k–$180k' },
  {
    field: 'location',
    label: 'Place',
    limit: LIMITS.location,
    placeholder: 'Such as Remote (US), or Hybrid in Austin',
  },
];

/** A detail as the job shows it now: the user's own, or else what the posting and Claude say. */
function shown(job: Job, field: keyof OwnDetails): string {
  if (field === 'company') return job.company;
  if (field === 'role') return job.role;
  if (field === 'pay') return job.pay?.text ?? '';
  return job.location ?? '';
}

/**
 * The job's company, role, pay and place, in boxes the user can change, as Edit details opens
 * them. A detail they change is their own from then on: it wins over what the posting says, and
 * Analyze job and the rest of Claude's work never change it. Emptying a box goes back to what the
 * posting says. Only the boxes the user changed are saved.
 */
export function EditDetails({
  job,
  api,
  onClose,
}: {
  job: Job;
  api: Pick<FactwrightApi, 'updateJob'>;
  onClose: () => void;
}) {
  // What each box opened with. A box the user didn't change is never saved, even when the job
  // changes meanwhile, as when a run of Claude's own puts its company right from the posting.
  const [opened] = useState<Record<keyof OwnDetails, string>>(() => ({
    company: shown(job, 'company'),
    role: shown(job, 'role'),
    pay: shown(job, 'pay'),
    location: shown(job, 'location'),
  }));
  const [values, setValues] = useState(opened);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const headingId = useId();
  const id = useId();

  const save = async () => {
    const changes: JobChanges = {};
    for (const { field } of FIELDS) {
      const typed = values[field].trim();
      if (typed !== opened[field].trim()) changes[field] = typed || null;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateJob(job.id, changes);
      if (result.ok) onClose();
      else setProblem(result.message);
    } catch {
      setProblem('Factwright couldn’t save that. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={styles.edit}
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        // Escape closes the boxes, never the job's panel.
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      }}
    >
      <h3 id={headingId} className={styles.heading}>
        Edit details
      </h3>
      <div className={styles.fields}>
        {FIELDS.map(({ field, label, limit, placeholder }, at) => (
          <div key={field} className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-${field}`}>
              {label}
              {job.own[field] && <span className={styles.yours}>Yours</span>}
            </label>
            <Input
              id={`${id}-${field}`}
              value={values[field]}
              maxLength={limit}
              placeholder={placeholder}
              autoFocus={at === 0}
              onChange={(event) => setValues((was) => ({ ...was, [field]: event.target.value }))}
            />
          </div>
        ))}
      </div>
      <p className={styles.hint}>
        What you change here is yours: it wins over the posting, and Claude never changes it. Empty
        a box to go back to what the posting says.
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <div className={styles.actions}>
        <Button size="sm" variant="primary" type="submit" disabled={saving}>
          Save
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The jobs Claude noted might be this one, without being sure enough to merge them, each with why,
 * Merge, which opens Merge with… on it, and Not the same, which takes the note away for good.
 */
export function MaybeSameNotes({
  job,
  lookUp,
  api,
  onMerge,
}: {
  job: Job;
  /** Another job, by its ID, while it's on the list. */
  lookUp: (jobId: string) => Job | null;
  api: Pick<FactwrightApi, 'notSameJob'>;
  /** Opens Merge with…, with the other job picked. */
  onMerge?: ((otherId: string) => void) | undefined;
}) {
  const [problem, setProblem] = useState<{ jobId: string; message: string } | null>(null);
  const notes = job.maybeSame.flatMap((note) => {
    const other = note.notSame ? null : lookUp(note.id);
    return other && other.id !== job.id ? [{ ...note, other }] : [];
  });
  if (notes.length === 0) return null;
  const notSame = async (otherId: string) => {
    const result = await api.notSameJob(job.id, otherId);
    setProblem(result.ok ? null : { jobId: job.id, message: result.message });
  };
  return (
    <div className={styles.notes}>
      {notes.map(({ other, why }) => {
        const where = [
          JOB_STATUS_LABELS[other.status ?? other.stage],
          other.search ? `Found in ${other.search.source}` : other.source,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Notice
            key={other.id}
            tone="info"
            title={`Might be the same as ${other.company}, ${other.role || 'Company outreach'}`}
          >
            {why && <p className={styles.why}>{why}</p>}
            {where && <p className={styles.other}>That job: {where}</p>}
            <div className={styles.noteActions}>
              {onMerge && (
                <Button size="sm" onClick={() => onMerge(other.id)}>
                  Merge…
                </Button>
              )}
              <Button size="sm" variant="quiet" onClick={() => void notSame(other.id)}>
                Not the same
              </Button>
            </div>
          </Notice>
        );
      })}
      {problem?.jobId === job.id && (
        <p className={styles.problem} role="alert">
          {problem.message}
        </p>
      )}
    </div>
  );
}
