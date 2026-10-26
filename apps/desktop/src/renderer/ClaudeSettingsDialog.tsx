import { Button, Dialog, DialogActions, Select } from '@factwright/ui';
import { Fragment, useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import {
  EFFORT_NAMES,
  EFFORTS,
  type Effort,
  type EffortChoices,
  effortWithout,
} from '../shared/effort.ts';
import { billedByUse, planLevels } from '../shared/levels.ts';
import {
  MODEL_NAMES,
  MODELS,
  type Model,
  type ModelChoices,
  type ModelTask,
  modelWithout,
} from '../shared/models.ts';
import { ANALYZE_ON_ITS_OWN, AT_ONCE } from '../shared/runs.ts';
import styles from './ClaudeSettingsDialog.module.css';
import { RUN_ACTIONS } from './jobs/RunActions.tsx';

/** The tasks the app starts, as their buttons name them. */
const TASKS: readonly { task: ModelTask; label: string }[] = [
  ...RUN_ACTIONS.map(({ skill, label }) => ({ task: skill, label })),
  { task: 'ask', label: 'Questions about a job' },
  { task: 'job-search', label: 'Find jobs' },
  { task: 'get-started', label: 'Getting started' },
  { task: 'add-facts', label: 'Fact bank interviews' },
  { task: 'make-template', label: 'Making templates' },
  { task: 'work-history', label: 'Work history' },
];

type SettingsApi = Pick<
  FactwrightApi,
  | 'claudeModels'
  | 'setClaudeModels'
  | 'claudeEffort'
  | 'setClaudeEffort'
  | 'runsAtOnce'
  | 'setRunsAtOnce'
  | 'analyzesNewJobs'
  | 'setAnalyzesNewJobs'
>;

/** How many tasks may run at once, as the setting offers them. */
const AT_ONCE_CHOICES = Array.from(
  { length: AT_ONCE.most - AT_ONCE.least + 1 },
  (_, at) => AT_ONCE.least + at,
);

/** A task's own choice, or none to go back to what everything uses. */
function choose<T extends string>(
  tasks: Partial<Record<ModelTask, T>>,
  task: ModelTask,
  value: T | '',
) {
  const others = Object.fromEntries(Object.entries(tasks).filter(([each]) => each !== task));
  return (value ? { ...others, [task]: value } : others) as Partial<Record<ModelTask, T>>;
}

/**
 * How Claude works on the job hunt: which model it runs on and how hard it thinks, for
 * everything and for each task, how many tasks it runs at once, whether it analyzes new jobs on
 * its own, and what it does without asking. Each choice saves as it's made.
 */
export function ClaudeSettingsDialog({
  api,
  onClose,
  onSaved,
  plan,
  method,
}: {
  api: SettingsApi;
  onClose: () => void;
  /** Hears what's saved for the model or effort after each change, even one that didn't save. */
  onSaved?: (saved: { models: ModelChoices } | { effort: EffortChoices }) => void;
  /** The user's Claude plan, such as "pro", when Claude Code says. */
  plan?: string | undefined;
  /** How Claude Code signs in, such as "api_key", when it says. */
  method?: string | undefined;
}) {
  const suggested = planLevels(plan, method);
  const [models, setModels] = useState<ModelChoices | null>(null);
  const [effort, setEffort] = useState<EffortChoices | null>(null);
  const [atOnce, setAtOnce] = useState<number | null>(null);
  const [analyzes, setAnalyzes] = useState<boolean | null>(null);
  const [byTask, setByTask] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const modelsHeading = useId();
  const atOnceHeading = useId();
  const askingHeading = useId();

  useEffect(() => {
    void Promise.all([api.claudeModels(), api.claudeEffort()]).then(([chosen, levels]) => {
      setModels(chosen);
      setEffort(levels);
      setByTask(Object.keys({ ...chosen.tasks, ...levels.tasks }).length > 0);
    });
    void api.runsAtOnce().then(setAtOnce, () => setAtOnce(AT_ONCE.usual));
    void api.analyzesNewJobs().then(setAnalyzes, () => setAnalyzes(true));
  }, [api]);

  const failed = () => setProblem('That didn’t save. Try again.');

  const changeModels = async (next: ModelChoices) => {
    setModels(next);
    try {
      const saved = await api.setClaudeModels(next);
      setModels(saved);
      onSaved?.({ models: saved });
      setProblem(null);
    } catch {
      failed();
      const kept = await api.claudeModels();
      setModels(kept);
      onSaved?.({ models: kept });
    }
  };

  const changeEffort = async (next: EffortChoices) => {
    setEffort(next);
    try {
      const saved = await api.setClaudeEffort(next);
      setEffort(saved);
      onSaved?.({ effort: saved });
      setProblem(null);
    } catch {
      failed();
      const kept = await api.claudeEffort();
      setEffort(kept);
      onSaved?.({ effort: kept });
    }
  };

  const changeAtOnce = async (next: number) => {
    setAtOnce(next);
    try {
      setAtOnce(await api.setRunsAtOnce(next));
      setProblem(null);
    } catch {
      failed();
      setAtOnce(await api.runsAtOnce().catch(() => AT_ONCE.usual));
    }
  };

  const changeAnalyzes = async (on: boolean) => {
    setAnalyzes(on);
    try {
      setAnalyzes(await api.setAnalyzesNewJobs(on));
      setProblem(null);
    } catch {
      failed();
      setAnalyzes(await api.analyzesNewJobs().catch(() => !on));
    }
  };

  const options = MODELS.map((model) => (
    <option key={model} value={model}>
      {MODEL_NAMES[model]}
    </option>
  ));
  const levels = EFFORTS.map((level) => (
    <option key={level} value={level}>
      {EFFORT_NAMES[level]}
    </option>
  ));

  return (
    <Dialog title="Claude settings" size="lg" onClose={onClose}>
      {models && effort && (
        <section aria-labelledby={modelsHeading}>
          <h3 id={modelsHeading} className={styles.heading}>
            Model and effort
          </h3>
          <p className={styles.lead}>
            Opus is the most careful, and uses the most of your plan. Sonnet is quicker, and Haiku
            is the quickest. Each means the newest model of its kind. Effort is how long Claude
            thinks before it acts: more is more careful and slower, and uses more of your plan.
            Recommended suits your plan, and Max, the most careful, can take many minutes a run.
          </p>
          {suggested === 'pro' && (
            <p className={`${styles.lead} ${styles.pro}`}>
              <strong>
                {billedByUse(method) && plan !== 'pro'
                  ? 'Every token is billed with an API key, a Console account or a cloud provider.'
                  : 'On a Pro plan, limits are the tightest.'}
              </strong>{' '}
              So recommended runs analyzing jobs, salary checks, job searches and who to message on
              Sonnet, which uses less, and keeps Opus for the writing, with High effort or lower.
            </p>
          )}
          <div className={styles.grid}>
            <span aria-hidden="true" />
            <span className={styles.column} aria-hidden="true">
              Model
            </span>
            <span className={styles.column} aria-hidden="true">
              Effort
            </span>
            <span className={styles.row}>For everything</span>
            <Select
              aria-label="Model for everything"
              value={models.main ?? ''}
              onChange={(event) =>
                void changeModels({ ...models, main: (event.target.value as Model) || null })
              }
            >
              <option value="">Recommended</option>
              {options}
            </Select>
            <Select
              aria-label="Effort for everything"
              value={effort.main ?? ''}
              onChange={(event) =>
                void changeEffort({ ...effort, main: (event.target.value as Effort) || null })
              }
            >
              <option value="">Recommended</option>
              {levels}
            </Select>
          </div>
          <details
            className={styles.byTask}
            open={byTask}
            onToggle={(event) => setByTask(event.currentTarget.open)}
          >
            <summary>Choose by task</summary>
            <div className={styles.grid}>
              {TASKS.map(({ task, label }) => (
                <Fragment key={task}>
                  <span className={styles.row}>{label}</span>
                  <Select
                    aria-label={`Model for ${label}`}
                    value={models.tasks[task] ?? ''}
                    onChange={(event) =>
                      void changeModels({
                        ...models,
                        tasks: choose(models.tasks, task, event.target.value as Model | ''),
                      })
                    }
                  >
                    <option value="">
                      {`${models.main ? 'Same as everything' : 'Recommended'} (${MODEL_NAMES[modelWithout(models, task, suggested)]})`}
                    </option>
                    {options}
                  </Select>
                  <Select
                    aria-label={`Effort for ${label}`}
                    value={effort.tasks[task] ?? ''}
                    onChange={(event) =>
                      void changeEffort({
                        ...effort,
                        tasks: choose(effort.tasks, task, event.target.value as Effort | ''),
                      })
                    }
                  >
                    <option value="">
                      {`${effort.main ? 'Same as everything' : 'Recommended'} (${EFFORT_NAMES[effortWithout(effort, task, suggested)]})`}
                    </option>
                    {levels}
                  </Select>
                </Fragment>
              ))}
            </div>
          </details>
        </section>
      )}
      {atOnce !== null && (
        <section aria-labelledby={atOnceHeading} className={styles.section}>
          <h3 id={atOnceHeading} className={styles.heading}>
            Tasks at once
          </h3>
          <p className={styles.lead}>
            Each task runs in a Claude of its own, in a tab of Claude’s panel, side by side with the
            others. Past this many, a task waits in line and starts by itself. Two tasks on one job
            never run at once. More at once uses your plan faster.
          </p>
          <div className={styles.grid}>
            <span className={styles.row}>Run at once</span>
            <Select
              aria-label="Tasks at once"
              value={String(atOnce)}
              onChange={(event) => void changeAtOnce(Number(event.target.value))}
            >
              {AT_ONCE_CHOICES.map((count) => (
                <option key={count} value={count}>
                  {count === 1 ? '1 task' : `${count} tasks`}
                  {count === AT_ONCE.usual ? ' (recommended)' : ''}
                </option>
              ))}
            </Select>
          </div>
          {analyzes !== null && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={analyzes}
                onChange={(event) => void changeAnalyzes(event.target.checked)}
              />
              <span className={styles.checkText}>
                <span className={styles.checkName}>Analyze new jobs on their own</span>
                <span className={styles.checkAbout}>
                  When Claude is free, it analyzes the jobs you saved since, up to{' '}
                  {ANALYZE_ON_ITS_OWN} in one run. It steps aside for any task you start.
                </span>
              </span>
            </label>
          )}
        </section>
      )}
      <section aria-labelledby={askingHeading} className={styles.section}>
        <h3 id={askingHeading} className={styles.heading}>
          Without asking
        </h3>
        <p className={styles.lead}>
          Claude works only in your job hunt, and can’t run programs on your computer. It searches
          the web, reads web pages and changes your job hunt’s files without asking. It never reads
          LinkedIn. Your facts change only through Factwright’s fact tools, which take only what you
          answered Claude. Once a task is done, Claude’s panel lists each file it changed, with
          Undo, and the pages it read.
        </p>
      </section>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <p className={styles.note}>
        A model or effort you change applies from the next task, as each task starts a Claude of its
        own.
      </p>
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
