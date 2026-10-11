import { Button } from '@factwright/ui';
import type { ReactNode } from 'react';
import type { SetupCheck } from '../shared/api.ts';
import styles from './ClaudeCard.module.css';
import { planName } from './plan.ts';
import type { ClaudeStatusView } from './useClaudeStatus.ts';

const INSTALL_URL = 'https://code.claude.com/docs/en/setup';

interface CardView {
  tone: 'ok' | 'need' | 'bad' | 'checking';
  line: string;
  help?: ReactNode;
  /** What Check again checks: Claude Code itself, or Factwright's setup with it. */
  recheck: 'status' | 'setup' | null;
}

/** How each status reads, in plain words, with the fix when there is one. */
function describe(status: ClaudeStatusView, setup: SetupCheck | null): CardView {
  if (status === 'checking') return { tone: 'checking', line: 'Checking…', recheck: null };
  switch (status.state) {
    case 'ready': {
      const plan = planName(status.plan);
      // Only a check of the version installed now counts. An older one ran before an update.
      if (setup?.result === 'failed' && setup.version === status.version) {
        return {
          tone: 'bad',
          line: 'Setup check failed',
          help: `${setup.problem ?? ''} Factwright may need an update to work with Claude Code ${status.version}.`.trim(),
          recheck: 'setup',
        };
      }
      return {
        tone: 'ok',
        line: plan ? `Signed in · ${plan}` : 'Signed in',
        help: 'Factwright never sees your login.',
        recheck: null,
      };
    }
    case 'signed-out':
      return {
        tone: 'need',
        line: 'Not signed in',
        help: (
          <>
            In Terminal, run <code>claude auth login</code>, then come back.
          </>
        ),
        recheck: 'status',
      };
    case 'too-old':
      return {
        tone: 'need',
        line: 'Needs an update',
        help: (
          <>
            Version {status.version} is older than Factwright needs. In Terminal, run{' '}
            <code>claude update</code>.
          </>
        ),
        recheck: 'status',
      };
    case 'missing':
      return {
        tone: 'need',
        line: 'Claude Code isn’t installed',
        help: (
          <>
            Factwright works with your own Claude Code.{' '}
            <a href={INSTALL_URL} target="_blank" rel="noreferrer">
              How to install it
            </a>
          </>
        ),
        recheck: 'status',
      };
    case 'unknown':
      return {
        tone: 'bad',
        line: 'Couldn’t check Claude Code',
        help: 'Make sure it opens in Terminal, then check again.',
        recheck: 'status',
      };
  }
}

/**
 * The user's own Claude Code: whether it's ready, and what to do when it isn't, including when
 * Factwright's setup stops working with a new version of it.
 */
export function ClaudeCard({
  status,
  onRecheck,
  setup = null,
  checkingSetup = false,
  onCheckSetup,
}: {
  status: ClaudeStatusView;
  onRecheck: () => void;
  setup?: SetupCheck | null;
  checkingSetup?: boolean;
  onCheckSetup?: () => void;
}) {
  const view = describe(status, setup);
  return (
    <section className={styles.card} aria-labelledby="claude-card-title">
      <h2 id="claude-card-title" className={styles.title}>
        <span className={`${styles.dot} ${styles[view.tone]}`} aria-hidden="true" />
        Your Claude
      </h2>
      <p className={styles.line} aria-live="polite">
        {view.line}
      </p>
      {view.help && <p className={styles.help}>{view.help}</p>}
      {view.recheck && (
        <Button
          className={styles.recheck}
          size="sm"
          disabled={view.recheck === 'setup' && checkingSetup}
          onClick={view.recheck === 'setup' ? onCheckSetup : onRecheck}
        >
          {view.recheck === 'setup' && checkingSetup ? 'Checking…' : 'Check again'}
        </Button>
      )}
    </section>
  );
}
