import { EXTENSION_URL } from '@factwright/core';
import { Button, Dialog, DialogActions, Notice } from '@factwright/ui';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type {
  HelperBrowserView,
  HelperUnavailable,
  SaveHelperView,
  SetUpResult,
} from '../../shared/save-helper.ts';
import styles from './ExtensionDialog.module.css';

/** Why the browsers can't be set up here, in the user's words. */
const UNAVAILABLE: Record<HelperUnavailable, string> = {
  'other-system': 'Saving to this computer works on a Mac and on Windows.',
  development:
    'This copy of Factwright leaves your browsers as they are, as a copy run from the code does.',
  translocated:
    'Move Factwright to your Applications folder, then open it from there. Your browsers can’t reach a copy macOS runs from somewhere temporary.',
  'disk-image':
    'Move Factwright to your Applications folder, then open it from there. Your browsers can’t reach a copy that runs from a disk image.',
  'no-helper':
    'This copy of Factwright is missing the small helper your browsers reach it through. Install it again from factwright.com.',
};

/**
 * The browser extension's window: what Save to Factwright does, where to get it, and saving
 * straight to Factwright on this computer. On a Mac, each browser is set up here, as macOS asks
 * the user first. Nothing touches a browser's folders until they choose Set up.
 */
export function ExtensionDialog({
  api,
  onClose,
}: {
  api: Pick<FactwrightApi, 'saveHelperStatus' | 'setUpSaveHelper' | 'openFilesAndFolders'>;
  onClose: () => void;
}) {
  const [view, setView] = useState<SaveHelperView | null>(null);
  const [problems, setProblems] = useState<SetUpResult['problems']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .saveHelperStatus()
      .then((status) => {
        if (live) setView(status);
      })
      .catch(() => {
        if (live)
          setFailed('Factwright couldn’t look for your browsers. Close this and try again.');
      });
    return () => {
      live = false;
    };
  }, [api]);

  const setUp = async (browser: HelperBrowserView) => {
    setBusy(browser.id);
    setFailed(null);
    try {
      const result = await api.setUpSaveHelper([browser.id]);
      setView(result.view);
      setProblems(result.problems);
    } catch {
      setFailed(`Setting up ${browser.name} didn’t work. Try again.`);
    } finally {
      setBusy(null);
    }
  };

  const blocked = view?.browsers.filter((browser) => browser.state === 'blocked') ?? [];
  // A problem macOS caused shows as its browser's state and the steps below, the rest as said.
  const otherProblems = problems.filter((problem) => !problem.blocked);

  return (
    <Dialog
      title="Save to Factwright"
      description="A browser extension that saves the job you’re looking at, with its posting, to your job hunt."
      onClose={onClose}
    >
      <p className={styles.intro}>
        Get it for Chrome or Firefox on{' '}
        <a className={styles.link} href={EXTENSION_URL} target="_blank" rel="noreferrer">
          Factwright’s extension page
        </a>
        .
      </p>

      <section className={styles.section} aria-labelledby="extension-computer">
        <h3 id="extension-computer" className={styles.heading}>
          Saving to this computer
        </h3>
        {view === null && !failed && <p className={styles.hint}>Looking for your browsers…</p>}
        {view?.unavailable && <p className={styles.hint}>{UNAVAILABLE[view.unavailable]}</p>}
        {view && !view.unavailable && (
          <>
            <p className={styles.intro}>
              Save to Factwright can save straight to Factwright here, with no account and no sync.
              {view.onRequest
                ? ' Each browser finds Factwright through a small file Factwright adds to that browser’s folder. macOS keeps each app’s folder to itself, so it asks you first, once for each browser: choose Allow.'
                : ' Factwright tells each browser where to find it when it starts.'}
            </p>
            {view.browsers.length === 0 ? (
              <p className={styles.hint}>
                Factwright didn’t find a browser Save to Factwright runs in: Chrome, Edge, Brave,
                Arc, Vivaldi or Firefox.
              </p>
            ) : (
              <ul className={styles.browsers} aria-label="Your browsers">
                {view.browsers.map((browser) => (
                  <li key={browser.id} className={styles.browser}>
                    <span className={styles.name}>{browser.name}</span>
                    <BrowserState browser={browser} />
                    {browser.state !== 'ready' && (
                      <span className={styles.action}>
                        <Button
                          size="sm"
                          variant={browser.state === 'not-set-up' ? 'primary' : 'secondary'}
                          disabled={busy !== null}
                          aria-label={`${browser.state === 'not-set-up' ? 'Set up' : 'Try again for'} ${browser.name}`}
                          onClick={() => void setUp(browser)}
                        >
                          {busy === browser.id
                            ? 'Setting up…'
                            : browser.state === 'not-set-up'
                              ? 'Set up'
                              : 'Try again'}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {blocked.length > 0 && (
              <Notice title="To let macOS allow it">
                <ol className={styles.steps}>
                  <li>Open System Settings, then Privacy & Security, then Files & Folders.</li>
                  <li>
                    Under Factwright, turn on {blocked.map((browser) => browser.name).join(' and ')}
                    .
                  </li>
                  <li>Come back here and choose Try again.</li>
                </ol>
                <p className={`${styles.hint} ${styles.open}`}>
                  <button
                    type="button"
                    className={styles.link}
                    onClick={() => void api.openFilesAndFolders()}
                  >
                    Open Files & Folders
                  </button>
                </p>
              </Notice>
            )}
            {otherProblems.map((problem) => (
              <p key={problem.id} className={styles.problem} role="alert">
                {problem.name} couldn’t be set up: {problem.message}
              </p>
            ))}
            <p className={styles.hint}>
              Saving to this computer needs Save to Factwright 0.2 or later.
            </p>
          </>
        )}
        {failed && (
          <p className={styles.problem} role="alert">
            {failed}
          </p>
        )}
      </section>

      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Where a browser stands, in a word or two. */
function BrowserState({ browser }: { browser: HelperBrowserView }) {
  if (browser.state === 'ready') {
    return (
      <span className={`${styles.state} ${styles.ready}`}>
        <Check size={12} aria-hidden="true" />
        Ready
      </span>
    );
  }
  if (browser.state === 'blocked') {
    return <span className={`${styles.state} ${styles.blocked}`}>macOS said no</span>;
  }
  return <span className={`${styles.state} ${styles.waiting}`}>Not set up</span>;
}
