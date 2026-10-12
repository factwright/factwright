import {
  type ApplicationAnswer,
  applicationAnswers,
  type Job,
  questionKey,
  readSuggestedAnswers,
  type SuggestedAnswer,
  shortDate,
} from '@factwright/core';
import { Button, Markdown, Pill, TextArea } from '@factwright/ui';
import { ClipboardList, Copy } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './ApplicationSection.module.css';
import panel from './JobPanel.module.css';
import tracking from './JobTracking.module.css';
import { PanelSection } from './PanelSection.tsx';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const SAVE_LABELS: Readonly<Record<SaveState, string>> = {
  idle: 'Saves as you type',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Couldn’t save. Keep typing to try again.',
};

/**
 * What the user actually sent for one question. It saves a moment after typing stops, when the
 * box loses focus, and when it goes away, and shows what changed elsewhere unless they're in it.
 */
function SentBox({
  job,
  answer,
  api,
  today,
}: {
  job: Job;
  answer: ApplicationAnswer;
  api: FactwrightApi;
  today: string;
}) {
  const sent = answer.sent?.text ?? '';
  const [text, setText] = useState(sent);
  const [state, setState] = useState<SaveState>('idle');
  const pending = useRef<string | null>(null);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  // Kept under the question as it was recorded, which may be Claude's wording of it.
  const question = answer.sent?.question ?? answer.question;
  const nth = answer.sent?.nth ?? answer.nth;
  const jobId = job.id;

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    setState('saving');
    const result = await api.recordAnswer(jobId, question, nth, next);
    setState(result.ok ? 'saved' : 'failed');
  }, [api, jobId, question, nth]);

  useEffect(() => () => void save(), [save]);

  useEffect(() => {
    if (!focused.current && pending.current === null) setText(sent);
  }, [sent]);

  const change = (value: string) => {
    setText(value);
    pending.current = value;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  };

  return (
    <div className={styles.sent}>
      <div className={tracking.sectionHead}>
        <label htmlFor={id} className={styles.label}>
          What you sent
          {answer.sent && state === 'idle' && (
            <span className={styles.when}> · {shortDate(answer.sent.on, today)}</span>
          )}
        </label>
        <span className={tracking.saveState} aria-live="polite">
          {SAVE_LABELS[state]}
        </span>
      </div>
      <TextArea
        id={id}
        className={styles.box}
        rows={3}
        maxLength={LIMITS.answer}
        value={text}
        placeholder="Paste what you put on the form, in your own words"
        onChange={(event) => change(event.target.value)}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          void save();
        }}
      />
      {!text && answer.suggested && (
        <Button
          className={styles.same}
          size="sm"
          variant="quiet"
          onClick={() => {
            change(answer.suggested ?? '');
            void save();
          }}
        >
          I sent Claude’s answer as it is
        </Button>
      )}
    </div>
  );
}

/** One question on the application, with Claude's suggestion and what the user sent. */
function AnswerItem({
  job,
  answer,
  number,
  api,
  today,
}: {
  job: Job;
  answer: ApplicationAnswer;
  number: number;
  api: FactwrightApi;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const state = answer.sent ? 'Sent' : answer.suggested ? 'Suggested' : 'Not answered';
  return (
    <li className={styles.item}>
      <details
        className={styles.details}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className={styles.summary}>
          <span className={styles.number} aria-hidden="true">
            {number}.
          </span>
          <span className={styles.question}>{answer.question}</span>
          <Pill
            tone={state === 'Sent' ? 'green' : state === 'Suggested' ? 'blue' : 'gray'}
            className={styles.state}
          >
            {state}
          </Pill>
        </summary>
        {open && (
          <div className={styles.body}>
            {answer.suggested && (
              <div className={styles.suggested}>
                <div className={tracking.sectionHead}>
                  <span className={styles.label}>Claude suggested</span>
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={<Copy size={13} aria-hidden="true" />}
                    onClick={async () => {
                      const result = await api.copyText(answer.suggested ?? '');
                      setCopied(result.ok);
                      if (result.ok) setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <Markdown text={answer.suggested} />
                {answer.why && <p className={styles.why}>Why: {answer.why}</p>}
              </div>
            )}
            <SentBox job={job} answer={answer} api={api} today={today} />
          </div>
        )}
      </details>
    </li>
  );
}

/**
 * The application's questions, each with Claude's suggested answer and what the user actually
 * sent, which they record here after applying. It's all here to look back on when the job moves
 * on, and Claude reads what they sent before an interview.
 */
export function ApplicationSection({
  job,
  api,
  today,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
}) {
  const [suggested, setSuggested] = useState<SuggestedAnswer[]>([]);
  const hasAnswers = job.docKinds.includes('answers');

  // Claude's answers come from answers.md, which changes the job list when it's saved.
  useEffect(() => {
    let live = true;
    if (!hasAnswers) {
      setSuggested([]);
      return;
    }
    void api.jobDocs(job.id).then((docs) => {
      if (live) setSuggested(readSuggestedAnswers(docs?.answers));
    });
    return () => {
      live = false;
    };
  }, [api, job, hasAnswers]);

  const answers = applicationAnswers(job.questions, suggested, job.sent);
  if (answers.length === 0) return null;
  const sent = answers.filter((answer) => answer.sent).length;

  return (
    <PanelSection
      id="application"
      title="Application answers"
      icon={<ClipboardList size={15} />}
      summary={`${sent} of ${answers.length} sent`}
    >
      <p className={panel.quiet}>
        Keep what you actually sent, so it’s here when the job moves on. Claude reads it before your
        interviews.
      </p>
      <ol className={styles.list}>
        {answers.map((answer, i) => (
          <AnswerItem
            key={questionKey(answer.question)}
            job={job}
            answer={answer}
            number={i + 1}
            api={api}
            today={today}
          />
        ))}
      </ol>
    </PanelSection>
  );
}
