import type { JobStatus } from '@factwright/core';
import {
  Button,
  Dialog,
  DialogActions,
  Field,
  Input,
  JOB_STATUS_DISPLAY,
  Select,
  TextArea,
} from '@factwright/ui';
import { type FormEvent, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { LIMITS } from '../../shared/limits.ts';
import styles from './AddJobDialog.module.css';

/** The statuses a job added by hand can start at. */
const STARTING: readonly JobStatus[] = ['new', 'review', 'apply', 'applied', 'screen', 'interview'];

/** Adds a job the user found on their own. Only the company is needed. */
export function AddJobDialog({
  api,
  onAdded,
  onClose,
}: {
  api: FactwrightApi;
  /** Called with the new job's ID and status, so it can be shown. */
  onAdded: (jobId: string, status: JobStatus) => void;
  onClose: () => void;
}) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [link, setLink] = useState('');
  const [pay, setPay] = useState('');
  const [status, setStatus] = useState<JobStatus>('new');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    setSaving(true);
    const result = await api.addJob({ company, role, link, pay, status, notes });
    setSaving(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    onAdded(result.jobId, status);
    close();
  };

  return (
    <Dialog
      title="Add a job"
      description="For a job you found yourself. Your Claude can check it later."
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={(event) => add(event, close)}>
          <Field label="Company" className={styles.wide}>
            {(control) => (
              <Input
                {...control}
                data-autofocus
                required
                maxLength={LIMITS.company}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            )}
          </Field>
          <Field label="Role" className={styles.wide}>
            {(control) => (
              <Input
                {...control}
                maxLength={LIMITS.role}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            )}
          </Field>
          <Field label="Link to the posting" className={styles.wide}>
            {(control) => (
              <Input
                {...control}
                type="url"
                placeholder="https://"
                maxLength={LIMITS.link}
                value={link}
                onChange={(event) => setLink(event.target.value)}
              />
            )}
          </Field>
          <Field label="Pay, if it’s listed">
            {(control) => (
              <Input
                {...control}
                placeholder="$150k–$180k"
                maxLength={LIMITS.pay}
                value={pay}
                onChange={(event) => setPay(event.target.value)}
              />
            )}
          </Field>
          <Field label="Status">
            {(control) => (
              <Select
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value as JobStatus)}
              >
                {STARTING.map((each) => (
                  <option key={each} value={each}>
                    {JOB_STATUS_DISPLAY[each].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes" className={styles.wide}>
            {(control) => (
              <TextArea
                {...control}
                rows={3}
                maxLength={LIMITS.notes}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            )}
          </Field>
          <p className={`${styles.hint} ${styles.wide}`}>
            Only the company is needed. Pick Applied if you’ve already sent your application.
          </p>
          {problem && (
            <p className={`${styles.problem} ${styles.wide}`} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.wide}>
            <DialogActions>
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={saving}>
                Add job
              </Button>
            </DialogActions>
          </div>
        </form>
      )}
    </Dialog>
  );
}
