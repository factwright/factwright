import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// pdf.js reads PDFs in a worker of its own, built into the app.
GlobalWorkerOptions.workerSrc = workerUrl;

/** One page of a PDF, drawn as an image. */
export interface PageImage {
  /** Its page number, from 1. */
  number: number;
  /** The image, as a data: URL. */
  url: string;
  /** Its size on screen, in CSS pixels. */
  width: number;
  height: number;
}

/**
 * Draws each page of a PDF as an image, `width` CSS pixels across and sharp on this screen,
 * with pdf.js. It's loaded only when a preview opens, so it never slows the app's start.
 */
export async function drawPages(data: Uint8Array, width: number): Promise<PageImage[]> {
  const loading = getDocument({ data, enableXfa: false });
  const pdf = await loading.promise;
  try {
    const pages: PageImage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = (width / natural.width) * window.devicePixelRatio;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      // As for printing: on screen, pdf.js draws between frames, which stop while the window
      // is hidden, so a preview drawn in the background would never finish.
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      pages.push({
        number,
        url: canvas.toDataURL('image/png'),
        width,
        height: Math.round((width * natural.height) / natural.width),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

/**
 * A PDF's text, page by page, with pdf.js, for Claude to read the way the user's PDF reads. It
 * reads a copy, since pdf.js hands the bytes it's given to its worker.
 */
export async function pdfText(data: Uint8Array): Promise<string> {
  const loading = getDocument({ data: data.slice(), enableXfa: false });
  const pdf = await loading.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trimEnd());
          line = '';
        }
      }
      if (line.trim()) lines.push(line.trimEnd());
      pages.push(lines.join('\n'));
      page.cleanup();
    }
    return pages.join('\n\n').trim();
  } finally {
    await loading.destroy();
  }
}
