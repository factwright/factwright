import { type Ask, askAnswer, type Job, type JobShot, shortDate } from '@factwright/core';
import { Button, Dialog, DialogActions, Markdown, Pill, TextArea } from '@factwright/ui';
import { MessageCircleQuestionMark, Plus } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { FactwrightApi, JobExtras } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './AskSection.module.css';
import panel from './JobPanel.module.css';
import { PanelSection, Placeholder } from './PanelSection.tsx';
import type { RunControls, TaskState } from './RunActions.tsx';
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
  onAsked: (askId: string) => void;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [shots, setShots] = useState<PickedShot[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // Once the question is kept, trying again only saves the screenshots still waiting.
  const [askId, setAskId] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const ask = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    if (!question.trim()) {
      setProblem('Type your question first.');
      return;
    }
    setAsking(true);
    try {
      let id = askId;
      if (!id) {
        const asked = await api.askAboutJob(job.id, question);
        if (!asked.ok) {
          setProblem(asked.message);
          return;
        }
        id = asked.askId;
        setAskId(id);
      }
      const failed: string[] = [];
      for (const shot of shots) {
        const saved = await api
          .addShot(job.id, { name: shot.name, bytes: shot.bytes }, { kind: 'ask', ask: id })
          .catch(() => null);
        if (saved?.ok) setShots((now) => now.filter((each) => each.key !== shot.key));
        else failed.push(saved?.message ?? `${shot.name} couldn’t be saved.`);
      }
      if (failed.length > 0) {
        setProblem(
          `Your question is kept, but ${failed.length === 1 ? 'a screenshot isn’t' : 'some screenshots aren’t'}: ${failed.join(' ')} Remove ${failed.length === 1 ? 'it' : 'them'} and ask, or try again.`,
        );
        return;
      }
      close();
      onAsked(id);
    } finally {
      setAsking(false);
    }
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
            ref={box}
            className={styles.question}
            aria-label="Your question"
            placeholder="Such as: I have a 15 minute recruiter call tomorrow. What should I expect?"
            rows={4}
            maxLength={LIMITS.ask}
            value={question}
            readOnly={askId !== null}
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
                  onClick={() => {
                    setQuestion(starter);
                    // The starters go once there's a question, so the box takes the focus.
                    box.current?.focus();
                  }}
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
  // The pictures load again only when they change, not each time the panel draws.
  const paths = shots.map((shot) => shot.path).join('\n');
  useEffect(() => {
    let live = true;
    void Promise.all(
      paths
        .split('\n')
        .filter(Boolean)
        .map(async (path) => {
          const bytes = await api.readShot(path);
          return bytes ? [{ key: path, url: pictureUrl(bytes, typeOf(path)) }] : [];
        }),
    ).then((loaded) => live && setShown(loaded.flat()));
    return () => {
      live = false;
    };
  }, [api, paths]);
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
  inLine,
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
  /** Claude's task to answer it waits in line for its turn. */
  inLine: boolean;
  canRun: boolean;
  api: FactwrightApi;
  onRun: () => void;
  today: string;
}) {
  const [open, setOpen] = useState(newest);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  // The button that was pressed goes away, so the focus moves to the one that takes its place.
  const toggled = useRef(false);
  useEffect(() => {
    if (!toggled.current) return;
    (removing ? keepButton : removeButton).current?.focus();
  }, [removing]);
  const confirming = (next: boolean) => {
    toggled.current = true;
    setRemoving(next);
  };
  const shown = answer ? askAnswer(answer) : null;
  const state = answering ? 'Answering' : inLine ? 'In line' : shown ? 'Answered' : 'Waiting';
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
            <Pill
              tone={
                state === 'Answered'
                  ? 'green'
                  : state === 'Answering'
                    ? 'blue'
                    : state === 'In line'
                      ? 'gray'
                      : 'amber'
              }
            >
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
                : inLine
                  ? 'It’s in line for Claude, and starts by itself.'
                  : 'Claude hasn’t answered this yet.'}
            </p>
          )}
          <div className={styles.actions}>
            {!answering && !inLine && (
              <Button size="sm" variant="quiet" disabled={!canRun} onClick={onRun}>
                {shown ? 'Ask again' : 'Answer now'}
              </Button>
            )}
            {removing ? (
              <>
                <span className={styles.confirm} role="status">
                  Remove the question and its answer?
                </span>
                <Button size="sm" onClick={() => void remove()}>
                  Remove
                </Button>
                <Button
                  ref={keepButton}
                  size="sm"
                  variant="quiet"
                  onClick={() => confirming(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button ref={removeButton} size="sm" variant="quiet" onClick={() => confirming(true)}>
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
 * answer, which stays here to come back to, and the button to ask one.
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

  const tasks = run ? run.tasksOn(job.id).filter(({ task }) => task.skill === 'ask') : [];
  // The question a task is on, running or in line: the one it names, or every one waiting.
  const on = (ask: Ask, state: TaskState) =>
    tasks.some(
      (each) =>
        each.state === state &&
        ('askId' in each.task ? each.task.askId === ask.id : !extras?.asked[ask.id]),
    );
  const start = (askId: string) => run?.start({ skill: 'ask', jobId: job.id, askId });
  const asks = [...job.asks].reverse();
  const empty = asks.length === 0;
  const waiting = asks.filter((ask) => !extras?.asked[ask.id]).length;
  // While Claude answers one, another waits in line for its turn.
  const askButton = (
    <Button
      size="sm"
      icon={<Plus size={14} aria-hidden="true" />}
      disabled={!run}
      onClick={() => setAsking(true)}
    >
      Ask a question
    </Button>
  );

  return (
    <PanelSection
      id="asks"
      title="Questions for Claude"
      icon={<MessageCircleQuestionMark size={15} />}
      summary={
        !empty &&
        [
          asks.length === 1 ? '1 question' : `${asks.length} questions`,
          extras && waiting > 0 && `${waiting} not answered yet`,
        ]
          .filter(Boolean)
          .join(' · ')
      }
      count={asks.length}
      empty={empty}
      actions={!empty && askButton}
    >
      {empty && (
        <Placeholder action={askButton}>
          Anything about this job, such as what to expect from a call. Your Claude answers from
          everything on file and the web, and the answer stays here.
        </Placeholder>
      )}
      {asking && (
        <AskDialog
          job={job}
          api={api}
          onAsked={(askId) => start(askId)}
          onClose={() => setAsking(false)}
        />
      )}
      {!empty && (
        <ul className={styles.asks}>
          {asks.map((ask, i) => (
            <AskItem
              key={ask.id}
              job={job}
              ask={ask}
              newest={i === 0}
              answer={extras?.asked[ask.id]}
              shots={extras?.shots.filter((shot) => shot.ask === ask.id) ?? []}
              answering={on(ask, 'running')}
              inLine={!on(ask, 'running') && on(ask, 'in-line')}
              canRun={Boolean(run)}
              api={api}
              onRun={() => start(ask.id)}
              today={today}
            />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
