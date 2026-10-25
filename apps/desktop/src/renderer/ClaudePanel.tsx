import { Button, IconButton, Input, Markdown, Notice, VisuallyHidden } from '@factwright/ui';
import { ArrowDown, BookCheck, Check, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { type RunStep, stepWords } from '../shared/activity.ts';
import type { FactwrightApi } from '../shared/api.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { taskJob } from '../shared/runs.ts';
import styles from './ClaudePanel.module.css';
import { PanelHeader } from './PanelHeader.tsx';
import { isBoolean, usePref } from './prefs.ts';
import { TerminalView } from './TerminalView.tsx';
import type { ClaudeRun, RunPhase } from './useClaudeRun.ts';
import type { RunActivity } from './useRunActivity.ts';

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

/** How long Claude can go without a step before the bar points to its work, in milliseconds. */
export const QUIET_AFTER_MS = 3 * 60_000;

/**
 * How long a question only the terminal can take waits before Claude's work opens for it, in
 * milliseconds: the app's own dialog, when there's one, shows by then.
 */
const TERMINAL_AFTER_MS = 1200;

/**
 * What a run filed from the user's answers, in a few words: "1 new fact to verify", with the
 * facts by name when there are only a couple, so the user sees what was saved.
 */
export function filedWords(filed: FiledFacts): { lead: string; more: string } {
  const facts = filed.facts.length;
  const gaps = plural(filed.gaps, 'thing', 'things');
  if (facts === 0) return { lead: `Noted ${gaps} you don’t have`, more: ', from your answers.' };
  const named = facts <= 2 ? `: ${filed.facts.map(({ title }) => `“${title}”`).join(' and ')}` : '';
  return {
    lead: plural(facts, 'new fact to verify', 'new facts to verify'),
    more: `${named}, from your answers.${filed.gaps > 0 ? ` Also noted ${gaps} you don’t have.` : ''}`,
  };
}

/** What a turn that ended in an error means, by the kind of error Claude Code names. */
const TURN_ERRORS: Readonly<Record<string, string>> = {
  rate_limit:
    'Claude hit a rate limit, or your plan’s usage limit for now. Try again in a little while.',
  overloaded: 'Claude is busy for everyone right now. Try again in a moment.',
  server_error: 'Claude had a problem on its end. Try again in a moment.',
  authentication_failed:
    'Claude Code isn’t signed in anymore. The card in the sidebar says what to do.',
  billing_error: 'Claude Code stopped over your account’s billing. Its work says more.',
  account_on_hold: 'Your Claude account is on hold. Claude’s work says more.',
  max_output_tokens: 'Claude’s reply ran too long. Try again, or ask for less at once.',
};

/** What a turn that ended in an error means, in a sentence. */
export const turnErrorWords = (kind: string) =>
  TURN_ERRORS[kind] ?? 'Claude stopped with an error. Its work says what it was.';

/** How long it's been, as a clock shows it: "0:42", "12:05", "1:02:05". */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** The time now, every second while it's wanted, for how long a run has taken. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * What Claude is doing, in a line: the step it's on, or that it's thinking between steps, after
 * the last one it finished. Steps with nothing worth showing, such as keeping its to-do list,
 * leave the line as it was.
 */
export function doingLine(steps: readonly RunStep[]): { did: string | null; doing: string } {
  let did: string | null = null;
  let doing: string | null = null;
  for (const step of steps) {
    const words = stepWords(step);
    if (!words) continue;
    if (step.state === 'done') did = words.did;
    doing = step.state === 'running' ? words.doing : doing === words.doing ? null : doing;
  }
  return { did, doing: `${doing ?? 'Thinking'}…` };
}

/** What a finished task made, in a sentence, with a way to open it. */
export interface RunResult {
  text: string;
  /** Opens what it made, such as the job's resume, with a button saying so. */
  open: { label: string; go: () => void } | null;
}

/**
 * Whether a run that's done stopped on a question Claude asked in its own words, with nothing
 * else to show for it: it waits on the user's reply, like any other question.
 */
export const endsAsking = (phase: RunPhase, activity: RunActivity, result: RunResult | null) =>
  phase === 'done' &&
  !result &&
  !activity.end?.error &&
  (activity.end?.said?.endsWith('?') ?? false);

/**
 * Claude's panel along the bottom of the window: the user's own Claude Code, at work on a task.
 * A bar says what Claude is doing, a step at a time, with how long it's been, and once it's done,
 * what it made, with a way to open it. The terminal Claude Code runs in, Claude's work, stays
 * folded under it, unless the user asks to see it, and opens when only the terminal can take the
 * user's answer: Claude Code's first-run screens, its question about trusting the workspace, and
 * anything the app's dialogs leave to it. Claude's questions and Claude Code's permission prompts
 * open in dialogs, and one the user puts aside waits in the bar, with a way back to it. When the
 * run saves the user's answers to their fact bank, it says so, with a way to verify them.
 */
export function ClaudePanel({
  api,
  run,
  plan,
  title = 'Claude',
  activity = { steps: [], lastAt: null, end: null },
  result = null,
  stoppedShort = false,
  onRetry,
  filed = null,
  onReviewFiled,
  onDismissFiled,
  asking = null,
}: {
  api: FactwrightApi;
  run: ClaudeRun;
  plan: string | undefined;
  /** What the run is, such as "Fit check · Acme". */
  title?: string;
  /** What Claude has done in the task at hand, and how its last turn ended. */
  activity?: RunActivity;
  /** What the task made, once it's done and there's something to show for it. */
  result?: RunResult | null;
  /** The task is done without what it was for, such as when Claude stopped to ask something. */
  stoppedShort?: boolean;
  /** Starts the task again, after a turn that ended in an error. */
  onRetry?: (() => void) | undefined;
  /** What the run filed in the fact bank from the user's answers, until they look. */
  filed?: FiledFacts | null;
  /** Opens the fact bank where the filed facts are: the facts to verify, or what they don't have. */
  onReviewFiled?: (part: 'unverified' | 'gaps') => void;
  onDismissFiled?: () => void;
  /**
   * What Claude Code is waiting on the user to answer in the app: Claude's questions, how many, or
   * a permission prompt, whether its dialog is open, and a way to open it again once the user
   * puts it aside.
   */
  asking?: {
    what: 'questions' | 'permission';
    count: number;
    open: boolean;
    onAnswer: () => void;
  } | null;
}) {
  const [pasteProblem, setPasteProblem] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  // Said once, for someone new to Claude Code, the first time it asks in the terminal.
  const [explained, setExplained] = usePref('claude.terminal-explained', false, isBoolean);
  // The first-run screens and the question about trust wait on the user like any other.
  const shown = run.trustAsked || run.firstRun ? 'needs-answer' : run.phase;
  // Claude Code waits on an answer only the terminal takes: its first-run screens, its question
  // about trust, or anything the app's dialogs leave to it, such as a question sent there.
  const screens = run.trustAsked || run.firstRun;
  const inTerminal = screens || (run.phase === 'needs-answer' && asking === null);
  const working = shown === 'working' || shown === 'starting' || shown === 'needs-answer';
  const now = useNow(working && run.startedAt !== null);
  const { show } = run;
  // Claude's work opens for what only the terminal takes, once the app's own dialog would have.
  useEffect(() => {
    if (!inTerminal || run.open) return;
    const timer = setTimeout(show, TERMINAL_AFTER_MS);
    return () => clearTimeout(timer);
  }, [inTerminal, run.open, show]);
  if (run.phase === 'idle' && !run.problem) return null;

  const filing = filed && (filed.facts.length > 0 || filed.gaps > 0) ? filed : null;
  const part = filing && filing.facts.length > 0 ? 'unverified' : 'gaps';
  const words = filing ? filedWords(filing) : null;
  const aside = asking && !asking.open ? asking : null;
  const quiet = working && now - (activity.lastAt ?? run.startedAt ?? now) > QUIET_AFTER_MS;
  // How Claude's last turn ended, once it's done: an error, or, with nothing else to show for it,
  // what Claude said, such as a question it stopped to ask, which the user can answer here.
  const error = shown === 'done' ? activity.end?.error : null;
  const said = shown === 'done' && !result && !error ? (activity.end?.said ?? null) : null;
  const asks = endsAsking(shown, activity, result);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!reply.trim()) return;
    api.replyToClaude(reply);
    setReply('');
  };

  let text: ReactNode;
  let action: ReactNode = null;
  if (aside) {
    text =
      aside.what === 'questions'
        ? `Claude is waiting for your answer${aside.count === 1 ? ' to a question.' : ` to ${aside.count} questions.`}`
        : 'Claude Code is waiting for your OK before Claude carries on.';
    action = (
      <Button size="sm" variant="primary" onClick={aside.onAnswer}>
        Answer
      </Button>
    );
  } else if (shown === 'needs-answer') {
    text = asking
      ? asking.what === 'questions'
        ? 'Claude has a question for you.'
        : 'Claude Code is asking for your OK.'
      : 'Claude Code is asking you something in its work below.';
  } else if (shown === 'starting') {
    text = 'Your Claude is starting…';
  } else if (shown === 'ready') {
    text = 'Your Claude is ready. Type what you’d like in its work below.';
  } else if (shown === 'working') {
    const { did, doing } = doingLine(activity.steps);
    text = quiet ? (
      'No word from Claude for a few minutes. Show its work to see where it is.'
    ) : (
      <>
        {did && (
          <span className={styles.did}>
            <Check size={13} strokeWidth={2.6} aria-hidden="true" className={styles.didMark} />
            {did}
          </span>
        )}
        <span className={styles.doing}>{doing}</span>
      </>
    );
  } else if (shown === 'done' && error) {
    text = turnErrorWords(error.kind);
    if (onRetry) {
      action = (
        <Button size="sm" variant="primary" onClick={onRetry}>
          Try again
        </Button>
      );
    }
  } else if (shown === 'done') {
    text =
      result?.text ??
      (asks
        ? 'Claude has a question for you.'
        : stoppedShort
          ? 'Claude stopped before it was done.'
          : 'Claude is done.');
    if (result?.open) {
      const { label, go } = result.open;
      action = (
        <Button size="sm" variant="primary" onClick={go}>
          {label}
        </Button>
      );
    }
  } else if (shown === 'stopped') {
    text = 'Claude Code has closed.';
  } else {
    text = 'Claude Code stopped before it finished.';
  }

  const review = (
    <Button size="sm" onClick={() => onReviewFiled?.(part)}>
      {part === 'unverified' ? 'Verify them' : 'Review'}
    </Button>
  );
  return (
    <section className={styles.panel} aria-label="Claude">
      <PanelHeader
        title={title}
        phase={asks ? 'needs-answer' : shown}
        plan={plan}
        problem={run.problem}
        text={text}
        elapsed={working && run.startedAt !== null ? clock(now - run.startedAt) : null}
        action={action}
        workShown={run.open}
        onShowWork={run.showWork}
        onStop={run.stop}
        onClose={run.close}
        finished={shown === 'done' && result !== null}
        failed={Boolean(error)}
      />
      <VisuallyHidden aria-live="polite">
        {shown === 'done' && result ? result.text : ''}
      </VisuallyHidden>
      {said && (
        <div className={styles.said}>
          <div className={styles.saidText}>
            <Markdown text={said} />
          </div>
          <form className={styles.reply} onSubmit={send}>
            <Input
              aria-label="Reply to Claude"
              placeholder="Reply to Claude"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
            />
            <Button size="sm" type="submit" disabled={!reply.trim()}>
              Send
            </Button>
          </form>
        </div>
      )}
      {words && (
        <div className={styles.filed}>
          <BookCheck size={15} aria-hidden="true" className={styles.filedIcon} />
          <p className={styles.filedText} role="status">
            <strong>{words.lead}</strong>
            {words.more}
          </p>
          {review}
          <IconButton
            variant="quiet"
            size="sm"
            label={`Dismiss “${words.lead}”`}
            icon={<X size={14} aria-hidden="true" />}
            onClick={onDismissFiled}
          />
        </div>
      )}
      {/* Folded, it keeps its size, so Claude Code starts and runs as it would in view. */}
      <div className={`${styles.work} ${run.open ? '' : styles.folded}`} inert={!run.open}>
        {run.firstRun && !run.trustAsked && (
          <div className={styles.note}>
            <Notice title="Claude Code shows a few screens the first time it opens">
              Press Enter on each one to go on. The text style it asks about only changes how Claude
              Code looks in your own terminal. Then it asks whether to trust your workspace, which
              needs the arrow keys first.
            </Notice>
          </div>
        )}
        {run.trustAsked && (
          <div className={styles.note}>
            <Notice title="Claude Code asks once whether to trust your workspace">
              Use the arrow keys to pick “Yes, I trust this folder”, then press Enter. Its note
              about running files doesn’t apply here: in Factwright, Claude Code has no shell, so it
              can’t run programs. It only reads and writes files in your workspace, and asks you
              before it writes.
            </Notice>
          </div>
        )}
        {inTerminal && !screens && (
          <div className={styles.terminalAsks}>
            <ArrowDown size={15} aria-hidden="true" className={styles.terminalAsksIcon} />
            <p className={styles.terminalAsksText}>
              <strong>Claude Code is asking you something in the terminal below.</strong> Click in
              it, use ↑ and ↓ to pick an answer, then press Enter.
              {!explained &&
                ' This is your own Claude Code. Factwright asks in a window of its own when it can, and Claude Code asks here when it can’t.'}
            </p>
            {!explained && (
              <Button size="sm" onClick={() => setExplained(true)}>
                Got it
              </Button>
            )}
          </div>
        )}
        {pasteProblem && (
          <p className={styles.problem} role="alert">
            {pasteProblem}
          </p>
        )}
        {run.phase !== 'idle' && (
          <TerminalView
            key={run.runId}
            api={api}
            onSize={run.onTerminalSize}
            onTyped={run.typed}
            jobId={taskJob(run.task)}
            onPasteProblem={setPasteProblem}
            attention={inTerminal}
            shown={run.open}
          />
        )}
      </div>
    </section>
  );
}
