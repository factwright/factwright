import { type ReactNode, useState } from 'react';
import type { EditResult, SetupCheck } from '../shared/api.ts';
import styles from './ClaudeCard.module.css';
import { planName } from './plan.ts';
import { type CardTone, SidebarCard } from './SidebarCard.tsx';
import { type ClaudeStatusView, typedClaude } from './useClaudeStatus.ts';

const INSTALL_URL = 'https://code.claude.com/docs/en/setup';

/** Copies text to the clipboard, saying when it couldn't. */
type Copy = (text: string) => Promise<EditResult>;

/**
 * Copies a command the user runs in their terminal, read as a link in the card's help. Each
 * command gets its own, keyed by the command, so a new one never shows as copied.
 */
function CopyCommand({ command, copy }: { command: string; copy: Copy | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!copy) return null;
  return (
    <>
      {' '}
      <button
        type="button"
        className={styles.link}
        onClick={() =>
          void copy(command).then((result) => {
            if (result.ok) setCopied(true);
          })
        }
      >
        {copied ? 'Copied' : 'Copy the command'}
      </button>
    </>
  );
}

interface CardView {
  tone: CardTone;
  line: string;
  help?: ReactNode;
  /** What Check again checks: Claude Code itself, or Factwright's setup with it. */
  recheck: 'status' | 'setup' | null;
}

/**
 * How each status reads, in plain words, with the fix when there is one. A command that starts
 * Claude Code by its whole path, as one for a terminal that doesn't find `claude` by name, is
 * long to type, so the card offers to copy it.
 */
function describe(
  status: ClaudeStatusView,
  setup: SetupCheck | null,
  { signIn, copy }: { signIn: string | undefined; copy: Copy | undefined },
  terminal: string,
): CardView {
  if (status === 'checking') return { tone: 'checking', line: 'Checking…', recheck: null };
  const claude = typedClaude(status);
  const byPath = claude !== 'claude';
  /** A link that copies a command shown in the card, when it starts Claude Code by its path. */
  const copyLong = (command: string) =>
    byPath && <CopyCommand key={command} command={command} copy={copy} />;
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
            This profile has its own Claude login. In {terminal}, run its sign-in command, then come
            back.
            <CopyCommand key={signIn} command={signIn} copy={copy} />
          </>
        ) : (
          <>
            In {terminal}, run <code>{claude} auth login</code>, then come back.
            {copyLong(`${claude} auth login`)}
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
            Version {status.version} is older than Factwright needs. In {terminal}, run{' '}
            <code>{claude} update</code>.{copyLong(`${claude} update`)}
          </>
        ),
        recheck: 'status',
      };
    case 'missing':
      return {
        tone: 'need',
        line: 'Claude Code isn’t installed',
        help: signIn ? (
          // Signing in as the install guide says would sign in the first profile, not this one.
          <>
            Factwright works with your own Claude Code.{' '}
            <a href={INSTALL_URL} target="_blank" rel="noreferrer">
              How to install it
            </a>
            . Then, in {terminal}, sign in with this profile’s own command, not plain{' '}
            <code>claude</code>.
            <CopyCommand key={signIn} command={signIn} copy={copy} />
          </>
        ) : (
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
        help: byPath ? (
          <>
            Make sure <code>{claude} --version</code> prints its version in {terminal}, then check
            again.{copyLong(`${claude} --version`)}
          </>
        ) : (
          `Make sure it opens in ${terminal}, then check again.`
        ),
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
  copy,
  terminal = 'Terminal',
  setup = null,
  checkingSetup = false,
  onCheckSetup,
  onSettings,
}: {
  status: ClaudeStatusView;
  onRecheck: () => void;
  /** An added profile's own sign-in command, too long for the card, which its help copies. */
  signIn?: string | undefined;
  /** Copies a command that's long to type: that one, or one with Claude Code's whole path. */
  copy?: Copy | undefined;
  /** Where the user runs Claude Code's commands: PowerShell on Windows, Terminal on a Mac. */
  terminal?: string;
  setup?: SetupCheck | null;
  checkingSetup?: boolean;
  onCheckSetup?: () => void;
  /** Opens Claude's settings, once Claude is ready to run. */
  onSettings?: () => void;
}) {
  const view = describe(status, setup, { signIn, copy }, terminal);
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
