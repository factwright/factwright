import { type Job, type JobProgress, type KindTarget, payLabel } from '@factwright/core';
import { FIT_TIER_DISPLAY } from '@factwright/ui';
import { Gauge } from 'lucide-react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { RunTask } from '../../shared/runs.ts';
import { ClaudeButton } from './ClaudeButton.tsx';
import styles from './FitArea.module.css';
import { isScored, ScoreSection, SearchSection, SentimentSection } from './JobScore.tsx';
import { PanelSection, Placeholder } from './PanelSection.tsx';
import { PayAskLine } from './PayAsk.tsx';
import type { RunControls } from './RunActions.tsx';

/**
 * The job's pay, as the posting listed it or a salary check estimated it, or else the button that
 * estimates it.
 */
function Pay({ job, run }: { job: Job; run: RunControls | undefined }) {
  const { pay } = job;
  return (
    <div className={styles.pay}>
      {pay ? (
        <p>
          <strong>Pay:</strong> {payLabel(pay) ?? pay.text}
          <span className={styles.source}>
            {pay.source === 'listed' ? ', as listed' : ', estimated by a salary check'}
          </span>
        </p>
      ) : (
        <>
          <p>
            <strong>Pay:</strong> <span className={styles.source}>not listed</span>
          </p>
          <ClaudeButton
            run={run}
            task={{ skill: 'salary-check', jobId: job.id }}
            label="Estimate the pay"
            adds
          />
        </>
      )}
    </div>
  );
}

/**
 * How well the job fits, across the top of its panel: its score part by part, what people say
 * about the company, what the job search noted, its pay, and the pay to ask for there. Before
 * Claude analyzes the job, what Analyze job does and the button that does it.
 */
export function FitArea({
  job,
  progress,
  run,
  today,
  api,
  targets = [],
}: {
  job: Job;
  progress: JobProgress;
  run: RunControls | undefined;
  today: string;
  /** For changing the pay to ask for. */
  api: Pick<FactwrightApi, 'updateJob'>;
  /** Each kind of job the user wants, with their target pay for it. */
  targets?: readonly KindTarget[] | undefined;
}) {
  const task: RunTask = { skill: 'analyze-job', jobId: job.id };
  const scored = isScored(job);
  const { tier, score } = progress;
  const summary = tier && `${FIT_TIER_DISPLAY[tier].label}${score !== null ? ` ${score}` : ''}`;
  return (
    <PanelSection
      id="fit"
      title="Fit"
      icon={<Gauge size={15} />}
      summary={summary}
      empty={!scored}
      actions={
        scored && (
          <ClaudeButton run={run} task={task} label={job.fit ? 'Analyze again' : 'Analyze job'} />
        )
      }
    >
      {!scored && (
        <Placeholder action={<ClaudeButton run={run} task={task} label="Analyze job" />}>
          {summary ? `The job search rated it ${summary}. ` : ''}Analyze job reads the posting, puts
          the job’s details right from it, and merges it with a job saved twice. Then it scores the
          job against your fact bank, part by part, looks up what people say about the company, and
          suggests the pay to ask for.
        </Placeholder>
      )}
      <Pay job={job} run={run} />
      <PayAskLine key={job.id} job={job} targets={targets} api={api} />
      {scored && (
        <div className={styles.grid}>
          <div>
            <ScoreSection job={job} today={today} />
          </div>
          <div className={styles.side}>
            <SentimentSection job={job} today={today} />
            <SearchSection job={job} today={today} />
          </div>
        </div>
      )}
    </PanelSection>
  );
}
