import {
  type Ask,
  askAnswer,
  askThreads,
  type Job,
  type JobShot,
  shortDate,
} from '@factwright/core';
import { Button, Dialog, DialogActions, Markdown, Pill, TextArea } from '@factwright/ui';
import { MessageCircleQuestionMark, Plus } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
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

/** One turn of a conversation: the user's question or reply, and Claude's answer once it's in. */
interface Turn {
  ask: Ask;
  answer: string | undefined;
  shots: readonly JobShot[];
  /** Claude's task to answer it: running, waiting in line for its turn, or neither. */
  task: 'answering' | 'in-line' | null;
}

/** Claude's answer to one turn, or where it stands while there's none. */
function TurnAnswer({ turn, api }: { turn: Turn; api: FactwrightApi }) {
  const shown = turn.answer ? askAnswer(turn.answer) : null;
  return (
    <>
      {turn.shots.length > 0 && <AskShots shots={turn.shots} api={api} />}
      {shown ? (
        <div className={styles.answer}>
          <Markdown text={shown.body} />
        </div>
      ) : (
        <p className={panel.quiet}>
          {turn.task === 'answering'
            ? 'Claude is working on it in its panel.'
            : turn.task === 'in-line'
              ? 'It’s in line for Claude, and starts by itself.'
              : 'Claude hasn’t answered this yet.'}
        </p>
      )}
    </>
  );
}

/**
 * The box under a conversation for the user's reply to Claude's latest answer, which Claude
 * answers from everything said so far. It sends once that answer is in. Until then the user can
 * write their reply, but not send it, and the box says why.
 */
