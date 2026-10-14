import {
  type JourneyOutcome,
  type JourneySummary,
  journeyCsv,
  journeyFlowChart,
  journeySummary,
  journeys,
  type KindName,
} from '@factwright/core';
import { Button, Dialog, Pill, SegmentedControl, Select, type Tone } from '@factwright/ui';
import { useId, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { usePref } from '../prefs.ts';
import { FlowChart } from './FlowChart.tsx';
import styles from './JourneyDialog.module.css';
import { type JobRow, ofKind } from './rows.ts';

/** The two ways to see the journey: how far jobs got, step by step, or every path as a chart. */
type JourneyView = 'summary' | 'chart';

const isJourneyView = (value: unknown): value is JourneyView =>
  value === 'summary' || value === 'chart';

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

/** How jobs ended, in words, for the ones that applied, with the words for more than one. */
const ENDINGS: readonly { outcome: JourneyOutcome; words: string; many?: string; tone: Tone }[] = [
  { outcome: 'Accepted offer', words: 'accepted an offer', tone: 'green' },
  { outcome: 'Declined offer', words: 'declined an offer', tone: 'gray' },
  { outcome: 'Rejected', words: 'rejected', tone: 'red' },
  { outcome: 'No response', words: 'no reply', tone: 'gray' },
  { outcome: 'Withdrew', words: 'withdrew', tone: 'gray' },
  { outcome: 'Role closed', words: 'role closed', many: 'roles closed', tone: 'gray' },
  { outcome: 'Passed', words: 'passed', tone: 'gray' },
  { outcome: 'In progress', words: 'still in play', tone: 'blue' },
];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * How far the user's jobs got and how they ended, as a summary or as a flow chart of every path
 * they took, and the two ways to take that elsewhere. A user who wants more than one kind of job
 * can see one kind's, or how each kind is going.
 */
export function JourneyDialog({
  rows,
  kinds = [],
  kind: startingKind = null,
  api,
  today,
  onClose,
}: {
  rows: readonly JobRow[];
  /** The kinds of job the user wants, when there's more than one. */
  kinds?: readonly KindName[];
  /** The kind of job to start on, by id, or null for every kind. */
  kind?: string | null;
  api: FactwrightApi;
  today: string;
  onClose: () => void;
}) {
  const split = kinds.length > 1;
  const [kind, setKind] = useState(
    split && kinds.some((each) => each.id === startingKind) ? startingKind : null,
  );
  const list = journeys(ofKind(rows, kind));
  const summary = journeySummary(list);
  const [done, setDone] = useState<'copied' | 'saved' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = usePref<JourneyView>('journey.view', 'summary', isJourneyView);
  const endings = ENDINGS.filter(({ outcome }) => summary.outcomes[outcome]);

  const copy = async () => {
    const result = await api.copyText(journeyFlowChart(list, today));
    setProblem(result.ok ? null : result.message);
    if (result.ok) setDone('copied');
  };
  const save = async () => {
    const file = `job-search-journey-${kind ? `${kind}-` : ''}${today}.csv`;
    const result = await api.saveFile(file, journeyCsv(list, kinds));
    setProblem(result.ok ? null : result.message);
    if (result.ok && result.saved) setDone('saved');
  };

  return (
    <Dialog
      title="Your journey"
      description={`How far your ${plural(summary.found, 'job')} got, from finding them to how they ended.`}
      size="xl"
      onClose={onClose}
    >
      <div className={styles.controls}>
        <SegmentedControl
          label="Show"
          options={[
            { value: 'summary', label: 'Summary' },
            { value: 'chart', label: 'Flow chart' },
          ]}
          value={view}
          onChange={setView}
        />
        {split && (
          <Select
            className={styles.kind}
            aria-label="Kind of job"
            value={kind ?? ''}
            onChange={(event) => {
              setKind(event.target.value || null);
              setDone(null);
            }}
          >
            <option value="">Every kind of job</option>
            {kinds.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className={styles.view}>
        {view === 'chart' ? (
          <FlowChart list={list} />
        ) : (
          <>
            <Summary summary={summary} endings={endings} />
            {split && !kind && <ByKind rows={rows} kinds={kinds} />}
          </>
        )}
      </div>

      <div className={styles.actions}>
        <Button onClick={copy}>{done === 'copied' ? 'Copied' : 'Copy for SankeyMATIC'}</Button>
        <Button onClick={save}>{done === 'saved' ? 'Saved' : 'Download as a spreadsheet'}</Button>
      </div>
      <p className={styles.hint}>
        The flow chart can be copied as text for sankeymatic.com, a free site where you can restyle
        it. The spreadsheet has each step’s date.
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </Dialog>
  );
}

/** The steps the kinds of job are compared by, in order. */
const COMPARED: readonly { step: Step; label: string }[] = [
  { step: 'found', label: 'Found' },
  { step: 'applied', label: 'Applied' },
  { step: 'heardBack', label: 'Heard back' },
  { step: 'interviewed', label: 'Interviewed' },
  { step: 'offers', label: 'Offer' },
];

/** How far each kind of job got, side by side, such as which hears back more. */
function ByKind({ rows, kinds }: { rows: readonly JobRow[]; kinds: readonly KindName[] }) {
  const heading = useId();
  const each = kinds.map((kind) => ({
    kind,
    summary: journeySummary(journeys(ofKind(rows, kind.id))),
  }));
  return (
    <>
      <h3 className={styles.heading} id={heading}>
        By kind of job
      </h3>
      <div className={styles.byKindWrap}>
        <table className={styles.byKind} aria-labelledby={heading}>
          <thead>
            <tr>
              <th scope="col">Kind of job</th>
              {COMPARED.map(({ step, label }) => (
                <th key={step} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {each.map(({ kind, summary }) => (
              <tr key={kind.id}>
                <th scope="row">{kind.name}</th>
                {COMPARED.map(({ step }) => (
                  <td key={step}>
                    {summary[step]}
                    {step === 'heardBack' && summary.applied > 0 && (
                      <span className={styles.share}>
                        {' '}
                        {Math.round((100 * summary.heardBack) / summary.applied)}%
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** How far jobs got, step by step, and how the ones that ended, ended. */
function Summary({ summary, endings }: { summary: JourneySummary; endings: typeof ENDINGS }) {
  return (
    <>
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
          {endings.map(({ outcome, words, many, tone }) => {
            const count = summary.outcomes[outcome] ?? 0;
            return (
              <li key={outcome}>
                <Pill tone={tone}>
                  {count} {count === 1 ? words : (many ?? words)}
                </Pill>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.hint}>None yet. Jobs show here once you apply.</p>
      )}
    </>
  );
}
