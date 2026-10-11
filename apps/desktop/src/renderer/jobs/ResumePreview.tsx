import type { JobFile } from '@factwright/core';
import { Button, Dialog, DialogActions } from '@factwright/ui';
import { useEffect, useState } from 'react';
import type { FactwrightApi } from '../../shared/api.ts';
import type { PageImage } from './pdf.ts';
import styles from './ResumePreview.module.css';

/** How wide each page shows, in CSS pixels: the large dialog's width, less its padding. */
const PAGE_WIDTH = 660;

type Preview =
  | { step: 'drawing' }
  | { step: 'ready'; pages: PageImage[] }
  | { step: 'failed'; message: string };

/**
 * A resume PDF's pages, drawn in the app, so the user sees exactly what an employer will. It
 * can open the PDF in the user's own PDF app too.
 */
export function ResumePreview({
  file,
  api,
  onClose,
}: {
  file: JobFile;
  api: FactwrightApi;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview>({ step: 'drawing' });

  useEffect(() => {
    let live = true;
    (async () => {
      const read = await api.readPdf(file.path);
      if (!read.ok) return { step: 'failed', message: read.message } as const;
      const { drawPages } = await import('./pdf.ts');
      return { step: 'ready', pages: await drawPages(read.data, PAGE_WIDTH) } as const;
    })().then(
      (next) => live && setPreview(next),
      () =>
        live &&
        setPreview({ step: 'failed', message: 'Couldn’t show this PDF here. Open it instead.' }),
    );
    return () => {
      live = false;
    };
  }, [api, file.path]);

  const count = preview.step === 'ready' ? preview.pages.length : 0;
  return (
    <Dialog
      title={file.name}
      {...(count > 0 && { description: count === 1 ? '1 page' : `${count} pages` })}
      size="lg"
      onClose={onClose}
    >
      {(close) => (
        <>
          <div className={styles.pages} aria-busy={preview.step === 'drawing'}>
            {preview.step === 'drawing' && (
              <p className={styles.note} role="status">
                Drawing the pages…
              </p>
            )}
            {preview.step === 'failed' && (
              <p className={styles.problem} role="alert">
                {preview.message}
              </p>
            )}
            {preview.step === 'ready' &&
              preview.pages.map((page) => (
                <img
                  key={page.number}
                  className={styles.page}
                  src={page.url}
                  width={page.width}
                  height={page.height}
                  alt={`Page ${page.number} of ${count}`}
                />
              ))}
          </div>
          <DialogActions>
            <Button onClick={() => void api.openFile(file.path)}>Open in your PDF app</Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
