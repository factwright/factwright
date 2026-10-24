import {
  type ApplicationAnswer,
  applicationAnswers,
  formFeed,
  type Job,
  questionKey,
  readSuggestedAnswers,
  type SavedForm,
  type SuggestedAnswer,
  shortDate,
} from '@factwright/core';
import { Button, Markdown, Pill, TextArea } from '@factwright/ui';
import { ClipboardList, Copy, Download } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FactwrightApi, FormQuestionsResult } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import type { RunTask } from '../../shared/runs.ts';
import styles from './ApplicationSection.module.css';
import { ClaudeButton } from './ClaudeButton.tsx';
import panel from './JobPanel.module.css';
import tracking from './JobTracking.module.css';
import { PanelSection, Placeholder } from './PanelSection.tsx';
import { QuestionsDialog } from './QuestionsDialog.tsx';
import type { RunControls } from './RunActions.tsx';

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
 * Where the application form's own questions stand, once they're kept with the job: how many
 * have a draft from your Claude, and the button to draft the rest, as the browser extension's
 * Draft does. The extension fills each draft in when the form is open.
 */
function FormNote({
  job,
  form,
  suggested,
  today,
  run,
}: {
  job: Job;
  form: SavedForm;
  suggested: readonly SuggestedAnswer[];
  today: string;
  run?: RunControls | undefined;
}) {
  const asked = form.questions.map((each) => each.question);
  // The form's questions come first, each with its draft, if it has one.
  const left = applicationAnswers(asked, suggested, [])
    .slice(0, asked.length)
    .filter((each) => each.suggested === null).length;
  const task: RunTask = { skill: 'answer-questions', jobId: job.id, form: true };
  const where =
    form.from === 'greenhouse' ? 'From the form on Greenhouse' : 'From the form in your browser';
  // A file that doesn't say when, as one edited by hand might, says where alone.
  const on = Number.isNaN(Date.parse(form.read)) ? '' : `, ${shortDate(form.read, today)}`;
  const which =
    left === asked.length
      ? `The form’s ${asked.length === 1 ? 'question needs a draft' : `${asked.length} questions need drafts`}`
      : `${left} of the form’s ${asked.length} questions ${left === 1 ? 'needs a draft' : 'need drafts'}`;
  return (
    <div className={styles.form}>
      <p className={styles.formText}>
        <span className={styles.formFrom}>
          {where}
          {on}.
        </span>{' '}
        {left > 0
          ? `${which}. Your Claude writes ${left === 1 ? 'it' : 'them'} from your facts, and the extension fills ${left === 1 ? 'it' : 'them'} in when you open the form.`
          : 'Your Claude drafted its questions, and the extension fills them in when you open the form.'}
      </p>
      {left > 0 && <ClaudeButton run={run} task={task} label="Draft them with your Claude" />}
    </div>
  );
}

/** What getting the form's questions said: none for your Claude, or why not. */
function GotSaid({ got }: { got: FormQuestionsResult | null }) {
  if (!got) return null;
  if (!got.ok) {
    return (
      <p className={panel.problem} role="alert">
        {got.message}
      </p>
    );
  }
  return got.questions === 0 ? (
    <p className={panel.quiet} role="status">
      The form asks nothing of its own for your Claude to draft. The extension fills in the rest
      from Profile and your resume.
    </p>
  ) : null;
}

/**
 * The application's questions, each with Claude's suggested answer and what the user actually
 * sent, which they record here after applying. It's all here to look back on when the job moves
 * on, and Claude reads what they sent before an interview. The questions get pasted in first,
 * and before there are any, what goes here and the button to start. For a job saved from a
 * posting on Greenhouse, which lists its form's questions, Factwright gets them, for your Claude
 * to draft before the form is open.
 */
export function ApplicationSection({
  job,
  api,
  today,
  run,
}: {
  job: Job;
  api: FactwrightApi;
  today: string;
  run?: RunControls | undefined;
}) {
  const [suggested, setSuggested] = useState<SuggestedAnswer[]>([]);
  const [pasting, setPasting] = useState(false);
  const [form, setForm] = useState<SavedForm | null>(null);
  const [getting, setGetting] = useState(false);
  const [got, setGot] = useState<FormQuestionsResult | null>(null);
  const hasAnswers = job.docKinds.includes('answers');
  // A posting on Greenhouse, whose form's questions Factwright can get before it's open.
  const feed = formFeed([job.link, ...job.links.map((link) => link.url)]);

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

  // The form's questions kept with the job, which change the job list when they're added.
  useEffect(() => {
    let live = true;
    void api.jobExtras(job.id).then((extras) => {
      if (live) setForm(extras?.form ?? null);
    });
    return () => {
      live = false;
    };
  }, [api, job]);

  const getQuestions = async () => {
    setGetting(true);
    setGot(null);
    try {
      const result = await api.getFormQuestions(job.id);
      // Questions the job had already change nothing in the list, so the form is read again.
      const extras = result.ok ? await api.jobExtras(job.id) : null;
      if (extras) setForm(extras.form);
      setGot(result);
    } catch {
      setGot({ ok: false, message: 'Factwright couldn’t get the form’s questions. Try again.' });
    } finally {
      setGetting(false);
    }
  };

  const answers = applicationAnswers(job.questions, suggested, job.sent);
  const empty = answers.length === 0 && !hasAnswers;
  const sent = answers.filter((answer) => answer.sent).length;
  const task: RunTask = { skill: 'answer-questions', jobId: job.id };
  const start = (label: string) => (
    <ClaudeButton run={run} task={task} label={label} adds onStart={() => setPasting(true)} />
  );
  // A form that asks nothing for your Claude has nothing more to get.
  const asksNothing = got?.ok === true && got.questions === 0;
  const get = feed && (
    <Button
      size="sm"
      variant="secondary"
      icon={<Download size={14} aria-hidden="true" />}
      disabled={getting}
      onClick={() => void getQuestions()}
    >
      {getting ? 'Getting the form’s questions…' : 'Get the form’s questions'}
    </Button>
  );

  return (
    <PanelSection
      id="application"
      title="Application questions"
      icon={<ClipboardList size={15} />}
      summary={empty ? undefined : `${sent} of ${answers.length} sent`}
      count={answers.length}
      empty={empty}
      actions={!empty && start('Add questions')}
    >
      {empty ? (
        <>
          <Placeholder
            action={
              <>
                {get}
                {start('Answer the questions')}
              </>
            }
          >
            Paste the application form’s questions, and your Claude drafts answers from your facts,
            in your own voice.
            {feed && ' The form is on Greenhouse, so Factwright can get its questions for you.'}
          </Placeholder>
          <GotSaid got={got} />
        </>
      ) : (
        <>
          <GotSaid got={got} />
          {form && form.questions.length > 0 ? (
            <FormNote job={job} form={form} suggested={suggested} today={today} run={run} />
          ) : (
            get &&
            !asksNothing && (
              <div className={styles.form}>
                <p className={styles.formText}>
                  The form is on Greenhouse, so Factwright can get its questions for your Claude to
                  draft before you open it.
                </p>
                {get}
              </div>
            )
          )}
          <p className={panel.quiet}>
            Keep what you actually sent, so it’s here when the job moves on. Claude reads it before
            your interviews.
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
        </>
      )}
      {pasting && (
        <QuestionsDialog
          job={job}
          api={api}
          onAnswer={() => run?.start(task)}
          onClose={() => setPasting(false)}
        />
      )}
    </PanelSection>
  );
}
