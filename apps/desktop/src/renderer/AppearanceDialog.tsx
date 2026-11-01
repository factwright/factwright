import {
  Button,
  Dialog,
  DialogActions,
  SYSTEM_THEME,
  THEMES,
  type ThemeChoice,
  VisuallyHidden,
} from '@factwright/ui';
import { Check } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { FactwrightApi } from '../shared/api.ts';
import styles from './AppearanceDialog.module.css';
import { showTheme } from './theme.ts';

const CHOICES: readonly { id: ThemeChoice; name: string }[] = [
  { id: SYSTEM_THEME, name: 'System' },
  ...THEMES,
];

/** A tiny window in a theme's own colors, which it gets from data-theme like everything else. */
function Sample({ theme }: { theme: string }) {
  return (
    <span className={styles.sample} data-theme={theme}>
      <span className={styles.sampleBar} />
      <span className={styles.sampleCard}>
        <span className={styles.sampleTitle} />
        <span className={styles.sampleLine} />
        <span className={styles.sampleRow}>
          <span className={styles.sampleButton} />
          <span className={`${styles.sampleDot} ${styles.need}`} />
          <span className={`${styles.sampleDot} ${styles.ok}`} />
        </span>
      </span>
    </span>
  );
}

/**
 * How Factwright looks: following the system's light or dark setting, or a theme of the user's
 * own. A pick shows straight away and is kept, so there's nothing to save. It's only how this
 * computer shows the app, so it doesn't sync.
 */
export function AppearanceDialog({
  api,
  onClose,
}: {
  api: Pick<FactwrightApi, 'theme' | 'setTheme'>;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState<ThemeChoice | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const group = useId();

  useEffect(() => {
    let current = true;
    void api.theme().then((saved) => {
      if (current) setTheme(saved);
    });
    return () => {
      current = false;
    };
  }, [api]);

  const pick = async (next: ThemeChoice) => {
    setTheme(next);
    showTheme(next);
    try {
      await api.setTheme(next);
      setProblem(null);
    } catch {
      setProblem('This theme shows for now, but Factwright couldn’t keep it for next time.');
    }
  };

  return (
    <Dialog
      title="Appearance"
      description="How Factwright looks on this computer. Pick one to see it right away."
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <>
          <fieldset className={styles.themes}>
            <legend>
              <VisuallyHidden>Theme</VisuallyHidden>
            </legend>
            {CHOICES.map(({ id, name }) => (
              <label key={id} className={styles.theme} data-picked={id === theme || undefined}>
                <input
                  className={styles.radio}
                  type="radio"
                  name={group}
                  checked={id === theme}
                  onChange={() => void pick(id)}
                />
                <span className={styles.frame} aria-hidden="true">
                  {id === SYSTEM_THEME ? (
                    <>
                      <Sample theme="light" />
                      <span className={styles.darkHalf}>
                        <Sample theme="dark" />
                      </span>
                    </>
                  ) : (
                    <Sample theme={id} />
                  )}
                </span>
                <span className={styles.name}>
                  {name}
                  {id === theme && <Check size={14} aria-hidden="true" />}
                </span>
              </label>
            ))}
          </fieldset>
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <DialogActions>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
