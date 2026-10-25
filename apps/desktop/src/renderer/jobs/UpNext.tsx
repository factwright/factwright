import type { JobStatus, StepAction } from '@factwright/core';
import { Button } from '@factwright/ui';
import { Check } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { type RunTask, THANKS_SKILL } from '../../shared/runs.ts';
import { ClaudeButton, isRunning } from './ClaudeButton.tsx';
import { FOCUS_NEXT, SORT_MOVES } from './Decide.tsx';
import { requestAddCall } from './JobCalls.tsx';
import { showSection } from './PanelSection.tsx';
import type { RunControls } from './RunActions.tsx';
import type { JobRow } from './rows.ts';
import styles from './UpNext.module.css';

const TONE = { urgent: styles.urgent, action: styles.action, info: styles.info } as const;

/** The steps Claude does, with the run that does each and what its button says. */
function claudeStep(jobId: string, action: StepAction): { task: RunTask; label: string } | null {
  switch (action.kind) {
    case 'fit-check':
      return { task: { skill: 'fit-check', jobId }, label: 'Run a fit check' };
    case 'resume':
      return { task: { skill: 'focused-resume', jobId }, label: 'Tailor a resume' };
    case 'letter':
      return { task: { skill: 'cover-letter', jobId }, label: 'Write the cover letter' };
    case 'projects':
      return { task: { skill: 'projects-page', jobId }, label: 'Make a Projects page' };
    case 'outreach':
      return { task: { skill: 'who-to-message', jobId }, label: 'Find people to message' };
    case 'prep':
      return {
        task: { skill: 'interview-prep', jobId, callId: action.callId },
        label: 'Prep for the call',
      };
    case 'practice':
      return {
        task: { skill: 'interview-prep', jobId, callId: action.callId, practice: true },
        label: 'Practice for the call',
      };
    case 'thanks':
      return {
        task: { skill: THANKS_SKILL, jobId, callId: action.callId },
        label: 'Draft thank-you notes',
      };
    default:
      return null;
  }
}

/** The status a step moves the job to as its main button, when it's one of the sorting moves. */
const MOVE: Partial<Record<StepAction['kind'], JobStatus>> = {
  'to-apply': 'apply',
  pass: 'passed',
};

/** Whether the step says no more than its button does, such as "Run a fit check". */
const said = (text: string, label: string) =>
  text.toLowerCase().replace(/[.?!]$/, '') === label.toLowerCase();

/**
 * What to do next for a job, at the top of its panel, whatever its stage: the step the list shows
 * for it, and the button that does it, such as Run a fit check, Tailor a resume, Mark as applied,
 * Add a call once the user hears back, Draft thank-you notes after a call, or Accept an offer. A
 * job not sorted yet has the moves to sort it beside the step: To review, To apply, Later, Pass.
 */
export function UpNext({
  row,
  api,
  run,
  sorting,
  onMove,
}: {
  row: JobRow;
  api: FactwrightApi;
  /** Claude's panel, once Claude is ready, for the steps Claude does. */
  run?: RunControls | undefined;
  /** Whether the job is one to sort: new, to review, or back from later. */
  sorting: boolean;
  /** Moves the job to another status, such as applied, or an offer accepted. */
  onMove: (status: JobStatus) => void;
}) {
  const headingId = useId();
  const [problem, setProblem] = useState<{ jobId: string; message: string } | null>(null);
  const { job, next, progress } = row;
  if (!next && !sorting) return null;
  const action = next?.action;
  const claude = action ? claudeStep(job.id, action) : null;
  const move = action ? MOVE[action.kind] : undefined;

  const clearReminder = async () => {
    const result = await api.updateJob(job.id, { nextAction: null, nextOn: null });
    setProblem(result.ok ? null : { jobId: job.id, message: result.message });
  };
  const button = (label: string, onClick: () => void, icon?: ReactNode) => (
    <Button size="sm" variant="primary" icon={icon} onClick={onClick} {...FOCUS_NEXT}>
      {label}
    </Button>
  );
  const also = (label: string, onClick: () => void) => (
    <Button size="sm" onClick={onClick}>
      {label}
    </Button>
  );

  // The step's main button, and what goes with it.
  let main: ReactNode = null;
  let label = '';
  let more: ReactNode = null;
  if (claude) {
    label = claude.label;
    main = <ClaudeButton run={run} task={claude.task} label={label} primary />;
    if (action?.kind === 'outreach') more = also('Mark no reply', () => onMove('ghosted'));
    // Beside Tailor a resume, one that asks nothing. While either runs, one says Claude is on it.
    if (action?.kind === 'resume' && !isRunning(run, claude.task)) {
      const quick: RunTask = { skill: 'focused-resume', jobId: job.id, quick: true };
      more = <ClaudeButton run={run} task={quick} label="Quick resume" />;
    }
  } else if (action?.kind === 'apply') {
    label = 'Mark as applied';
    main = button(label, () => onMove('applied'));
  } else if (action?.kind === 'add-call') {
    label = 'Add a call';
    main = button(label, () => requestAddCall());
  } else if (action?.kind === 'no-reply') {
    label = 'Mark no reply';
    main = button(label, () => onMove('ghosted'));
  } else if (action?.kind === 'debrief') {
    label = 'Say how it went';
    main = button(label, () => showSection('calls'));
  } else if (action?.kind === 'offer') {
    label = 'Accept';
    main = button(label, () => onMove('accepted'));
    more = also('Decline', () => onMove('declined'));
  } else if (action?.kind === 'reminder') {
    label = 'Done';
    main = (
      <Button
        size="sm"
        variant="primary"
        icon={<Check size={14} aria-hidden="true" />}
        aria-label="Done: clear the reminder"
        onClick={() => void clearReminder()}
        {...FOCUS_NEXT}
      >
        Done
      </Button>
    );
  }
  // A job to sort has its moves here: the step's own, such as To apply, stands out. After a
  // quick choice, the keyboard's focus goes to the step's button, or else to that move, or else
  // to the first one, such as while Claude is busy with another job.
  const choices = sorting
    ? SORT_MOVES.filter((each) => each.status !== progress.status || progress.status === 'later')
    : [];
  const lead = move ?? choices[0]?.status;
  const moves = choices.map((each) => (
    <Button
      key={each.status}
      size="sm"
      variant={each.status === move ? 'primary' : 'secondary'}
      onClick={() => onMove(each.status)}
      {...(each.status === lead && FOCUS_NEXT)}
    >
      {each.label}
    </Button>
  ));
  // While Claude does the step, its button says so, so the step says what it is.
  const running = claude ? isRunning(run, claude.task) : false;
  const text = next && !(label && said(next.text, label) && !running) ? next.text : null;

  return (
    <section
      className={`${styles.box} ${next ? TONE[next.level] : ''}`}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} className={styles.kicker}>
        Up next
      </h3>
      {text && <p className={styles.step}>{text}</p>}
      <div className={styles.actions}>
        {main}
        {moves.length > 0 && (
          <fieldset className={styles.moves}>
            <legend className={styles.legend}>Sort this job</legend>
            {moves}
          </fieldset>
        )}
        {more}
      </div>
      {claude && !run && (
        <p className={styles.hint}>
          Your Claude isn’t ready yet. The card in the sidebar says what to do.
        </p>
      )}
      {problem?.jobId === job.id && (
        <p className={styles.problem} role="alert">
          {problem.message}
        </p>
      )}
    </section>
  );
}
