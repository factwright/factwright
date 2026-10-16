import { type ComponentProps, lazy, Suspense } from 'react';
import type { XRayDialog } from './XRayDialog.tsx';

const Dialog = lazy(async () => ({ default: (await import('./XRayDialog.tsx')).XRayDialog }));

/**
 * A resume's ATS X-ray. Its code, and pdf.js, load only when one opens, so they never slow the
 * app's start.
 */
export function OpenXRay(props: ComponentProps<typeof XRayDialog>) {
  return (
    <Suspense fallback={null}>
      <Dialog {...props} />
    </Suspense>
  );
}
