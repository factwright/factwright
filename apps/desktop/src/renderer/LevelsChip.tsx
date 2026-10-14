import { Tooltip } from '@factwright/ui';
import { Gauge } from 'lucide-react';
import type { EffortChoices } from '../shared/effort.ts';
import { billedByUse, planLevels } from '../shared/levels.ts';
import type { ModelChoices } from '../shared/models.ts';
import styles from './LevelsChip.module.css';
import { levelName, summarize, taskLevels } from './levels.ts';
import { planName } from './plan.ts';

/** The tasks Sonnet suits with Pro's levels, which use less, in plain words. */
const ROUTINE = 'fit checks, salary checks, job searches and who to message';

/**
 * What the tooltip says: what's best overall, what's best on the user's plan, even when that's
 * lower, and that results can vary with the level.
 */
function Help({ plan, method }: { plan: string | undefined; method: string | undefined }) {
  const name = planName(plan);
  return (
    <>
      <p>
        <strong>Best overall:</strong> Opus at Extra high, with job searches at High, since they
        read hundreds of postings. Max effort is the most careful, but can take many minutes a run.
      </p>
      {plan === 'pro' ? (
        <p>
          <strong>Best on your Pro plan,</strong> whose limits are the tightest: Sonnet for{' '}
          {ROUTINE}, and Opus at High for the writing.
        </p>
      ) : billedByUse(method) ? (
        <p>
          <strong>Best when every token is billed,</strong> as with an API key: Sonnet for {ROUTINE}
          , and Opus at High for the writing, as on a Pro plan.
        </p>
      ) : (
        name && (
          <p>
            <strong>Best on your {name}:</strong> the same.
          </p>
        )
      )}
      <p>
        <strong>Results can vary with the level.</strong> Lower levels are quicker and use less, but
        can miss what a higher one would catch.
      </p>
    </>
  );
}

/**
 * A quiet chip under Your Claude: the model and effort most tasks run at, and a few words on the
 * ones that differ. Its tooltip says what's best overall and on the user's plan, and a click
 * opens Claude's settings to change them.
 */
export function LevelsChip({
  plan,
  method,
  models,
  effort,
  onOpen,
}: {
  /** The user's Claude plan, such as "pro", and how Claude Code signs in, as it reports them. */
  plan: string | undefined;
  method: string | undefined;
  models: ModelChoices;
  effort: EffortChoices;
  onOpen: () => void;
}) {
  const { most, others } = summarize(taskLevels(models, effort, planLevels(plan, method)));
  const name = levelName(most);
  return (
    // Clear of the sidebar's edge: past its padding and border, then the usual gap.
    <Tooltip side="right" gap={21} content={<Help plan={plan} method={method} />}>
      {(trigger) => (
        <button
          type="button"
          className={styles.chip}
          aria-label={`Claude’s levels: ${name}. ${others}.`}
          aria-haspopup="dialog"
          onClick={onOpen}
          {...trigger}
        >
          <Gauge className={styles.icon} size={14} aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.level}>{name}</span>
            <span className={styles.others}>{others}</span>
          </span>
        </button>
      )}
    </Tooltip>
  );
}
