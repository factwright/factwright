import { type ReactNode, useState } from 'react';
import type { EditResult, SetupCheck } from '../shared/api.ts';
import styles from './ClaudeCard.module.css';
import { planName } from './plan.ts';
import { type CardTone, SidebarCard } from './SidebarCard.tsx';
import type { ClaudeStatusView } from './useClaudeStatus.ts';

const INSTALL_URL = 'https://code.claude.com/docs/en/setup';

/** An added profile's own Claude sign-in: its command, too long for the card, and copying it. */
export interface OwnSignIn {
  command: string;
  copy: (text: string) => Promise<EditResult>;
}

/** Copies an added profile's sign-in command, read as a link in the card's help. */
function CopySignIn({ signIn }: { signIn: OwnSignIn }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.link}
      onClick={() =>
        void signIn.copy(signIn.command).then((result) => {
          if (result.ok) setCopied(true);
        })
      }
    >
      {copied ? 'Copied' : 'Copy the command'}
    </button>
  );
}

interface CardView {
  tone: CardTone;
  line: string;
  help?: ReactNode;
  /** What Check again checks: Claude Code itself, or Factwright's setup with it. */
  recheck: 'status' | 'setup' | null;
}

/** How each status reads, in plain words, with the fix when there is one. */
function describe(
  status: ClaudeStatusView,
  setup: SetupCheck | null,
  signIn: OwnSignIn | undefined,
): CardView {
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
        help: signIn ? (
          <>
            This profile has its own Claude login. In Terminal, run its sign-in command, then come
            back. <CopySignIn signIn={signIn} />
          </>
        ) : (
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
  signIn,
  setup = null,
  checkingSetup = false,
  onCheckSetup,
  onSettings,
}: {
  status: ClaudeStatusView;
  onRecheck: () => void;
  /** An added profile's own sign-in, which its signed-out help copies. */
  signIn?: OwnSignIn | undefined;
  setup?: SetupCheck | null;
  checkingSetup?: boolean;
  onCheckSetup?: () => void;
  /** Opens Claude's settings, once Claude is ready to run. */
  onSettings?: () => void;
}) {
  const view = describe(status, setup, signIn);
  const checking = view.recheck === 'setup' && checkingSetup;
  const ready = status !== 'checking' && status.state === 'ready' && !view.recheck;
  return (
    <SidebarCard
      title="Your Claude"
      tone={view.tone}
      line={view.line}
      help={view.help}
      action={
        view.recheck
          ? {
              label: checking ? 'Checking…' : 'Check again',
              disabled: checking,
              onClick: () => (view.recheck === 'setup' ? onCheckSetup?.() : onRecheck()),
            }
          : ready && onSettings
            ? { label: 'Settings', onClick: onSettings }
            : null
      }
    />
  );
}
