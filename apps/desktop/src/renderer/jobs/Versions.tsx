import { type Job, type JobFile, resumeSent, shortDate } from '@factwright/core';
import { Button, Dialog, DialogActions, Pill, TextArea } from '@factwright/ui';
import { FileText } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { REVISE_SKILL } from '../../shared/revision.ts';
import type { RunTask, VersionSkill } from '../../shared/runs.ts';
import {
  type ChangeKind,
  type DocKind,
  type DocVersion,
  MAX_CHANGES,
} from '../../shared/versions.ts';
import { ClaudeButton, isRunning } from './ClaudeButton.tsx';
import panel from './JobPanel.module.css';
import type { RunControls } from './RunActions.tsx';
import styles from './Versions.module.css';

/** The skill that makes each kind, as New version starts it. */
const SKILLS: Readonly<Record<DocKind, VersionSkill>> = {
  resume: 'focused-resume',
  letter: 'cover-letter',
  projects: 'projects-page',
};

const NAMES: Readonly<Record<DocKind, string>> = {
  resume: 'resume',
  letter: 'cover letter',
  projects: 'Projects page',
};

/** When a version was built: when its newest file was written. */
const builtOn = (files: readonly JobFile[]) =>
  files.reduce((newest, file) => (file.modified > newest ? file.modified : newest), '');

/** Whether the user applied with this kind as it is now, so it stays as sent. */
export const keptAsSent = (job: Job, kind: DocKind) => kind !== 'projects' && resumeSent(job);

/** Why an earlier version was put aside, in a few words, such as before the user's changes. */
function aboutVersion(version: DocVersion): string {
  switch (version.why) {
    case 'changes':
      return version.changes ? `Before your changes: “${version.changes}”` : 'Before your changes';
    case 'revision':
      return 'Before its ATS X-ray revision';
    case 'swapped':
      return 'Set aside for an earlier version';
    default:
      return 'Before a new version';
  }
}

/**
 * New version for a job's resume, cover letter or Projects page: the app keeps the current one as
 * an earlier version, then Claude makes another. A resume has Quick version beside it, which asks
 * the user nothing and uses verified facts only. While either runs, one button says Claude is on
 * it. Nothing shows for one the user applied with.
 */
export function NewVersionButton({
  job,
  kind,
  api,
  run,
  onProblem,
}: {
  job: Job;
  kind: DocKind;
  api: FactwrightApi;
  run: RunControls | undefined;
  onProblem: (message: string | null) => void;
}) {
  if (keptAsSent(job, kind)) return null;
  const task: RunTask = { skill: SKILLS[kind], jobId: job.id, again: true };
  const start = async (next: RunTask) => {
    const kept = await api.keepVersion(job.id, kind);
    onProblem(kept.ok ? null : kept.message);
    if (kept.ok) run?.start(next);
  };
  const again = (
    <ClaudeButton run={run} task={task} label="New version" onStart={() => void start(task)} />
  );
  if (kind !== 'resume' || isRunning(run, task)) return again;
  const quick: RunTask = { skill: 'focused-resume', jobId: job.id, again: true, quick: true };
  return (
    <>
      {again}
      <ClaudeButton
        run={run}
        task={quick}
        label="Quick version"
        onStart={() => void start(quick)}
      />
    </>
  );
}

/**
 * Request changes for a job's resume or cover letter: the user says what to change in their own
 * words, which the app keeps for the run, never typed into it, with the current version, so they
 * can go back to it.
 */
