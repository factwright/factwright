import type { AskingView, RequestView, SyncStatus } from '../../shared/sync.ts';
import { type CardTone, SidebarCard } from '../SidebarCard.tsx';

interface CardView {
  tone: CardTone;
  line: string;
  help?: string;
  action?: string;
  /** Whether the action opens the account's page in the browser, rather than the sync dialog. */
  accountPage?: boolean;
}

/** How sync reads in the sidebar, in plain words, with what to do next. */
function describe(
  status: SyncStatus | 'checking',
  requests: RequestView[],
  asking: AskingView | null,
): CardView {
  if (status === 'checking') return { tone: 'checking', line: 'Checking…' };
  // Another computer offered to approve this one, with the dialog closed: the emoji wait here.
  if (status.state === 'setting-up' && asking?.step === 'check' && !asking.confirmed) {
    return {
      tone: 'need',
      line: 'Check the emoji',
      help: `${asking.approver} offered to approve this computer.`,
      action: 'Show',
    };
  }
  // Another device asking to link comes first: the person is waiting at it.
  const others = requests.filter((request) => !request.elsewhere);
  if (status.state === 'on' && others.length > 0) {
    return {
      tone: 'need',
      line: others.length === 1 ? 'A device wants to link' : 'Devices want to link',
      help:
        others.length === 1
          ? `${others[0]?.device} asked to sync your job hunt.`
          : `${others.length} devices asked to sync your job hunt.`,
      action: 'Review',
    };
  }
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
    case 'no-server':
      return {
        tone: 'off',
        line: 'Not in this copy',
        help: 'This computer syncs through Factwright’s sync, which this copy doesn’t have.',
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
    case 'subscribe':
      return status.waiting
        ? {
            tone: 'need',
            line: 'Waiting for your browser',
            help: 'Once you’ve subscribed, sync sets up by itself.',
            action: 'Show',
          }
        : {
            tone: 'need',
            line: status.again ? 'Subscribe again to sync' : 'Subscribe to sync',
            action: 'Finish setting up',
          };
    case 'paused':
      return status.waiting
        ? {
            tone: 'need',
            line: 'Paused',
            help: 'Waiting for your browser. Once you’ve subscribed, sync picks up by itself.',
            action: 'Show',
          }
        : {
            tone: 'need',
            line: 'Paused',
            help: 'Your subscription ended. Your job hunt here is safe.',
            action: 'Subscribe again…',
          };
    case 'on':
      // Still syncing while Stripe tries the card again, so the card says what to do about it.
      if (status.paymentFailed && (status.activity === 'idle' || status.activity === 'syncing')) {
        return {
          tone: 'need',
          line: 'Card didn’t go through',
          help: 'Update it to keep sync going.',
          action: 'Update card…',
          accountPage: true,
        };
      }
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
  requests = [],
  asking = null,
  onOpen,
  onAccountPage = onOpen,
}: {
  status: SyncStatus | 'checking';
  /** Other devices asking to link, which this computer can approve. */
  requests?: RequestView[];
  /** This computer, asking to be linked. */
  asking?: AskingView | null;
  onOpen: () => void;
  /** Opens the account's page in the browser, where a card that didn't go through is updated. */
  onAccountPage?: () => void;
}) {
  const view = describe(status, requests, asking);
  return (
    <SidebarCard
      title="Sync"
      tone={view.tone}
      line={view.line}
      help={view.help}
      action={
        view.action
          ? { label: view.action, onClick: view.accountPage ? onAccountPage : onOpen }
          : null
      }
    />
  );
}
