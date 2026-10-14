import { Button } from '@factwright/ui';
import { CircleCheck, Copy, SquareTerminal } from 'lucide-react';
import { useId, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import { planName } from '../plan.ts';
import type { ClaudeStatusView } from '../useClaudeStatus.ts';
import styles from './ClaudeReady.module.css';

const TERMINAL_GUIDE = 'https://code.claude.com/docs/en/terminal-guide';

/** The command to install Claude Code on each system, from Anthropic's setup guide. */
const INSTALL: Readonly<Record<string, string>> = {
  win32: 'irm https://claude.ai/install.ps1 | iex',
  default: 'curl -fsSL https://claude.ai/install.sh | bash',
};

/** A command the user runs themselves, with a button that copies it. */
function Command({
  text,
  api,
  long = false,
}: {
  text: string;
  api: Pick<FactwrightApi, 'copyText'>;
  /** A long command, such as a profile's own sign-in, which gets a line of its own. */
  long?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={long ? `${styles.command} ${styles.long}` : styles.command}>
      <code>{text}</code>
      <Button
        size="sm"
        variant="quiet"
        icon={<Copy size={14} aria-hidden="true" />}
        aria-label={copied ? 'Copied' : `Copy ${text}`}
        onClick={() =>
          void api.copyText(text).then((result) => {
            if (result.ok) setCopied(true);
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}

/**
 * Whether the user's Claude Code is ready, and when it isn't, the steps to fix it, which they
 * take themselves in their own terminal: Factwright never installs Claude Code or signs anyone
 * in. The window checks again whenever the user comes back to it.
 */
export function ClaudeReady({
  status,
  onRecheck,
  api,
  signIn,
}: {
  status: ClaudeStatusView;
  onRecheck: () => void;
  api: Pick<FactwrightApi, 'copyText' | 'openTerminal' | 'platform'>;
  /**
   * An added profile's own sign-in command, with its own Claude Code folder. The first profile
   * signs in as Claude Code always does.
   */
  signIn?: string | undefined;
}) {
  const titleId = useId();
  const terminal = api.platform === 'win32' ? 'PowerShell' : 'Terminal';
  const openTerminal = (
    <Button
      size="sm"
      icon={<SquareTerminal size={14} aria-hidden="true" />}
      onClick={() => void api.openTerminal()}
    >
      Open {terminal}
    </Button>
  );
  const checkAgain = (
    <Button size="sm" onClick={onRecheck}>
      Check again
    </Button>
  );

  if (status === 'checking') {
    return (
      <div className={styles.box} role="status">
        <p className={styles.quiet}>Checking your Claude Code…</p>
      </div>
    );
  }
  if (status.state === 'ready') {
    const plan = planName(status.plan);
    return (
      <div className={`${styles.box} ${styles.ready}`} role="status">
        <CircleCheck className={styles.okIcon} size={18} aria-hidden="true" />
        <p>
          <strong>Your Claude is ready{plan ? ` · ${plan}` : ''}.</strong> Factwright never sees
          your Claude login.
        </p>
      </div>
    );
  }

  const steps =
    status.state === 'missing'
      ? {
          title: 'Install Claude Code',
          lead: 'Factwright works with your own Claude Code. It needs a Claude Pro or Max plan, or a Team, Enterprise or Console account; the free plan doesn’t include it.',
          items: [
            <>
              Open {terminal}. {openTerminal}
            </>,
            <>
              Paste this, then press {api.platform === 'darwin' ? 'Return' : 'Enter'}:{' '}
              <Command text={INSTALL[api.platform] ?? (INSTALL.default as string)} api={api} />
            </>,
            signIn ? (
              <>
                When it’s done, run this, and sign in with this profile’s Claude account in the
                browser it opens: <Command text={signIn} api={api} long />
              </>
            ) : (
              <>
                When it’s done, run <Command text="claude" api={api} /> once, and sign in with your
                Claude account in the browser it opens.
              </>
            ),
            <>Come back here. {checkAgain}</>,
          ],
        }
      : status.state === 'signed-out'
        ? {
            title: 'Sign in to Claude Code',
            lead: signIn
              ? 'This profile has its own Claude login, so it signs in on its own. You sign in yourself, so Factwright never sees your login.'
              : 'Claude Code is installed, but it isn’t signed in. You sign in yourself, so Factwright never sees your login.',
            items: [
              <>
                Open {terminal}. {openTerminal}
              </>,
              signIn ? (
                <>
                  Run this, and sign in with this profile’s Claude account in the browser it opens:{' '}
                  <Command text={signIn} api={api} long />
                </>
              ) : (
                <>
                  Run <Command text="claude auth login" api={api} />, and sign in with your Claude
                  account in the browser it opens.
                </>
              ),
              <>Come back here. {checkAgain}</>,
            ],
          }
        : status.state === 'too-old'
          ? {
              title: 'Update Claude Code',
              lead: `Your Claude Code is version ${status.version}. Factwright needs ${status.minimum} or newer.`,
              items: [
                <>
                  Open {terminal}. {openTerminal}
                </>,
                <>
                  Run <Command text="claude update" api={api} />
                </>,
                <>Come back here. {checkAgain}</>,
              ],
            }
          : {
              title: 'Claude Code didn’t answer',
              lead: 'Factwright couldn’t check your Claude Code.',
              items: [
                <>
                  Open {terminal}. {openTerminal}
                </>,
                <>
                  Run <Command text="claude --version" api={api} />. It should print a version
                  number.
                </>,
                <>Come back here. {checkAgain}</>,
              ],
            };
  return (
    <section className={`${styles.box} ${styles.need}`} aria-labelledby={titleId}>
      <div>
        <h3 id={titleId} className={styles.title}>
          {steps.title}
        </h3>
        <p className={styles.lead}>{steps.lead}</p>
        <ol className={styles.steps}>
          {steps.items.map((item, index) => (
            // The steps are fixed, so their order is their key.
            <li key={index}>{item}</li>
          ))}
        </ol>
        <p className={styles.quiet}>
          New to the terminal?{' '}
          <a href={TERMINAL_GUIDE} target="_blank" rel="noreferrer">
            Anthropic’s guide shows how it works
          </a>
          .
        </p>
      </div>
    </section>
  );
}