export function RequestChanges({
  job,
  kind,
  api,
  run,
}: {
  job: Job;
  kind: ChangeKind;
  api: FactwrightApi;
  run: RunControls | undefined;
}) {
  const [open, setOpen] = useState(false);
  // While Claude makes a new one, New version says Claude is on it, so this waits out of sight.
  const making = isRunning(run, { skill: SKILLS[kind], jobId: job.id });
  if (keptAsSent(job, kind) || making) return null;
  const task: RunTask =
    kind === 'resume'
      ? { skill: REVISE_SKILL, jobId: job.id, changes: true }
      : { skill: 'cover-letter', jobId: job.id, changes: true };
  return (
    <>
      <ClaudeButton run={run} task={task} label="Request changes" onStart={() => setOpen(true)} />
      {open && (
        <ChangesDialog
          job={job}
          kind={kind}
          api={api}
          onAsked={() => {
            // Closed here too: once the run starts, this steps aside before the dialog says so.
            setOpen(false);
            run?.start(task);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const PLACEHOLDERS: Readonly<Record<ChangeKind, string>> = {
  resume: 'Such as: lead with the platform work, keep it to one page, and leave off the 2015 job',
  letter: 'Such as: make it shorter, and open with why I want to work there',
};

/** What the user wants changed, in their own words, and the button that asks Claude for it. */
function ChangesDialog({
  job,
  kind,
  api,
  onAsked,
  onClose,
}: {
  job: Job;
  kind: ChangeKind;
  api: FactwrightApi;
  onAsked: () => void;
  onClose: () => void;
}) {
  const [changes, setChanges] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (!changes.trim()) return;
    setAsking(true);
    const result = await api.requestChanges({ jobId: job.id, kind, changes });
    setAsking(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    close();
    onAsked();
  };
  return (
    <Dialog
      title={`Changes to your ${NAMES[kind]}`}
      description={`Say what to change, in your own words. Your Claude makes the changes from your facts, and keeps this ${NAMES[kind]} as an earlier version, so you can go back to it.`}
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => ask(event, close)}>
          <TextArea
            className={styles.changes}
            aria-label="What to change"
            placeholder={PLACEHOLDERS[kind]}
            rows={4}
            maxLength={MAX_CHANGES}
            value={changes}
            onChange={(event) => setChanges(event.target.value)}
            data-autofocus
          />
          {problem && (
            <p className={panel.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={asking || !changes.trim()}>
              Make the changes
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

/** One earlier version: when it was built, why it was put aside, and what can be done with it. */
function VersionRow({
  version,
  api,
  jobId,
  today,
  sent,
  onPreview,
  onProblem,
}: {
  version: DocVersion;
  api: FactwrightApi;
  jobId: string;
  today: string;
  /** Whether the job's own version went out with the application, so it stays. */
  sent: boolean;
  onPreview: (file: JobFile) => void;
  onProblem: (message: string | null) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  // The button that was pressed goes away, so the focus moves to the one in its place.
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    (removing ? keepButton : removeButton).current?.focus();
  }, [removing]);
  const confirming = (next: boolean) => {
    toggled.current = true;
    setRemoving(next);
  };
  const pdf = version.files.find((file) => file.format === 'pdf');
  const built = builtOn(version.files);
  const when = built ? shortDate(built, today) : '';
  const act = async (edit: Promise<{ ok: true } | { ok: false; message: string }>) => {
    const result = await edit;
    onProblem(result.ok ? null : result.message);
  };
  return (
    <li className={styles.version}>
      <FileText className={panel.fileIcon} size={16} aria-hidden="true" />
      <span className={panel.fileText}>
        <span className={panel.fileName}>{when ? `Built ${when}` : 'Earlier version'}</span>
        <span className={`${panel.fileMeta} ${styles.why}`}>{aboutVersion(version)}</span>
      </span>
      <span className={panel.fileActions}>
        {removing ? (
          <>
            <span className={styles.confirm} role="status">
              Move it to the Trash?
            </span>
            <Button size="sm" onClick={() => void act(api.removeVersion(jobId, version.folder))}>
              Remove
            </Button>
            <Button ref={keepButton} size="sm" variant="quiet" onClick={() => confirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <>
            {pdf && (
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Preview the version built ${when}`}
                onClick={() => onPreview(pdf)}
              >
                Preview
              </Button>
            )}
            {version.usable && !sent && (
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Use the version built ${when}`}
                onClick={() => void act(api.useVersion(jobId, version.folder))}
              >
                Use this
              </Button>
            )}
            <Button
              ref={removeButton}
              size="sm"
              variant="quiet"
              aria-label={`Remove the version built ${when}`}
              onClick={() => confirming(true)}
            >
              Remove
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * A job's earlier versions of one kind, newest first, folded under the one it has now: each to
 * preview, use again, or move to the Trash. One the user applied with stays the job's, so the
 * earlier ones can't take its place.
 */
export function EarlierVersions({
  job,
  kind,
  versions,
  api,
  today,
  onPreview,
  onProblem,
}: {
  job: Job;
  kind: DocKind;
  versions: readonly DocVersion[];
  api: FactwrightApi;
  today: string;
  onPreview: (file: JobFile) => void;
  onProblem: (message: string | null) => void;
}) {
  const mine = versions.filter((version) => version.kind === kind);
  if (mine.length === 0) return null;
  return (
    <details className={styles.earlier}>
      <summary>
        Earlier versions <span className={styles.count}>({mine.length})</span>
      </summary>
      <ul className={panel.files} aria-label={`Earlier versions of the ${NAMES[kind]}`}>
        {mine.map((version) => (
          <VersionRow
            key={version.folder}
            version={version}
            api={api}
            jobId={job.id}
            today={today}
            sent={keptAsSent(job, kind)}
            onPreview={onPreview}
            onProblem={onProblem}
          />
        ))}
      </ul>
    </details>
  );
}

/** "Sent", beside a resume or letter the user applied with, which stays as it went out. */
export function SentPill({ job, kind }: { job: Job; kind: DocKind }) {
  return keptAsSent(job, kind) ? <Pill tone="green">Sent</Pill> : null;
}
