import { Dialog } from '@factwright/ui';
import type { FactwrightApi } from '../../shared/api.ts';
import type { SyncStatus } from '../../shared/sync.ts';
import { LinkStep } from './LinkStep.tsx';
import { ManageSync } from './ManageSync.tsx';
import { RecoveryKeyStep } from './RecoveryKeyStep.tsx';
import { SignInStep } from './SignInStep.tsx';

/** The dialog's title and line for each step. */
function heading(status: SyncStatus): { title: string; description?: string } {
  switch (status.state) {
    case 'off':
      return {
        title: 'Sync your job hunt',
        description: 'Your other computers and your phone, kept up to date.',
      };
    case 'unavailable':
      return { title: 'Sync can’t turn on here' };
    case 'signing-in':
      return { title: 'Sign in with your browser' };
    case 'signed-out':
      return { title: 'Sign in to sync again' };
    case 'setting-up':
      return status.firstDevice
        ? {
            title: status.again ? 'Save a new recovery key' : 'Save your recovery key',
            description: `Signed in as ${status.email}.`,
          }
        : { title: 'Link this computer', description: `Signed in as ${status.email}.` };
    case 'on':
      return {
        title: 'Sync',
        description: status.email ? `Signed in as ${status.email}.` : undefined,
      };
  }
}

/**
 * Sync, from turning it on to managing it: signing in through the browser, saving the recovery
 * key on the first device, linking the others, and, once it's on, the account's devices.
 */
export function SyncDialog({
  api,
  status,
  onClose,
}: {
  api: FactwrightApi;
  status: SyncStatus;
  onClose: () => void;
}) {
  const { title, description } = heading(status);
  return (
    <Dialog title={title} {...(description && { description })} onClose={onClose}>
      {(close) => {
        switch (status.state) {
          case 'setting-up':
            return status.firstDevice ? (
              <RecoveryKeyStep api={api} email={status.email} again={status.again ?? false} />
            ) : (
              <LinkStep api={api} />
            );
          case 'on':
            return <ManageSync api={api} status={status} close={close} />;
          default:
            return <SignInStep api={api} status={status} close={close} />;
        }
      }}
    </Dialog>
  );
}
