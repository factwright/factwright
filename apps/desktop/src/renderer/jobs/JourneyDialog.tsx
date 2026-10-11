import {
  type JourneyOutcome,
  type JourneySummary,
  journeyCsv,
  journeyFlowChart,
  journeySummary,
  journeys,
} from '@factwright/core';
import { Button, Dialog, Pill, type Tone } from '@factwright/ui';
import { useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import styles from './JourneyDialog.module.css';
import type { JobRow } from './rows.ts';

type Step = Exclude<keyof JourneySummary, 'outcomes'>;

/** How far jobs got, in order, each in the tint of the status it matches. */
const STEPS: readonly { step: Step; label: string; tone: Tone }[] = [
  { step: 'found', label: 'Found', tone: 'gray' },
  { step: 'checked', label: 'Checked', tone: 'slate' },
  { step: 'resume', label: 'Resume built', tone: 'violet' },
  { step: 'applied', label: 'Applied', tone: 'blue' },
  { step: 'heardBack', label: 'Heard back', tone: 'teal' },
  { step: 'interviewed', label: 'Interviewed', tone: 'purple' },
  { step: 'offers', label: 'Offer', tone: 'green' },
];

/** How jobs ended, in words, for the ones that applied. */
const ENDINGS: readonly { outcome: JourneyOutcome; words: string; tone: Tone }[] = [
  { outcome: 'Accepted offer', words: 'accepted an offer', tone: 'green' },
  { outcome: 'Declined offer', words: 'declined an offer', tone: 'gray' },
  { outcome: 'Rejected', words: 'rejected', tone: 'red' },
  { outcome: 'No response', words: 'no reply', tone: 'gray' },
  { outcome: 'Withdrew', words: 'withdrew', tone: 'gray' },
  { outcome: 'Passed', words: 'passed', tone: 'gray' },
  { outcome: 'In progress', words: 'still in play', tone: 'blue' },
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** How far the user's jobs got, how they ended, and the two ways to take that elsewhere. */
export function JourneyDialog({
  rows,
  api,
  today,
  onClose,
}: {
  rows: readonly JobRow[];
  api: FactwrightApi;
  today: string;
  onClose: () => void;
}) {
  const list = journeys(rows);
  const summary = journeySummary(list);
  const [done, setDone] = useState<'copied' | 'saved' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const endings = ENDINGS.filter(({ outcome }) => summary.outcomes[outcome]);

  const copy = async () => {
    const result = await api.copyText(journeyFlowChart(list, today));
    setProblem(result.ok ? null : result.message);
    if (result.ok) setDone('copied');
  };
  const save = async () => {
    const result = await api.saveFile(`job-search-journey-${today}.csv`, journeyCsv(list));
    setProblem(result.ok ? null : result.message);
    if (result.ok && result.saved) setDone('saved');
  };

  return (
    <Dialog
      title="Your journey"
      description={`How far your ${plural(summary.found, 'job')} got, from finding them to how they ended.`}
      onClose={onClose}
    >
      <ol className={styles.steps} aria-label="How far your jobs got">
        {STEPS.map(({ step, label, tone }) => {
          const count = summary[step];
          const share = summary.found ? count / summary.found : 0;
          return (
            <li key={step} className={styles.step}>
              <span className={styles.label}>{label}</span>
              <span className={styles.count}>{count}</span>
              <span className={styles.track} aria-hidden="true">
                <span
                  className={styles.fill}
                  style={{
                    width: count ? `${Math.max(2, Math.round(share * 100))}%` : 0,
                    background: `var(--fw-tone-${tone}-fg)`,
                  }}
                />
              </span>
            </li>
          );
        })}
      </ol>

      <h3 className={styles.heading}>How they ended</h3>
      {endings.length > 0 ? (
        <ul className={styles.endings}>
          {endings.map(({ outcome, words, tone }) => (
            <li key={outcome}>
              <Pill tone={tone}>
                {summary.outcomes[outcome]} {words}
              </Pill>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>None yet. Jobs show here once you apply.</p>
      )}

      <div className={styles.actions}>
        <Button onClick={copy}>{done === 'copied' ? 'Copied' : 'Copy as a flow chart'}</Button>
        <Button onClick={save}>{done === 'saved' ? 'Saved' : 'Download as a spreadsheet'}</Button>
      </div>
      <p className={styles.hint}>
        The flow chart is text for sankeymatic.com, a free site that draws every path your jobs
        took. The spreadsheet has each step’s date.
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </Dialog>
  );
}
