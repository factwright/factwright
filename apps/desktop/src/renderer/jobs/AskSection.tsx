import { type Ask, askAnswer, type Job, type JobShot, shortDate } from '@factwright/core';
import { Button, Dialog, DialogActions, Markdown, Pill, TextArea } from '@factwright/ui';
import { type FormEvent, useEffect, useState } from 'react';
import type { FactwrightApi, JobExtras } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import { taskJob } from '../../shared/runs.ts';
import styles from './AskSection.module.css';
import panel from './JobPanel.module.css';
import tracking from './JobTracking.module.css';
import { BUSY, type RunControls } from './RunActions.tsx';
import {
  type PickedShot,
  pictureUrl,
  readPictures,
  Screenshots,
  type ShownShot,
  typeOf,
} from './Screenshots.tsx';

/** Questions people often have about a job, to start from. */
const STARTERS = [
  'What should I expect from my next call, and what should I ask them?',
  'What’s the team and its culture like, from what people say?',
  'What should I bring up to stand out for this role?',
];

/**
 * A question for Claude about a job, with screenshots if the user has some, such as an email
 * from the recruiter. Asking keeps the question with the job, then starts the run that answers it.
 */
export function AskDialog({
  job,
  api,
  onAsked,
  onClose,
}: {
  job: Job;
  api: FactwrightApi;
  /** Starts the run that answers it, once it's kept. */
  onAsked: () => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [shots, setShots] = useState<PickedShot[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const ask = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (!question.trim()) {
      setProblem('Type your question first.');
      return;
    }
    setAsking(true);
    const asked = await api.askAboutJob(job.id, question);
    if (!asked.ok) {
      setAsking(false);
      setProblem(asked.message);
      return;
    }
    for (const shot of shots) {
      await api.addShot(
        job.id,
        { name: shot.name, bytes: shot.bytes },
        { kind: 'ask', ask: asked.askId },
      );
    }
    close();
    onAsked();
  };

  return (
    <Dialog
      title={`Ask about ${job.company}`}
      description="Your Claude answers from everything on file for this job, and the web, and keeps the answer here."
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => ask(event, close)}>
          <TextArea
            className={styles.question}
            aria-label="Your question"
            placeholder="Such as: I have a 15 minute recruiter call tomorrow. What should I expect?"
            rows={4}
            maxLength={LIMITS.ask}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            data-autofocus
          />
          {!question && (
            <div className={styles.starters}>
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className={styles.starter}
                  onClick={() => setQuestion(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          )}
          <Screenshots
            shots={shots}
            platform={api.platform}
            onAdd={(files) =>
              void readPictures(files).then((picked) => setShots((now) => [...now, ...picked]))
            }
            onRemove={(key) => setShots((now) => now.filter((shot) => shot.key !== key))}
          />
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={asking}>
              Ask Claude
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

/** Screenshots that came with a question, loaded once it's open. */
function AskShots({ shots, api }: { shots: readonly JobShot[]; api: FactwrightApi }) {
  const [shown, setShown] = useState<ShownShot[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(
      shots.map(async ({ path }) => {
        const bytes = await api.readShot(path);
        return bytes ? [{ key: path, url: pictureUrl(bytes, typeOf(path)) }] : [];
      }),
    ).then((loaded) => live && setShown(loaded.flat()));
    return () => {
      live = false;
    };
  }, [api, shots]);
  if (shown.length === 0) return null;
  return (
    <ul className={styles.shots}>
      {shown.map((shot, i) => (
        <li key={shot.key}>
          <img
            className={styles.shot}
            src={shot.url}
            alt={`Screenshot ${i + 1} with the question`}
          />
        </li>
      ))}
    </ul>
  );
}

/** One question the user asked, with Claude's answer once there is one. */
function AskItem({
  job,
  ask,
  newest,
  answer,
  shots,
  answering,
  canRun,
  api,
  onRun,
  today,
}: {
  job: Job;
  ask: Ask;
  /** The latest question, which starts open. */
  newest: boolean;
  answer: string | undefined;
  shots: readonly JobShot[];
  answering: boolean;
  canRun: boolean;
  api: FactwrightApi;
  onRun: () => void;
  today: string;
}) {
  const [open, setOpen] = useState(newest);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = answer ? askAnswer(answer) : null;
  const state = answering ? 'Answering' : shown ? 'Answered' : 'Waiting';
  const remove = async () => {
    const result = await api.removeAsk(job.id, ask.id);
    if (!result.ok) setProblem(result.message);
  };
  return (
    <li className={styles.ask}>
      <details
        className={styles.details}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className={styles.summary}>
          <span className={styles.asked}>{ask.question}</span>
          <span className={styles.meta}>
            {shortDate(ask.on, today)}
            <Pill tone={state === 'Answered' ? 'green' : state === 'Answering' ? 'blue' : 'amber'}>
              {state}
            </Pill>
          </span>
        </summary>
        <div className={styles.body}>
          {shots.length > 0 && <AskShots shots={shots} api={api} />}
          {shown ? (
            <div className={styles.answer}>
              <Markdown text={shown.body} />
            </div>
          ) : (
            <p className={panel.quiet}>
              {answering
                ? 'Claude is working on it in its panel.'
                : 'Claude hasn’t answered this yet.'}
            </p>
          )}
          <div className={styles.actions}>
            {!answering && (
              <Button size="sm" variant="quiet" disabled={!canRun} onClick={onRun}>
                {shown ? 'Ask again' : 'Answer now'}
              </Button>
            )}
            {removing ? (
              <>
                <span className={styles.confirm}>Remove the question and its answer?</span>
                <Button size="sm" onClick={() => void remove()}>
                  Remove
                </Button>
                <Button size="sm" variant="quiet" onClick={() => setRemoving(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="quiet" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            )}
          </div>
          {problem && (
            <p className={panel.problem} role="alert">
              {problem}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * The user's own questions about a job, such as what to expect from a call, each with Claude's
 * answer, which stays here to come back to. Asking starts Claude on it.
 */
export function AskSection({
  job,
  api,
  run,
  today,
}: {
  job: Job;
  api: FactwrightApi;
  run?: RunControls | undefined;
  today: string;
}) {
  const [extras, setExtras] = useState<JobExtras | null>(null);
  const [asking, setAsking] = useState(false);

  // Claude saves its answers in the workspace, which changes the job list, so they follow it.
  useEffect(() => {
    let live = true;
    void api.jobExtras(job.id).then((loaded) => live && setExtras(loaded));
    return () => {
      live = false;
    };
  }, [api, job]);

  const busy = run ? BUSY.includes(run.phase) : true;
  const mine = run?.task?.skill === 'ask' && taskJob(run.task) === job.id;
  const start = () => run?.start({ skill: 'ask', jobId: job.id });
  const asks = [...job.asks].reverse();
  const unanswered = asks.filter((ask) => !extras?.asked[ask.id]);

  return (
    <section className={panel.section} aria-labelledby={`ask-heading-${job.id}`}>
      <div className={tracking.sectionHead}>
        <h3 id={`ask-heading-${job.id}`} className={panel.heading}>
          Ask Claude
        </h3>
        {run && (
          <Button size="sm" disabled={busy} onClick={() => setAsking(true)}>
            Ask a question
          </Button>
        )}
      </div>
      {asks.length === 0 ? (
        <p className={panel.quiet}>
          Ask anything about this job, such as what to expect from a call. The answers stay here.
        </p>
      ) : (
        <ul className={styles.asks}>
          {asks.map((ask, i) => (
            <AskItem
              key={ask.id}
              job={job}
              ask={ask}
              newest={i === 0}
              answer={extras?.asked[ask.id]}
              shots={extras?.shots.filter((shot) => shot.ask === ask.id) ?? []}
              answering={mine && busy && unanswered.includes(ask)}
              canRun={Boolean(run) && !busy}
              api={api}
              onRun={start}
              today={today}
            />
          ))}
        </ul>
      )}
      {asking && <AskDialog job={job} api={api} onAsked={start} onClose={() => setAsking(false)} />}
    </section>
  );
}
