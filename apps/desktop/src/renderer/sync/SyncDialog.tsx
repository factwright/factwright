import { Dialog } from '@factwright/ui';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { ApprovalsView, SyncStatus } from '../../shared/sync.ts';
import { LinkStep } from './LinkStep.tsx';
import { ManageSync } from './ManageSync.tsx';
import { RecoveryKeyStep } from './RecoveryKeyStep.tsx';
import { SignInStep } from './SignInStep.tsx';

/** The dialog's title and line for each step. */
function heading(status: SyncStatus, connecting: boolean): { title: string; description?: string } {
  switch (status.state) {
    case 'off':
      return connecting
        ? { title: 'Connect your own server' }
        : {
            title: 'Sync your job hunt',
            description: 'Your other computers and your phone, kept up to date.',
          };
    case 'unavailable':
      return { title: 'Sync can’t turn on here' };
    case 'no-server':
      return { title: 'Factwright’s sync isn’t in this copy' };
    case 'signing-in':
      return { title: 'Sign in with your browser' };
    case 'signed-out':
      return { title: 'Sign in to sync again' };
    case 'setting-up':
      return status.firstDevice
        ? {
            title: status.again === 'remade' ? 'Save a new recovery key' : 'Save your recovery key',
            description: `Signed in as ${status.email}.`,
          }
        : {
            title: status.again === 'changed' ? 'Link this computer again' : 'Link this computer',
            description: `Signed in as ${status.email}.`,
          };
    case 'on':
      return {
        title: 'Sync',
        description: status.email ? `Signed in as ${status.email}.` : undefined,
      };
  }
}

/**
 * Sync, from turning it on to managing it: choosing Factwright's own sync or a server of your own,
 * signing in through the browser, saving the recovery key on the first device, linking the others,
 * and, once it's on, the account's devices.
 */
export function SyncDialog({
  api,
  status,
  approvals,
  onClose,
}: {
  api: FactwrightApi;
  status: SyncStatus;
  /** Linking devices by approval: this computer asking, or other devices' requests. */
  approvals: ApprovalsView;
  onClose: () => void;
}) {
  // Connecting a server of your own, from the first screen. A sign-in to it that doesn't finish
  // comes back to it, and one that does is done with it.
  const [connecting, setConnecting] = useState(false);
  const signedIn = status.state === 'setting-up' || status.state === 'on';
  useEffect(() => {
    if (signedIn) setConnecting(false);
  }, [signedIn]);
  const { title, description } = heading(status, connecting);
  return (
    <Dialog title={title} {...(description && { description })} onClose={onClose}>
      {(close) => {
        switch (status.state) {
          case 'setting-up':
            return status.firstDevice ? (
              <RecoveryKeyStep
                api={api}
                email={status.email}
                {...(status.again && { again: status.again })}
              />
            ) : (
              <LinkStep
                api={api}
                again={status.again}
                canApprove={approvals.supported}
                asking={approvals.asking}
              />
            );
          case 'on':
            return <ManageSync api={api} status={status} approvals={approvals} close={close} />;
          default:
            return (
              <SignInStep
                api={api}
                status={status}
                connecting={connecting}
                onConnecting={setConnecting}
                close={close}
              />
            );
        }
      }}
    </Dialog>
  );
}
