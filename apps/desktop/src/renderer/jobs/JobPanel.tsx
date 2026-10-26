import {
  type Job,
  type JobStatus,
  type KindName,
  type KindTarget,
  kindNamed,
  type PassReason,
  payLabel,
  readApplySteps,
} from '@factwright/core';
import {
  FitBadge,
  IconButton,
  Markdown,
  MarkdownLine,
  Notice,
  Select,
  StatusSelect,
} from '@factwright/ui';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  NotebookPen,
  X,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { EditResult, FactwrightApi, JobChanges } from '../../shared/api.ts';
import { ApplicationSection } from './ApplicationSection.tsx';
import { AskSection } from './AskSection.tsx';
import { focusNext, PassedBox, SetAsideBox } from './Decide.tsx';
import { EditDetails, MaybeSameNotes } from './EditDetails.tsx';
import { FitArea } from './FitArea.tsx';
import { CallsSection, type InviteMe } from './JobCalls.tsx';
import { SavedSection } from './JobFiles.tsx';
import { JobNotes, notesSummary } from './JobNotes.tsx';
import styles from './JobPanel.module.css';
import { ArchiveFooter, HistorySection, ProgressSection } from './JobTracking.tsx';
import { PanelSection } from './PanelSection.tsx';
import { PeopleSection } from './PeopleSection.tsx';
import { ResumesSection } from './ResumesSection.tsx';
import type { RunControls } from './RunActions.tsx';
import type { JobRow } from './rows.ts';
import { UpNext } from './UpNext.tsx';
import type { ReminderSwitch } from './useCallReminders.ts';

