import { type JobStatus, payLabel, readApplySteps } from '@factwright/core';
import { FitBadge, IconButton, Markdown, MarkdownLine, Notice, StatusSelect } from '@factwright/ui';
import { ArrowUpRight, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { FilesSection } from './JobFiles.tsx';
import styles from './JobPanel.module.css';
import { ScoreSection, SearchSection, SentimentSection } from './JobScore.tsx';
import {
  ArchiveFooter,
  CallsSection,
  HistorySection,
  NextStep,
  NotesSection,
} from './JobTracking.tsx';
import { RunActions, type RunControls } from './RunActions.tsx';
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

export interface JobPanelProps {
  row: JobRow | null;
  api: FactwrightApi;
  today: string;
  onClose: () => void;
  /** Claude's panel, so the job's Run buttons can start skills. */
  run?: RunControls;
}

/** Everything on file for the job picked in the list. */
export function JobPanel({ row, api, today, onClose, run }: JobPanelProps) {
  const [problem, setProblem] = useState<{ jobId: string; message: string } | null>(null);
  if (!row) {
    return (
      <aside className={`${styles.panel} ${styles.empty}`} aria-label="Job details">
        <p className={styles.placeholder}>Pick a job to see everything on file for it.</p>
      </aside>
    );
  }
  const { job, progress, next } = row;
  const pay = payLabel(job.pay) ?? job.pay?.text;
  const meta = [job.location, pay].filter(Boolean).join(' · ');
  const attention = progress.attention;

  const changeStatus = async (status: JobStatus) => {
    const result = await api.updateJob(job.id, { status });
    setProblem(result.ok ? null : { jobId: job.id, message: result.message });
  };
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) onClose();
  };

  return (
    <aside className={styles.panel} aria-label="Job details" onKeyDown={closeOnEscape}>
      <div className={styles.head}>
        <div className={styles.title}>
          <p className={styles.company}>{job.company}</p>
          <h2 className={styles.role}>{job.role || 'Company outreach'}</h2>
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
        </div>
        <IconButton
          className={styles.close}
          label="Close details"
          variant="quiet"
          icon={<X size={16} aria-hidden="true" />}
          onClick={onClose}
        />
      </div>

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
      {attention && next && (
        <p className={`${styles.next} ${NEXT_TONE[attention.level]}`}>{next.text}</p>
      )}

      <NextStep key={`next-${job.id}`} job={job} api={api} />
      {job.apply && <ApplySection markdown={job.apply} />}
      {run && <RunActions job={job} status={progress.status} run={run} api={api} />}
      <ScoreSection job={job} today={today} />
      <SentimentSection job={job} today={today} />
      <CallsSection
        key={`calls-${job.id}`}
        job={job}
        status={progress.status}
        api={api}
        today={today}
      />
      <NotesSection key={`notes-${job.id}`} job={job} api={api} />
      <FilesSection key={`files-${job.id}`} job={job} api={api} today={today} />
      <SearchSection job={job} today={today} />
      <HistorySection job={job} api={api} today={today} />
      <ArchiveFooter job={job} api={api} />
    </aside>
  );
}
