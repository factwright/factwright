import {
  CALL_KIND_LABELS,
  CALL_OUTCOME_LABELS,
  CALL_STATE_LABELS,
  type Call,
  callWhen,
  type Job,
  type JobStatus,
  readApplySteps,
} from '@factwright/core';
import {
  FitBadge,
  IconButton,
  JOB_STATUS_DISPLAY,
  Markdown,
  MarkdownLine,
  Notice,
  StatusSelect,
} from '@factwright/ui';
import { ArrowUpRight, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { payLabel, shortDate } from './format.ts';
import { FilesSection } from './JobFiles.tsx';
import styles from './JobPanel.module.css';
import { ScoreSection, SearchSection, SentimentSection } from './JobScore.tsx';
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

function callSummary(call: Call, today: string): string {
  const outcome = call.outcome ? ` · ${CALL_OUTCOME_LABELS[call.outcome]}` : '';
  return `${callWhen(call, today)} · ${CALL_STATE_LABELS[call.state]}${outcome}`;
}

function CallsSection({ job, today }: { job: Job; today: string }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Calls and interviews</h3>
      {job.calls.length === 0 ? (
        <p className={styles.quiet}>None logged yet.</p>
      ) : (
        <ul className={styles.calls}>
          {job.calls.map((call) => (
            <li key={call.id}>
              <span className={styles.callKind}>{CALL_KIND_LABELS[call.kind]}</span>
              <span className={styles.meta}>{callSummary(call, today)}</span>
              {call.notes && <p className={styles.callNotes}>{call.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Everything that happened with the job, newest first. */
function HistorySection({ job, today }: { job: Job; today: string }) {
  const entries = [
    ...job.events.map((event) => ({ id: event.id, date: event.date, text: event.title })),
    ...job.statusLog.map((change) => ({
      id: change.id,
      date: change.at,
      text: `Marked ${JOB_STATUS_DISPLAY[change.status].label}`,
    })),
    // Calls still to come are under "Calls and interviews", not history yet.
    ...job.calls
      .filter((call) => call.onDate <= today)
      .map((call) => ({
        id: call.id,
        date: call.onDate,
        text: `${CALL_KIND_LABELS[call.kind]}: ${CALL_STATE_LABELS[call.state].toLowerCase()}`,
      })),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  if (entries.length === 0) return null;
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>History</h3>
      <ol className={styles.history}>
        {entries.map((entry) => (
          <li key={entry.id}>
            <span className={styles.when}>{entry.date ? shortDate(entry.date, today) : ''}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface JobPanelProps {
  row: JobRow | null;
  api: FactwrightApi;
  today: string;
  onClose: () => void;
}

/** Everything on file for the job picked in the list. */
export function JobPanel({ row, api, today, onClose }: JobPanelProps) {
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

      {job.apply && <ApplySection markdown={job.apply} />}
      <ScoreSection job={job} today={today} />
      <SentimentSection job={job} today={today} />
      <FilesSection key={job.id} job={job} api={api} today={today} />
      <SearchSection job={job} today={today} />
      {job.notes && (
        <section className={styles.section}>
          <h3 className={styles.heading}>Your notes</h3>
          <p className={styles.notes}>{job.notes}</p>
        </section>
      )}
      <CallsSection job={job} today={today} />
      <HistorySection job={job} today={today} />
    </aside>
  );
}