/** Special steps for applying, up top, because they change what the user does next. */
function ApplySection({ markdown }: { markdown: string }) {
  const { alert, email, subject, steps } = readApplySteps(markdown);
  const mail =
    email && `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return (
    <div className={styles.apply}>
      <Notice title="How to apply">
        {alert && (
          <p className={styles.applyAlert}>
            <MarkdownLine text={alert} />
          </p>
        )}
        {(email || subject) && (
          <dl className={styles.facts}>
            {email && mail && (
              <div>
                <dt>Email</dt>
                <dd>
                  <a className={styles.link} href={mail} target="_blank" rel="noreferrer">
                    {email}
                  </a>
                </dd>
              </div>
            )}
            {subject && (
              <div>
                <dt>Subject</dt>
                <dd>{subject}</dd>
              </div>
            )}
          </dl>
        )}
        {steps && <Markdown text={steps} />}
      </Notice>
    </div>
  );
}

/** Moving through the jobs in the list while one has the window to itself. */
export interface PanelNavigation {
  /** Where the job is in the list, from 1. */
  index: number;
  count: number;
  onStep: (offset: -1 | 1) => void;
}

export interface JobPanelProps {
  row: JobRow | null;
  api: FactwrightApi;
  /** The kinds of job the user wants, when there's more than one, to put the job under one. */
  kinds?: readonly KindName[];
  /** Each kind of job the user wants, with their target pay for it, for the pay to ask for. */
  targets?: readonly KindTarget[];
  today: string;
  onClose: () => void;
  /** Claude's panel, so the job's Run buttons can start skills. */
  run?: RunControls;
  /** Whether the job has the window to itself, in place of the list. */
  expanded?: boolean;
  /** Gives the job the window to itself, or puts it back beside the list. */
  onExpand?: (expanded: boolean) => void;
  navigation?: PanelNavigation;
  /** Called when the user marks a job's offer accepted, to offer to withdraw from the rest. */
  onAccepted?: (jobId: string) => void;
  /** The user's other jobs at the same company, for the history with it. */
  related?: readonly Job[];
  /** The user, whom an invite dropped on the form to add a call names among its people. */
  me?: InviteMe;
  /** Reminders before calls, and the switch to turn them off. */
  reminders?: ReminderSwitch | undefined;
  /** Opens Merge with…, for a job found twice, with the other job picked when Claude noted one. */
  onMerge?: ((otherId?: string) => void) | undefined;
  /** Another job, by its ID, while it's on the list, as one Claude noted might be this one. */
  lookUp?: ((jobId: string) => Job | null) | undefined;
}

/**
 * Everything on file for the job picked in the list. At the top, what to do next, then how well
 * the job fits. Under them, an area for each kind of thing, such as resumes and cover letters,
 * where it shows or gets made, then the user's own progress. Areas with things in them open and
 * close, and those with nothing yet say what goes there, with the button that makes it.
 */
export function JobPanel({
  row,
  api,
  kinds = [],
  targets = [],
  today,
  onClose,
  run,
  expanded = false,
  onExpand,
  navigation,
  onAccepted,
  related = [],
  me,
  reminders,
  onMerge,
  lookUp = () => null,
}: JobPanelProps) {
  const [problem, setProblem] = useState<{ jobId: string; message: string } | null>(null);
  // The job whose details are open to change, in boxes under its name. Once they close, the
  // keyboard's focus goes back to Edit details.
  const [editing, setEditing] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const stopEditing = () => {
    setEditing(null);
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const jobId = row?.job.id;
  // When what had the keyboard's focus goes away, such as the row a job was picked from once
  // the job takes the window, or the arrows between jobs once it's put back, the panel takes
  // it, so Escape and Tab keep working.
  useEffect(() => {
    const focused = document.activeElement;
    if (jobId && (!focused || focused === document.body)) {
      panel.current?.focus({ preventScroll: true });
    }
  }, [expanded, jobId]);
  // A quick choice takes away the button that made it, so the keyboard's focus goes on to what
  // comes next: a reason or a day to give, the choices left, or else the status menu.
  const top = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const shownStatus = row?.progress.status;
  const backOn = row?.job.backOn;
  useEffect(() => {
    if (!refocus.current || !shownStatus) return;
    refocus.current = false;
    if (!focusNext(top.current))
      panel.current?.querySelector<HTMLElement>('header select')?.focus();
  }, [shownStatus, backOn]);
  // Until a job is picked, the list has the room.
  if (!row) return null;
  const { job, progress } = row;
  const pay = payLabel(job.pay) ?? job.pay?.text;
  // The newest search that found it, and whether the job was on file before it.
  const newest = job.search?.source ?? job.searches.at(-1)?.source;
  const found = newest && `${job.search?.again ? 'Found again in' : 'Found in'} ${newest}`;
  const meta = [job.location, pay, found].filter(Boolean).join(' · ');
  // A job nobody has put under a kind, and no search or fit check found as one, is under the first
  // kind until a fit check says. Picking that kind keeps it there.
  const decided = kindNamed(job.kind, kinds) ?? kindNamed(job.kindFound, kinds);

  const save = async (edit: Promise<EditResult>) => {
    const result = await edit;
    setProblem(result.ok ? null : { jobId: job.id, message: result.message });
    return result.ok;
  };
  const change = (changes: JobChanges) => save(api.updateJob(job.id, changes));
  const changeStatus = async (status: JobStatus) => {
    const saved = await change({ status });
    if (saved && status === 'accepted') onAccepted?.(job.id);
    return saved;
  };
  // Setting a job aside again, once its day has come, starts it over with no day.
  const move = async (status: JobStatus) => {
    refocus.current = true;
    const saved = await (status === 'later' && progress.status === 'later'
      ? change({ backOn: null })
      : changeStatus(status));
    if (!saved) refocus.current = false;
  };
  // A day to come back, or Undo, also takes away the button that made it.
  const followUp = async (edit: Promise<EditResult>) => {
    refocus.current = true;
    if (!(await save(edit))) refocus.current = false;
  };
  const undo = (changeId: string) => followUp(api.undoStatusChange(changeId));
  const { status } = progress;
  const sorting =
    Boolean(job.role) &&
    (status === 'new' || status === 'review' || (status === 'later' && progress.backFromLater));
  // Escape puts an expanded job back beside the list first, then closes it.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (expanded && onExpand) onExpand(false);
    else onClose();
  };

  const upTop = (
    <div ref={top} className={styles.top}>
      <UpNext row={row} api={api} run={run} sorting={sorting} onMove={(to) => void move(to)} />
      <MaybeSameNotes job={job} lookUp={lookUp} api={api} onMerge={onMerge} />
      {status === 'later' && !progress.backFromLater && (
        <SetAsideBox
          job={job}
          today={today}
          onBackOn={(backOn) => followUp(api.updateJob(job.id, { backOn }))}
          onUndo={undo}
        />
      )}
      {status === 'passed' && (
        <PassedBox
          job={job}
          onReason={(passReason: PassReason | null) => change({ passReason })}
          onUndo={undo}
        />
      )}
      {job.apply && <ApplySection markdown={job.apply} />}
    </div>
  );
  const fromClaude: ReactNode[] = [
    <ResumesSection key={`files-${job.id}`} job={job} api={api} today={today} run={run} />,
    <ApplicationSection key={`answers-${job.id}`} job={job} api={api} today={today} run={run} />,
    <PeopleSection key={`people-${job.id}`} job={job} api={api} today={today} run={run} />,
    <AskSection key={`ask-${job.id}`} job={job} api={api} run={run} today={today} />,
    <SavedSection key={`saved-${job.id}`} job={job} api={api} today={today} />,
  ];
  const yourProgress: ReactNode[] = [
    <ProgressSection
      key={`progress-${job.id}`}
      job={job}
      progress={progress}
      api={api}
      today={today}
    />,
    <CallsSection
      key={`calls-${job.id}`}
      job={job}
      progress={progress}
      api={api}
      today={today}
      run={run}
      me={me}
      reminders={reminders}
    />,
    <PanelSection
      key="notes"
      id="notes"
      title="Notes"
      icon={<NotebookPen size={15} />}
      summary={notesSummary(job)}
    >
      <JobNotes key={job.id} job={job} api={api} today={today} />
    </PanelSection>,
    <HistorySection key="activity" job={job} related={related} today={today} />,
  ];

  return (
    <aside
      ref={panel}
      className={`${styles.panel} ${expanded ? styles.expanded : ''}`}
      aria-label="Job details"
      tabIndex={-1}
      onKeyDown={onEscape}
    >
      <div className={styles.inner}>
        <header className={styles.head}>
          <div className={styles.headRow}>
            <div className={styles.title}>
              <p className={styles.company}>{job.company}</p>
              <h2 className={styles.role}>{job.role || 'Company outreach'}</h2>
            </div>
            <div className={styles.tools}>
              {expanded && navigation && navigation.count > 1 && (
                <span className={styles.stepper}>
                  <IconButton
                    label="Previous job"
                    variant="quiet"
                    size="sm"
                    icon={<ChevronLeft size={16} aria-hidden="true" />}
                    // Not disabled outright, so the keyboard's focus stays at the list's end.
                    aria-disabled={navigation.index <= 1}
                    onClick={() => navigation.index > 1 && navigation.onStep(-1)}
                  />
                  <span className={styles.position}>
                    {navigation.index} of {navigation.count}
                  </span>
                  <IconButton
                    label="Next job"
                    variant="quiet"
                    size="sm"
                    icon={<ChevronRight size={16} aria-hidden="true" />}
                    aria-disabled={navigation.index >= navigation.count}
                    onClick={() => navigation.index < navigation.count && navigation.onStep(1)}
                  />
                </span>
              )}
              {onExpand && (
                <IconButton
                  label={expanded ? 'Show beside the list' : 'Expand'}
                  variant="quiet"
                  icon={
                    expanded ? (
                      <Minimize2 size={15} aria-hidden="true" />
                    ) : (
                      <Maximize2 size={15} aria-hidden="true" />
                    )
                  }
                  onClick={() => onExpand(!expanded)}
                />
              )}
              <IconButton
                label="Close details"
                variant="quiet"
                icon={<X size={16} aria-hidden="true" />}
                onClick={onClose}
              />
            </div>
          </div>
          <p className={styles.where}>
            {meta}
            {meta && job.link && ' · '}
            {job.link && (
              <a className={styles.link} href={job.link} target="_blank" rel="noreferrer">
                Posting
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            )}
            {(meta || job.link) && ' · '}
            <button
              ref={editButton}
              type="button"
              className={styles.editDetails}
              aria-expanded={editing === job.id}
              onClick={() => setEditing(editing === job.id ? null : job.id)}
            >
              Edit details
            </button>
          </p>
          <div className={styles.badges}>
            <StatusSelect
              status={progress.status}
              label={`Status for ${job.company}`}
              onChange={changeStatus}
            />
            <FitBadge score={progress.score} tier={progress.tier} />
            {kinds.length > 1 && row.kind && (
              <Select
                className={styles.kind}
                aria-label={`Kind of job for ${job.company}`}
                value={decided ?? ''}
                onChange={(event) => change({ kind: event.target.value })}
              >
                {!decided && <option value="">{row.kind.name}, until a fit check</option>}
                {kinds.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          {problem?.jobId === job.id && (
            <p className={styles.problem} role="alert">
              {problem.message}
            </p>
          )}
        </header>

        {editing === job.id && (
          <EditDetails key={job.id} job={job} api={api} onClose={stopEditing} />
        )}
        {upTop}
        <FitArea
          job={job}
          progress={progress}
          run={run}
          today={today}
          api={api}
          targets={targets}
        />
        {/* The same two columns either way, side by side only when expanded, so expanding
            never loses what's being typed. */}
        <div className={styles.columns}>
          <section className={styles.column} aria-labelledby={`${panelId}-claude`}>
            <h3 id={`${panelId}-claude`} className={styles.columnHeading}>
              From your Claude
            </h3>
            {fromClaude}
          </section>
          <section className={styles.column} aria-labelledby={`${panelId}-progress`}>
            <h3 id={`${panelId}-progress`} className={styles.columnHeading}>
              Your progress
            </h3>
            {yourProgress}
          </section>
        </div>
        <ArchiveFooter job={job} api={api} onMerge={onMerge && (() => onMerge())} />
      </div>
    </aside>
  );
}
