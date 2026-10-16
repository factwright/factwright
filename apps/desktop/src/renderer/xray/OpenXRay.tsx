import { Button, Dialog, DialogActions } from '@factwright/ui';
import { Component, type ComponentProps, lazy, type ReactNode, Suspense } from 'react';
import type { XRayDialog } from './XRayDialog.tsx';

const LazyXRay = lazy(async () => ({ default: (await import('./XRayDialog.tsx')).XRayDialog }));

/**
 * Keeps an X-ray that fails to show from taking the window with it: it reads the user's files,
 * which anything on their computer can change, so it says so and closes instead.
 */
class Contained extends Component<
  { onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Dialog title="ATS X-ray" onClose={this.props.onClose}>
        {(close) => (
          <>
            <p>The X-ray couldn’t be shown. Close it and open it again.</p>
            <DialogActions>
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    );
  }
}

/**
 * A resume's ATS X-ray. Its code, and pdf.js, load only when one opens, so they never slow the
 * app's start.
 */
export function OpenXRay(props: ComponentProps<typeof XRayDialog>) {
  return (
    <Contained onClose={props.onClose}>
      <Suspense fallback={null}>
        <LazyXRay {...props} />
      </Suspense>
    </Contained>
  );
}
