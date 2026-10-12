import type { SyncStatus } from '../../shared/sync.ts';
import { type CardTone, SidebarCard } from '../SidebarCard.tsx';

interface CardView {
  tone: CardTone;
  line: string;
  help?: string;
  action?: string;
}

/** How sync reads in the sidebar, in plain words, with what to do next. */
function describe(status: SyncStatus | 'checking'): CardView {
  if (status === 'checking') return { tone: 'checking', line: 'Checking…' };
  switch (status.state) {
    case 'off':
      return {
        tone: 'off',
        line: 'Off',
        help: 'See your job hunt on your other computers and your phone.',
        action: 'Turn on…',
      };
    case 'unavailable':
      return {
        tone: 'off',
        line: 'Can’t turn on here',
        help: 'Sync needs this computer’s keychain, which isn’t available.',
      };
    case 'signing-in':
      return {
        tone: 'need',
        line: 'Finish signing in',
        help: `In your browser, check the code is ${status.code}.`,
        action: 'Show',
      };
    case 'setting-up':
      return {
        tone: 'need',
        line: status.firstDevice ? 'Save your recovery key' : 'Link this computer',
        action: 'Finish setting up',
      };
    case 'signed-out':
      return {
        tone: 'need',
        line: 'Sign in again',
        help: 'This computer was signed out of sync. Your job hunt here is safe.',
        action: 'Sign in…',
      };
    case 'on':
      switch (status.activity) {
        case 'syncing':
          return { tone: 'checking', line: 'Syncing…', action: 'Manage' };
        case 'idle':
          return { tone: 'ok', line: 'Up to date', action: 'Manage' };
        case 'offline':
          return {
            tone: 'need',
            line: 'Offline',
            help: status.message ?? undefined,
            action: 'Manage',
          };
        case 'problem':
          return {
            tone: 'bad',
            line: 'Not syncing',
            help: status.message ?? undefined,
            action: 'Manage',
          };
      }
  }
}

/** Sync's card in the sidebar: whether it's on and up to date, and a way to set it up or manage it. */
export function SyncCard({
  status,
  onOpen,
}: {
  status: SyncStatus | 'checking';
  onOpen: () => void;
}) {
  const view = describe(status);
  return (
    <SidebarCard
      title="Sync"
      tone={view.tone}
      line={view.line}
      help={view.help}
      action={view.action ? { label: view.action, onClick: onOpen } : null}
    />
  );
}
