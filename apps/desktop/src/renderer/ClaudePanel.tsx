import { Button, IconButton, Notice, RunStatus } from '@factwright/ui';
import { ArrowDown, BookCheck, MessageCircleQuestionMark, X } from 'lucide-react';
import { useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import type { FiledFacts } from '../shared/facts.ts';
import { taskJob } from '../shared/runs.ts';
import styles from './ClaudePanel.module.css';
import { chipState, isRunning, PanelHeader } from './PanelHeader.tsx';
import { isBoolean, usePref } from './prefs.ts';
import { TerminalView } from './TerminalView.tsx';
import type { ClaudeRun } from './useClaudeRun.ts';

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

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

/**
 * Claude's panel along the bottom of the window: the user's own Claude Code, live. It can tuck
 * away into a slim bar while Claude works, and comes back when Claude needs the user. Claude's
 * questions and Claude Code's permission prompts open in dialogs, and one the user puts aside
 * waits here, with a way back to it. What only the terminal can answer, such as Claude Code's
 * question about trusting the workspace, gets the terminal a pulsing outline and a note pointing
 * down to it. When the run saves the user's answers to their fact bank, it says so, with a way to
 * verify them.
 */
export function ClaudePanel({
  api,
  run,
  plan,
  title = 'Claude',
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
  // Said once, for someone new to Claude Code, the first time it asks in the terminal.
  const [explained, setExplained] = usePref('claude.terminal-explained', false, isBoolean);
  if (run.phase === 'idle' && !run.problem) return null;
  const hidden = !run.open && isRunning(run.phase);
  // The question about trust waits on the user like any other.
  const shown = run.trustAsked ? 'needs-answer' : run.phase;
  const filing = filed && (filed.facts.length > 0 || filed.gaps > 0) ? filed : null;
  const part = filing && filing.facts.length > 0 ? 'unverified' : 'gaps';
  const words = filing ? filedWords(filing) : null;
  const aside = asking && !asking.open ? asking : null;
  // Claude Code waits on an answer only the terminal takes: its question about trust, or anything
  // the app's dialogs leave to it, such as a question sent there.
  const inTerminal = run.trustAsked || (run.phase === 'needs-answer' && asking === null);
  const review = (
    <Button size="sm" onClick={() => onReviewFiled?.(part)}>
      {part === 'unverified' ? 'Verify them' : 'Review'}
    </Button>
  );
  return (
    <>
      <section className={`${styles.panel} ${hidden ? styles.hidden : ''}`} aria-label="Claude">
        <PanelHeader
          title={title}
          phase={shown}
          plan={plan}
          problem={run.problem}
          onStop={run.stop}
          onHide={run.hide}
          onClose={run.close}
          asking={asking?.what ?? null}
        />
        {aside && (
          <div className={styles.asking}>
            <MessageCircleQuestionMark size={15} aria-hidden="true" className={styles.askingIcon} />
            {aside.what === 'questions' ? (
              <p className={styles.askingText}>
                <strong>Claude is waiting for your answer</strong>
                {aside.count === 1 ? ' to a question.' : ` to ${aside.count} questions.`}
              </p>
            ) : (
              <p className={styles.askingText}>
                <strong>Claude Code is waiting for your OK</strong> before Claude carries on.
              </p>
            )}
            <Button size="sm" variant="primary" onClick={aside.onAnswer}>
              Answer
            </Button>
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
        {run.trustAsked && (
          <div className={styles.trust}>
            <Notice title="Claude Code asks once whether to trust your workspace">
              Use the arrow keys to pick “Yes, I trust this folder”, then press Enter. Its note
              about running files doesn’t apply here: in Factwright, Claude Code has no shell, so it
              can’t run programs. It only reads and writes files in your workspace, and asks you
              before it writes.
            </Notice>
          </div>
        )}
        {inTerminal && !run.trustAsked && (
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
          />
        )}
      </section>
      {hidden && (
        <div className={styles.slim}>
          <span role="status">
            <RunStatus state={chipState(shown, run.problem)} />
          </span>
          <span className={styles.title}>{title}</span>
          {aside && (
            <Button className={styles.show} size="sm" variant="primary" onClick={aside.onAnswer}>
              Answer Claude
            </Button>
          )}
          {words && (
            <Button
              className={aside ? undefined : styles.show}
              size="sm"
              onClick={() => onReviewFiled?.(part)}
            >
              {words.lead}
            </Button>
          )}
          <Button className={aside || words ? undefined : styles.show} size="sm" onClick={run.show}>
            Show Claude
          </Button>
        </div>
      )}
    </>
  );
}
