import { Button, Checkbox, Dialog, DialogActions, Field, Select } from '@factwright/ui';
import { useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
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
  { task: 'job-search', label: 'Find jobs' },
];

type SettingsApi = Pick<
  FactwrightApi,
  'claudeModels' | 'setClaudeModels' | 'claudePermissions' | 'setClaudePermissions'
>;

/**
 * How Claude works on the job hunt: which model it runs on, for everything and for each task,
 * and what it may do without asking. Each choice saves as it's made.
 */
export function ClaudeSettingsDialog({ api, onClose }: { api: SettingsApi; onClose: () => void }) {
  const [models, setModels] = useState<ModelChoices | null>(null);
  const [permissions, setPermissions] = useState<ClaudePermissions | null>(null);
  const [byTask, setByTask] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const modelsHeading = useId();
  const askingHeading = useId();
  const filesHint = useId();
  const sitesHint = useId();

  useEffect(() => {
    void Promise.all([api.claudeModels(), api.claudePermissions()]).then(([chosen, allowed]) => {
      setModels(chosen);
      setPermissions(allowed);
      setByTask(Object.keys(chosen.tasks).length > 0);
    });
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

  /** A task's own model, or none to use the one for everything. */
  const chooseFor = (current: ModelChoices, task: ModelTask, model: Model | '') => {
    const tasks = Object.fromEntries(
      Object.entries(current.tasks).filter(([each]) => each !== task),
    ) as ModelChoices['tasks'];
    void changeModels({ ...current, tasks: model ? { ...tasks, [task]: model } : tasks });
  };

  const options = MODELS.map((model) => (
    <option key={model} value={model}>
      {MODEL_NAMES[model]}
    </option>
  ));

  return (
    <Dialog title="Claude settings" onClose={onClose}>
      {models && (
        <section aria-labelledby={modelsHeading}>
          <h3 id={modelsHeading} className={styles.heading}>
            Model
          </h3>
          <p className={styles.lead}>
            Opus is the most careful, and uses the most of your plan. Sonnet is quicker, and Haiku
            is the quickest. Each means the newest model of its kind.
          </p>
          <Field label="For everything" className={styles.field}>
            {(control) => (
              <Select
                {...control}
                value={models.main}
                onChange={(event) =>
                  void changeModels({ ...models, main: event.target.value as Model })
                }
              >
                {options}
              </Select>
            )}
          </Field>
          <details
            className={styles.byTask}
            open={byTask}
            onToggle={(event) => setByTask(event.currentTarget.open)}
          >
            <summary>Choose by task</summary>
            <div className={styles.tasks}>
              {TASKS.map(({ task, label }) => (
                <Field key={task} label={label}>
                  {(control) => (
                    <Select
                      {...control}
                      value={models.tasks[task] ?? ''}
                      onChange={(event) =>
                        chooseFor(models, task, event.target.value as Model | '')
                      }
                    >
                      <option value="">Same as everything ({MODEL_NAMES[models.main]})</option>
                      {options}
                    </Select>
                  )}
                </Field>
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
        Changes apply the next time Claude starts, or when it starts a task on another model.
      </p>
      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
