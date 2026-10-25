import { Button, Dialog, DialogActions, Field, Input, Notice } from '@factwright/ui';
import { type FormEvent, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import {
  type AddProfileResult,
  PROFILE_NAME_LIMIT,
  type ProfileEntry,
  parseProfileName,
} from '../../shared/profiles.ts';
import styles from './Profiles.module.css';

/** What every profile on a shared computer should know: they aren't private from each other. */
export function NotPrivate() {
  return (
    <Notice title="Profiles aren’t private" tone="info">
      Anyone who can use this computer’s login can open any profile. To keep a job hunt private,
      give each person their own login on this computer.
    </Notice>
  );
}

/**
 * Adds a profile for someone else, or a fresh start, then opens it, which restarts Factwright.
 * One person after two kinds of job keeps one profile, so it says where those go instead. The
 * first time, it names the profile that's open too, so the two can be told apart.
 */
export function AddProfileDialog({
  api,
  busy,
  firstName,
  onAdded,
  onClose,
}: {
  api: Pick<FactwrightApi, 'addProfile'>;
  /** Whether Claude has work going, which opening the new profile would stop. */
  busy: boolean;
  /**
   * With only one profile so far, the name to suggest for it, such as the person's own from
   * About you. Undefined once profiles have names.
   */
  firstName?: string | undefined;
  /** Called with the new profile, to open it. */
  onAdded: (profile: ProfileEntry) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [own, setOwn] = useState(firstName ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const naming = firstName !== undefined;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const tidy = parseProfileName(name);
    const tidyOwn = naming ? parseProfileName(own) : null;
    if (!tidy || (naming && !tidyOwn)) {
      setProblem('Give each profile a name of 40 characters or fewer.');
      return;
    }
    setSaving(true);
    let result: AddProfileResult;
    try {
      result = tidyOwn ? await api.addProfile(tidy, tidyOwn) : await api.addProfile(tidy);
    } catch {
      result = { ok: false, message: 'The profile couldn’t be added. Try again.' };
    }
    if (!result.ok) {
      setSaving(false);
      setProblem(result.message);
      return;
    }
    onAdded({ id: result.id, name: tidy, open: false, first: false, named: true });
  };

  return (
    <Dialog
      title="Add a profile"
      description="For someone else, or a fresh start. Looking for two kinds of job? Add one in What you want instead."
      onClose={onClose}
    >
      {(close) => (
        <form className={styles.form} onSubmit={add}>
          <Field label={naming ? 'New profile’s name' : 'Name'}>
            {(control) => (
              <Input
                {...control}
                data-autofocus
                required
                maxLength={PROFILE_NAME_LIMIT}
                placeholder="Such as Sam, or Testing"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(null);
                }}
              />
            )}
          </Field>
          {naming && (
            <Field
              label="This profile’s name"
              hint="The one that’s open now, so you can tell the two apart."
            >
              {(control) => (
                <Input
                  {...control}
                  required
                  maxLength={PROFILE_NAME_LIMIT}
                  placeholder="Such as your first name"
                  value={own}
                  onChange={(event) => {
                    setOwn(event.target.value);
                    setProblem(null);
                  }}
                />
              )}
            </Field>
          )}
          <ul className={styles.facts}>
            <li>It starts empty, at Get started.</li>
            <li>
              It signs in to sync and to Claude with its own accounts. Someone else needs a Claude
              plan of their own.
            </li>
            <li>Factwright restarts to open it. Switch back from the top of the sidebar.</li>
          </ul>
          <NotPrivate />
          {busy && (
            <p className={styles.hint}>
              Stop Claude’s run first, as opening the new profile restarts Factwright.
            </p>
          )}
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saving || busy}>
              {saving ? 'Opening…' : 'Add and open'}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
