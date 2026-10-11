import { Button } from '@factwright/ui';
import type { ReactNode } from 'react';
import styles from './ClaudeCard.module.css';
import type { ClaudeStatusView } from './useClaudeStatus.ts';

const INSTALL_URL = 'https://code.claude.com/docs/en/setup';

const PLAN_NAMES: Readonly<Record<string, string>> = {
  pro: 'Pro plan',
  max: 'Max plan',
  team: 'Team plan',
  enterprise: 'Enterprise plan',
};

interface CardView {
  tone: 'ok' | 'need' | 'bad' | 'checking';
  line: string;
  help?: ReactNode;
  recheck: boolean;
}

/** How each status reads, in plain words, with the fix when there is one. */
function describe(status: ClaudeStatusView): CardView {
  if (status === 'checking') return { tone: 'checking', line: 'Checking…', recheck: false };
  switch (status.state) {
    case 'ready': {
      const plan = status.plan ? PLAN_NAMES[status.plan] : undefined;
      return {
        tone: 'ok',
        line: plan ? `Signed in · ${plan}` : 'Signed in',
        help: 'Factwright never sees your login.',
        recheck: false,
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
        recheck: true,
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
        recheck: true,
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
        recheck: true,
      };
    case 'unknown':
      return {
        tone: 'bad',
        line: 'Couldn’t check Claude Code',
        help: 'Make sure it opens in Terminal, then check again.',
        recheck: true,
      };
  }
}

/** The user's own Claude Code: whether it's ready, and what to do when it isn't. */
export function ClaudeCard({
  status,
  onRecheck,
}: {
  status: ClaudeStatusView;
  onRecheck: () => void;
}) {
  const view = describe(status);
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
        <Button className={styles.recheck} size="sm" onClick={onRecheck}>
          Check again
        </Button>
      )}
    </section>
  );
}
