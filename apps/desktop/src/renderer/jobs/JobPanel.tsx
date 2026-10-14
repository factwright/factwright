import {
  type Job,
  type JobStatus,
  type PassReason,
  payLabel,
  readApplySteps,
} from '@factwright/core';
import {
  FIT_TIER_DISPLAY,
  FitBadge,
  IconButton,
  Markdown,
  MarkdownLine,
  Notice,
  StatusSelect,
} from '@factwright/ui';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Maximize2,
  Minimize2,
  NotebookPen,
  Sparkles,
  X,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { EditResult, FactwrightApi, JobChanges } from '../../shared/api.ts';
import { ApplicationSection } from './ApplicationSection.tsx';
import { AskSection } from './AskSection.tsx';
import { focusNext, PassedBox, SetAsideBox, SortButtons } from './Decide.tsx';
import { FilesSection } from './JobFiles.tsx';
import { JobNotes, notesSummary } from './JobNotes.tsx';
import styles from './JobPanel.module.css';
import { ScoreSection, SearchSection, SentimentSection } from './JobScore.tsx';
import { ActivitySection, ArchiveFooter, NextStep, ProgressSection } from './JobTracking.tsx';
import { PanelSection } from './PanelSection.tsx';
import { BUSY, RunActions, type RunControls } from './RunActions.tsx';
import type { JobRow } from './rows.ts';

const NEXT_TONE = { urgent: styles.urgent, action: styles.action, info: styles.info } as const;

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

/** What Claude has done for the job, in a few words, for its section's heading. */
function claudeSummary(job: Job): string {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return (
    [
      job.fit && 'Fit checked',
      job.files.length > 0 && 'Resume ready',
      job.asks.length > 0 && plural(job.asks.length, 'question'),
    ]
      .filter(Boolean)
      .join(' · ') || 'Nothing run yet'
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
}

/** Everything on file for the job picked in the list, in sections that open and close. */
export function JobPanel({
  row,
  api,
  today,
  onClose,
  run,
  expanded = false,
  onExpand,
  navigation,
  onAccepted,
}: JobPanelProps) {
  const [problem, setProblem] = useState<{ jobId: string; message: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
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
  if (!row) {
    return (
      <aside className={`${styles.panel} ${styles.empty}`} aria-label="Job details">
        <p className={styles.placeholder}>Pick a job to see everything on file for it.</p>
      </aside>
    );
  }
  const { job, progress, next } = row;
  const pay = payLabel(job.pay) ?? job.pay?.text;
  const found = job.searches[0]?.source;
  const meta = [job.location, pay, found && `Found in ${found}`].filter(Boolean).join(' · ');
  const attention = progress.attention;
  const fit = progress.tier
    ? `${FIT_TIER_DISPLAY[progress.tier].label}${progress.score !== null ? ` ${progress.score}` : ''}`
    : 'Not scored yet';

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
  const undo = (changeId: string) => save(api.undoStatusChange(changeId));
  const { status } = progress;
  const sorting =
    Boolean(job.role) &&
    (status === 'new' || status === 'review' || (status === 'later' && progress.backFromLater));
  const fitCheck =
    run && !job.fit
      ? {
          onRun: () => run.start({ skill: 'fit-check', jobId: job.id }),
          disabled: BUSY.includes(run.phase),
        }
      : undefined;
  // Escape puts an expanded job back beside the list first, then closes it.
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (expanded && onExpand) onExpand(false);
    else onClose();
  };

  const nextStep = (
    <div ref={top} className={styles.top}>
      {attention && next && (
        <p className={`${styles.next} ${NEXT_TONE[attention.level]}`}>{next.text}</p>
      )}
      {sorting && <SortButtons status={status} onMove={move} fitCheck={fitCheck} />}
      {status === 'later' && !progress.backFromLater && (
        <SetAsideBox
          job={job}
          today={today}
          onBackOn={(backOn) => change({ backOn })}
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
      <NextStep key={`next-${job.id}`} job={job} api={api} />
      {job.apply && <ApplySection markdown={job.apply} />}
    </div>
  );
  const tracking: ReactNode[] = [
    <ProgressSection
      key={`progress-${job.id}`}
      job={job}
      progress={progress}
      api={api}
      today={today}
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
  ];
  const about: ReactNode[] = [
    <PanelSection
      key="claude"
      id="claude"
      title="Your Claude"
      icon={<Sparkles size={15} />}
      summary={claudeSummary(job)}
    >
      {run && <RunActions job={job} status={progress.status} run={run} api={api} />}
      <AskSection key={`ask-${job.id}`} job={job} api={api} run={run} today={today} />
    </PanelSection>,
    <PanelSection key="fit" id="fit" title="Fit" icon={<Gauge size={15} />} summary={fit}>
      <ScoreSection job={job} today={today} />
      <SentimentSection job={job} today={today} />
      <SearchSection job={job} today={today} />
    </PanelSection>,
    <ApplicationSection key={`answers-${job.id}`} job={job} api={api} today={today} />,
    <FilesSection key={`files-${job.id}`} job={job} api={api} today={today} />,
    <ActivitySection key="activity" job={job} today={today} />,
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
          {(meta || job.link) && (
            <p className={styles.where}>
              {meta}
              {meta && job.link && ' · '}
              {job.link && (
                <a className={styles.link} href={job.link} target="_blank" rel="noreferrer">
                  Posting
                  <ArrowUpRight size={13} aria-hidden="true" />
                </a>
              )}
            </p>
          )}
          <div className={styles.badges}>
            <StatusSelect
              status={progress.status}
              label={`Status for ${job.company}`}
              onChange={changeStatus}
            />
            <FitBadge score={progress.score} tier={progress.tier} />
          </div>
          {problem?.jobId === job.id && (
            <p className={styles.problem} role="alert">
              {problem.message}
            </p>
          )}
        </header>

        {/* The same two columns either way, side by side only when expanded, so expanding
            never loses what's being typed. */}
        <div className={styles.columns}>
          <div className={styles.column}>
            {nextStep}
            {tracking}
          </div>
          <div className={styles.column}>{about}</div>
        </div>
        <ArchiveFooter job={job} api={api} />
      </div>
    </aside>
  );
}