function ReplyBox({
  job,
  replyTo,
  hold,
  api,
  onReplied,
}: {
  job: Job;
  /** The latest question or reply in the conversation, which the reply answers back to. */
  replyTo: string;
  /** Why a reply can't be sent yet, as the latest one has no answer, or null once it can. */
  hold: string | null;
  api: FactwrightApi;
  /** Starts the run that answers the reply, once it's kept. */
  onReplied: (askId: string) => void;
}) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const keys = useId();
  const ready = hold === null;
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || sending || !reply.trim()) return;
    setSending(true);
    try {
      const sent = await api.askAboutJob(job.id, reply, replyTo);
      if (!sent.ok) {
        setProblem(sent.message);
        return;
      }
      setReply('');
      setProblem(null);
      onReplied(sent.askId);
      // Send goes quiet until Claude answers, so the keyboard goes back to the box, and the run's
      // terminal leaves it there.
      box.current?.focus();
    } finally {
      setSending(false);
    }
  };
  return (
    <form className={styles.replyForm} onSubmit={(event) => void send(event)}>
      <div className={styles.replyRow}>
        {/* Enter sends, and Shift-Enter starts a line, as in Claude's panel. */}
        <TextArea
          ref={box}
          aria-label="Your reply"
          aria-describedby={keys}
          placeholder="Reply to Claude"
          rows={1}
          className={styles.replyBox}
          maxLength={LIMITS.ask}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          onKeyDown={(event) => {
            const sends =
              event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing;
            if (!sends) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <Button size="sm" type="submit" disabled={!ready || sending || !reply.trim()}>
          Send
        </Button>
      </div>
      <span id={keys} hidden>
        Enter sends, and Shift-Enter starts a new line.
      </span>
      {/* Mounted from the start, so a screen reader hears why a reply waits once there's one. */}
      <p className={styles.replyHint} role="status">
        {hold !== null && reply.trim() !== '' ? hold : ''}
      </p>
      {problem && (
        <p className={panel.problem} role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/**
 * One conversation with Claude about the job: the user's question, Claude's answer, and each of
 * the user's replies with Claude's answer to it, then a box to reply again.
 */
function Conversation({
  job,
  turns,
  newest,
  canRun,
  api,
  onRun,
  today,
}: {
  job: Job;
  /** The question that started it, then each reply, oldest first. */
  turns: readonly [Turn, ...Turn[]];
  /** The latest conversation, which starts open. */
  newest: boolean;
  canRun: boolean;
  api: FactwrightApi;
  /** Starts Claude's task to answer a question or reply, by its ID. */
  onRun: (askId: string) => void;
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
  const [first, ...replies] = turns;
  const latest = replies.at(-1) ?? first;
  const answering = turns.some((turn) => turn.task === 'answering');
  const inLine = !answering && turns.some((turn) => turn.task === 'in-line');
  const busy = answering || inLine;
  const state = answering
    ? 'Answering'
    : inLine
      ? 'In line'
      : latest.answer
        ? 'Answered'
        : 'Waiting';
  const remove = async () => {
    const result = await api.removeAsk(job.id, first.ask.id);
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
          <span className={styles.asked}>{first.ask.question}</span>
          <span className={styles.meta}>
            {replies.length > 0 &&
              (replies.length === 1 ? '1 reply · ' : `${replies.length} replies · `)}
            {shortDate(latest.ask.on, today)}
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
          <TurnAnswer turn={first} api={api} />
          {replies.map((turn) => (
            <div key={turn.ask.id} className={styles.turn}>
              <div className={styles.reply}>
                <p className={styles.from}>You · {shortDate(turn.ask.on, today)}</p>
                <p className={styles.replied}>{turn.ask.question}</p>
              </div>
              <TurnAnswer turn={turn} api={api} />
            </div>
          ))}
          <div className={styles.actions}>
            {!busy && (
              <Button
                size="sm"
                variant="quiet"
                disabled={!canRun}
                onClick={() => onRun(latest.ask.id)}
              >
                {latest.answer ? 'Ask again' : 'Answer now'}
              </Button>
            )}
            {removing ? (
              <>
                <span className={styles.confirm} role="status">
                  {replies.length > 0
                    ? 'Remove the question, your replies and Claude’s answers?'
                    : 'Remove the question and its answer?'}
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
          {canRun && (
            <ReplyBox
              job={job}
              replyTo={latest.ask.id}
              hold={
                busy
                  ? 'You can send this once Claude has answered.'
                  : latest.answer
                    ? null
                    : 'Claude hasn’t answered yet. Click Answer now, then send this.'
              }
              api={api}
              onReplied={onRun}
            />
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * The user's own questions about a job, such as what to expect from a call, each with Claude's
 * answer, which stays here to come back to, and the button to ask one. Replying to an answer
 * makes a question a conversation, which Claude answers from everything said so far.
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
  const turnOf = (ask: Ask): Turn => ({
    ask,
    answer: extras?.asked[ask.id],
    shots: extras?.shots.filter((shot) => shot.ask === ask.id) ?? [],
    task: on(ask, 'running') ? 'answering' : on(ask, 'in-line') ? 'in-line' : null,
  });
  const start = (askId: string) => run?.start({ skill: 'ask', jobId: job.id, askId });
  const threads = askThreads(job.asks).reverse();
  const empty = threads.length === 0;
  const waiting = threads.filter(
    (thread) => !extras?.asked[(thread.replies.at(-1) ?? thread.ask).id],
  ).length;
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
          threads.length === 1 ? '1 question' : `${threads.length} questions`,
          extras && waiting > 0 && `${waiting} not answered yet`,
        ]
          .filter(Boolean)
          .join(' · ')
      }
      count={threads.length}
      empty={empty}
      actions={!empty && askButton}
    >
      {empty && (
        <Placeholder action={askButton}>
          Anything about this job, such as what to expect from a call. Your Claude answers from
          everything on file and the web, and the answer stays here, for you to reply to.
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
          {threads.map((thread, i) => (
            <Conversation
              key={thread.ask.id}
              job={job}
              turns={[turnOf(thread.ask), ...thread.replies.map(turnOf)]}
              newest={i === 0}
              canRun={Boolean(run)}
              api={api}
              onRun={start}
              today={today}
            />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
