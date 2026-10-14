import { Button, Dialog, Input } from '@factwright/ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { EditResult, FactwrightApi } from '../../shared/api.ts';
import { PROFILE_NAME_LIMIT, type ProfileEntry, parseProfileName } from '../../shared/profiles.ts';
import { NotPrivate } from './AddProfileDialog.tsx';
import { ProfileAvatar } from './ProfileAvatar.tsx';
import styles from './Profiles.module.css';

/** A change's answer, or what to say when it never came, so the dialog never waits for good. */
const settled = (answer: Promise<EditResult>, message: string): Promise<EditResult> =>
  answer.catch(() => ({ ok: false, message: `${message} Try again.` }));

/**
 * Renames profiles, and removes the ones that aren't open. A profile removed goes to the trash
 * with its whole job hunt on this computer, where it can be restored. The first profile's folder
 * holds the others, so it stays.
 */
export function ManageProfilesDialog({
  api,
  profiles,
  onChanged,
  onClose,
}: {
  api: Pick<FactwrightApi, 'renameProfile' | 'removeProfile'>;
  profiles: ProfileEntry[];
  /** After a profile is renamed or removed, to read them again. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const confirmText = useId();
  // Where focus goes once the row it was on changes, so the keyboard never loses its place.
  const [focusOn, setFocusOn] = useState<string | null>(null);

  // Renaming starts with the name chosen, to type over or change.
  useEffect(() => {
    if (!renaming) return;
    nameBox.current?.focus();
    nameBox.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (focusOn === null) return;
    const target =
      list.current?.querySelector<HTMLElement>(focusOn) ??
      list.current?.querySelector<HTMLElement>('button');
    target?.focus();
    setFocusOn(null);
  }, [focusOn]);

  const stopRenaming = (profile: ProfileEntry) => {
    setRenaming(null);
    setFocusOn(`[data-rename="${profile.id}"]`);
  };

  const rename = async (event: FormEvent, profile: ProfileEntry) => {
    event.preventDefault();
    const name = parseProfileName(draft);
    if (!name) {
      setProblem('Give it a name of 40 characters or fewer.');
      return;
    }
    setSaving(true);
    const result =
      name === profile.name
        ? { ok: true as const }
        : await settled(api.renameProfile(profile.id, name), 'The new name couldn’t be saved.');
    setSaving(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    stopRenaming(profile);
    setProblem(null);
    onChanged();
  };

  const remove = async (profile: ProfileEntry) => {
    setSaving(true);
    const result = await settled(
      api.removeProfile(profile.id),
      'That profile couldn’t be removed.',
    );
    setSaving(false);
    setRemoving(null);
    setFocusOn('button');
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setProblem(null);
    onChanged();
  };

  return (
    <Dialog
      title="Manage profiles"
      description="Each profile is its own job hunt, with its own sync and Claude. One is open at a time."
      onClose={onClose}
    >
      <div className={styles.form}>
        <ul ref={list} className={styles.rows} aria-label="Profiles">
          {profiles.map((profile) => (
            <li key={profile.id} className={styles.row}>
              <ProfileAvatar id={profile.id} name={profile.name} />
              {renaming === profile.id ? (
                <form className={styles.renaming} onSubmit={(event) => rename(event, profile)}>
                  <Input
                    ref={nameBox}
                    aria-label={`New name for ${profile.name}`}
                    required
                    maxLength={PROFILE_NAME_LIMIT}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setProblem(null);
                    }}
                    onKeyDown={(event) => {
                      // Escape stops renaming, rather than closing the dialog.
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        stopRenaming(profile);
                        setProblem(null);
                      }
                    }}
                  />
                  <Button size="sm" variant="primary" type="submit" disabled={saving}>
                    Save
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => stopRenaming(profile)}>
                    Cancel
                  </Button>
                </form>
              ) : removing === profile.id ? (
                // biome-ignore lint/a11y/useSemanticElements: a group of two buttons, not a form.
                <div
                  className={styles.confirm}
                  role="group"
                  aria-label={`Remove ${profile.name}?`}
                  aria-describedby={confirmText}
                >
                  <p id={confirmText} className={styles.confirmText}>
                    Remove {profile.name}? Its job hunt on this computer goes to the trash, where it
                    can be restored. What it synced stays in its sync account.
                  </p>
                  <div className={styles.confirmButtons}>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={saving}
                      onClick={() => void remove(profile)}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      data-keep={profile.id}
                      onClick={() => {
                        setRemoving(null);
                        setFocusOn(`[data-remove="${profile.id}"]`);
                      }}
                    >
                      Keep it
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className={styles.rowName}>{profile.name}</span>
                  {profile.open && <span className={styles.openNow}>Open now</span>}
                  <span className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="quiet"
                      aria-label={`Rename ${profile.name}`}
                      data-rename={profile.id}
                      onClick={() => {
                        setRemoving(null);
                        setProblem(null);
                        setDraft(profile.name);
                        setRenaming(profile.id);
                      }}
                    >
                      Rename
                    </Button>
                    {!profile.first && !profile.open && (
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label={`Remove ${profile.name}`}
                        data-remove={profile.id}
                        onClick={() => {
                          setRenaming(null);
                          setProblem(null);
                          setRemoving(profile.id);
                          // The safe answer first.
                          setFocusOn(`[data-keep="${profile.id}"]`);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {problem && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}
        <p className={styles.hint}>
          The first profile stays, as it holds the others. To remove the profile that’s open, open
          another one first.
        </p>
        <NotPrivate />
      </div>
    </Dialog>
  );
}
