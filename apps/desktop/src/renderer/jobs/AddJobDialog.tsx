import { EXTENSION_URL, type JobStatus, type KindName } from '@factwright/core';
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

/**
 * Adds a job the user found on their own. Only the company is needed. A user who wants more than
 * one kind of job puts it under one.
 */
export function AddJobDialog({
  api,
  kinds = [],
  kind: startingKind = null,
  onAdded,
  onClose,
}: {
  api: FactwrightApi;
  /** The kinds of job the user wants, when there's more than one. */
  kinds?: readonly KindName[];
  /** The kind of job it starts under, by id: the one the list shows, if it shows one. */
  kind?: string | null;
  /** Called with the new job's ID, status and kind, so it can be shown. */
  onAdded: (jobId: string, status: JobStatus, kind: string | null) => void;
  onClose: () => void;
}) {
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [link, setLink] = useState('');
  const [pay, setPay] = useState('');
  const [status, setStatus] = useState<JobStatus>('new');
  const hasKinds = kinds.length > 1;
  // None picked leaves it for its fit check to say, as for a job a search found without one.
  const [kind, setKind] = useState(
    kinds.some((each) => each.id === startingKind) ? (startingKind ?? '') : '',
  );
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const add = async (event: FormEvent, close: () => void) => {
    event.preventDefault();
    setSaving(true);
    const result = await api.addJob({
      company,
      role,
      link,
      pay,
      status,
      notes,
      ...(hasKinds && kind && { kind }),
    });
    setSaving(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    onAdded(result.jobId, status, (hasKinds && kind) || null);
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
          <Field label="Role" className={hasKinds ? undefined : styles.wide}>
            {(control) => (
              <Input
                {...control}
                maxLength={LIMITS.role}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              />
            )}
          </Field>
          {hasKinds && (
            <Field label="Kind of job">
              {(control) => (
                <Select {...control} value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="">Let its fit check decide</option>
                  {kinds.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
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
          <p className={`${styles.hint} ${styles.wide}`}>
            Found it in your browser?{' '}
            <a className={styles.link} href={EXTENSION_URL} target="_blank" rel="noreferrer">
              Save to Factwright
            </a>
            , our extension for Chrome and Firefox, saves a job from its page, with its posting.
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
