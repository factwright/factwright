import { Button, Checkbox, Dialog, DialogActions, Select } from '@factwright/ui';
import { Fragment, useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import {
  EFFORT_NAMES,
  EFFORTS,
  type Effort,
  type EffortChoices,
  effortWithout,
} from '../shared/effort.ts';
import {
  MODEL_NAMES,
  MODELS,
  type Model,
  type ModelChoices,
  type ModelTask,
} from '../shared/models.ts';
import type { ClaudePermissions } from '../shared/permissions.ts';
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
];

/**
 * Tasks that do well on Sonnet, which uses less of a plan than Opus: checks and searches, where
 * the fact-checked writing isn't. Pro plans have the tightest limits.
 */
const ROUTINE: readonly ModelTask[] = ['fit-check', 'salary-check', 'job-search', 'who-to-message'];

type SettingsApi = Pick<
  FactwrightApi,
  | 'claudeModels'
  | 'setClaudeModels'
  | 'claudeEffort'
  | 'setClaudeEffort'
  | 'claudePermissions'
  | 'setClaudePermissions'
>;

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
 * everything and for each task, and what it may do without asking. Each choice saves as it's
 * made.
 */
export function ClaudeSettingsDialog({
  api,
  onClose,
  plan,
}: {
  api: SettingsApi;
  onClose: () => void;
  /** The user's Claude plan, such as "pro", when Claude Code says. */
  plan?: string | undefined;
}) {
  const [models, setModels] = useState<ModelChoices | null>(null);
  const [effort, setEffort] = useState<EffortChoices | null>(null);
  const [permissions, setPermissions] = useState<ClaudePermissions | null>(null);
  const [byTask, setByTask] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const modelsHeading = useId();
  const askingHeading = useId();
  const filesHint = useId();
  const sitesHint = useId();

  useEffect(() => {
    void Promise.all([api.claudeModels(), api.claudeEffort(), api.claudePermissions()]).then(
      ([chosen, levels, allowed]) => {
        setModels(chosen);
        setEffort(levels);
        setPermissions(allowed);
        setByTask(Object.keys({ ...chosen.tasks, ...levels.tasks }).length > 0);
      },
    );
  }, [api]);

  const failed = () => setProblem('That didn’t save. Try again.');

  const changeModels = async (next: ModelChoices) => {
    setModels(next);
    try {
      setModels(await api.setClaudeModels(next));
      setProblem(null);
    } catch {
      failed();
      setModels(await api.claudeModels());
    }
  };

  const changeEffort = async (next: EffortChoices) => {
    setEffort(next);
    try {
      setEffort(await api.setClaudeEffort(next));
      setProblem(null);
    } catch {
      failed();
      setEffort(await api.claudeEffort());
    }
  };

  const changePermissions = async (next: ClaudePermissions) => {
    setPermissions(next);
    try {
      setPermissions(await api.setClaudePermissions(next));
      setProblem(null);
    } catch {
      failed();
      setPermissions(await api.claudePermissions());
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
          {plan === 'pro' &&
            ROUTINE.some((task) => (models.tasks[task] ?? models.main) === 'opus') && (
              <div className={styles.pro}>
                <p className={styles.lead}>
                  <strong>On a Pro plan,</strong> limits are tighter. Running fit checks, salary
                  checks, job searches and who to message on Sonnet uses less of your plan, while
                  tailored resumes and getting started keep Opus.
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setByTask(true);
                    void changeModels({
                      ...models,
                      tasks: {
                        ...models.tasks,
                        ...Object.fromEntries(ROUTINE.map((task) => [task, 'sonnet'])),
                      },
                    });
                  }}
                >
                  Use Sonnet for those
                </Button>
              </div>
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
              value={models.main}
              onChange={(event) =>
                void changeModels({ ...models, main: event.target.value as Model })
              }
            >
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
                    <option value="">Same as everything ({MODEL_NAMES[models.main]})</option>
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
                      {`${effort.main ? 'Same as everything' : 'Recommended'} (${EFFORT_NAMES[effortWithout(effort, task, plan)]})`}
                    </option>
                    {levels}
                  </Select>
                </Fragment>
              ))}
            </div>
          </details>
        </section>
      )}
      {permissions && (
        <section aria-labelledby={askingHeading} className={styles.section}>
          <h3 id={askingHeading} className={styles.heading}>
            Without asking
          </h3>
          <p className={styles.lead}>
            Claude works only in your job hunt, and can’t run programs on your computer. It always
            searches the web, reads postings on Greenhouse, Lever, Ashby and Gem, and saves its work
            in your jobs’ folders, job searches and outreach drafts without asking.
          </p>
          <div className={styles.options}>
            <div>
              <Checkbox
                label="Change any file in your job hunt"
                checked={permissions.anyFile}
                aria-describedby={filesHint}
                onChange={(event) =>
                  void changePermissions({ ...permissions, anyFile: event.target.checked })
                }
              />
              <p id={filesHint} className={styles.hint}>
                Including your facts, guide and base resumes, which every resume and answer is built
                from. When this is off, Claude asks before changing them.
              </p>
            </div>
            <div>
              <Checkbox
                label="Read any website"
                checked={permissions.anySite}
                aria-describedby={sitesHint}
                onChange={(event) =>
                  void changePermissions({ ...permissions, anySite: event.target.checked })
                }
              />
              <p id={sitesHint} className={styles.hint}>
                When this is off, Claude asks before reading other sites, such as a company’s
                careers page. A job post could try to trick Claude into sending your details to a
                site, and asking lets you catch it.
              </p>
            </div>
          </div>
        </section>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      <p className={styles.note}>
        Changes apply the next time Claude starts, or when a task needs another model or more effort
        than Claude is open with.
      </p>
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
