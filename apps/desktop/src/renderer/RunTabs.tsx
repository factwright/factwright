import { VisuallyHidden } from '@factwright/ui';
import { type KeyboardEvent, useRef } from 'react';
import type { LineWait, RunView } from '../shared/api.ts';
import styles from './RunTabs.module.css';

/** Where a run stands, as its tab's dot shows it. */
export type TabState = 'in-line' | 'working' | 'waiting' | 'done' | 'stopped' | 'failed';

/** What each state means, in words, for its tab's name. */
const STATE_WORDS: Readonly<Record<TabState, string>> = {
  'in-line': 'in line',
  working: 'working',
  waiting: 'waiting on you',
  done: 'done',
  stopped: 'stopped',
  failed: 'didn’t finish',
};

/**
 * Where a run stands for its tab: in line; failed, as when it couldn't start, Claude Code
 * stopped before it finished, or its turn ended in an error; waiting on the user, for a question,
 * an OK, a screen of Claude Code's own, or a reply to what Claude asked in its own words; working;
 * stopped; or done.
 */
export function tabState(
  run: Pick<RunView, 'phase' | 'screen' | 'problem'>,
  { waiting, failed }: { waiting: boolean; failed: boolean },
): TabState {
  if (run.phase === 'in-line') return 'in-line';
  if (run.problem || run.phase === 'failed' || failed) return 'failed';
  if (run.phase === 'needs-answer' || run.screen || waiting) return 'waiting';
  if (run.phase === 'starting' || run.phase === 'working') return 'working';
  return run.phase === 'stopped' ? 'stopped' : 'done';
}

/**
 * The runs summed up, as the panel's bar says it: "3 running · 1 waiting on you · 1 in line".
 * Runs that are done, stopped or failed show only in their own tabs.
 */
export function runSummary(states: readonly TabState[]): string {
  const count = (state: TabState) => states.filter((each) => each === state).length;
  return [
    count('working') && `${count('working')} running`,
    count('waiting') && `${count('waiting')} waiting on you`,
    count('in-line') && `${count('in-line')} in line`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * What a task in line waits for, in a sentence: its turn, while as many run as may at once,
 * Claude's other task on the same job or part of the job hunt, or Claude Code getting going in
 * another tab, past the screens it shows the first time.
 */
export function lineWords(waits: LineWait | null, atOnce: number, onJob: boolean): string {
  if (waits === 'job') {
    return onJob
      ? 'Waits for Claude’s other task on this job, then starts by itself.'
      : 'Waits for Claude’s task before it, then starts by itself.';
  }
  if (waits === 'setup') return 'Waits for Claude Code to get going in another tab, then starts.';
  return atOnce === 1
    ? 'Waits its turn, as one task runs at a time, then starts by itself.'
    : `Waits its turn, as ${atOnce} tasks run at once, then starts by itself.`;
}

export interface RunTab {
  id: string;
  /** What the run is for, such as "Talkiatry · Tailored resume". */
  title: string;
  state: TabState;
  /** Where its Claude is on its to-do list, while it works with one, such as step 3 of 7. */
  step?: { at: number; of: number } | null;
}

/**
 * The tabs along the top of Claude's panel, one for each run and each task in line, each with a
 * dot that says where it stands, and for a run at work on a to-do list, how far it's come, such
 * as "3/7", and the runs summed up beside them: "3 running · 1 waiting on you · 1 in line". The
 * arrow keys move between tabs, as tabs do.
 */
export function RunTabs({
  tabs,
  selected,
  onSelect,
  panelId,
}: {
  tabs: readonly RunTab[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** The panel the tabs show, for each tab to name. */
  panelId: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent, at: number) => {
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    const tab = tabs[to];
    if (!tab) return;
    event.preventDefault();
    onSelect(tab.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[to]?.focus();
  };
  const summary = runSummary(tabs.map((tab) => tab.state));
  return (
    <div className={styles.strip}>
      <div ref={list} className={styles.tabs} role="tablist" aria-label="Claude’s tasks">
        {tabs.map((tab, at) => {
          const shown = tab.id === selected;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${panelId}-${tab.id}`}
              aria-selected={shown}
              aria-controls={panelId}
              tabIndex={shown ? 0 : -1}
              title={tab.title}
              className={`${styles.tab} ${shown ? styles.shown : ''}`}
              onClick={() => onSelect(tab.id)}
              onKeyDown={(event) => move(event, at)}
            >
              <span className={`${styles.dot} ${styles[tab.state]}`} aria-hidden="true" />
              <span className={styles.name}>{tab.title}</span>
              {tab.state === 'working' && tab.step && (
                <span className={styles.step} aria-hidden="true">
                  {tab.step.at}/{tab.step.of}
                </span>
              )}
              <VisuallyHidden>
                , {STATE_WORDS[tab.state]}
                {tab.state === 'working' && tab.step
                  ? `, step ${tab.step.at} of ${tab.step.of}`
                  : ''}
              </VisuallyHidden>
            </button>
          );
        })}
      </div>
      {summary && <p className={styles.summary}>{summary}</p>}
    </div>
  );
}
