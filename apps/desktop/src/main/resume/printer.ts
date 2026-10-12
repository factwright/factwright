import { type FitRow, MEASURE_SCRIPT, measurableHtml, pdfPageCount } from '@factwright/engine';
import { BrowserWindow, session } from 'electron';
import { denyPermissions } from '../security.ts';

/** A printed resume: the PDF, its pages, and how full its last page is (0 to 100). */
export interface PrintedResume {
  pdf: Buffer;
  pages: number;
  lastFill: number | null;
}

/** Prints resume pages to PDF and measures how their lines fit. Tests pass their own. */
export interface ResumePrinter {
  print(html: string): Promise<PrintedResume>;
  measure(html: string): Promise<FitRow[]>;
}

/** Prints a page to PDF and nothing more, such as a template's preview. */
export interface PdfPrinter {
  pdf(html: string): Promise<Buffer>;
}

/** The text's height on a Letter page, less the layouts' half-inch top and bottom margins. */
const TEXT_HEIGHT_PX = 10 * 96;
/** How close the last page's free space is measured, in CSS pixels. */
const PRECISION_PX = 4;

let printSession: Electron.Session | undefined;

/**
 * A session of its own for printing, kept in memory only. It loads the page it's given and
 * nothing else, so a resume can't reach the network or the user's files.
 */
function printingSession(): Electron.Session {
  if (printSession) return printSession;
  const ses = session.fromPartition('resume-printing');
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') });
  });
  denyPermissions(ses);
  printSession = ses;
  return ses;
}

/**
 * Loads a page from its HTML, through a data URL, so nothing touches the disk. Its fonts load
 * only as text needs them, so it loads them all before anything is printed or measured.
 */
async function loadPage(window: BrowserWindow, html: string): Promise<void> {
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await window.webContents.executeJavaScript(
    'Promise.all([...document.fonts].map((face) => face.load().catch(() => null))).then(() => document.fonts.ready).then(() => true)',
  );
}

const printPdf = (window: BrowserWindow) =>
  window.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    preferCSSPageSize: true,
  });

const pagesIn = (pdf: Buffer) => pdfPageCount(pdf.toString('latin1'));

/**
 * The free space at the end of the last page, in CSS pixels: the tallest block that still fits
 * there without starting a new page, found by printing with a growing spacer at the end.
 */
async function freeSpace(window: BrowserWindow, pages: number): Promise<number> {
  await window.webContents.executeJavaScript(`(() => {
    const spacer = document.createElement('div');
    spacer.id = 'fit-spacer';
    spacer.style.cssText = 'height:0;margin:0;padding:0;break-inside:avoid';
    document.body.appendChild(spacer);
  })()`);
  let fits = 0;
  let spills = TEXT_HEIGHT_PX;
  while (spills - fits > PRECISION_PX) {
    const height = Math.round((fits + spills) / 2);
    await window.webContents.executeJavaScript(
      `document.getElementById('fit-spacer').style.height = '${height}px'`,
    );
    if (pagesIn(await printPdf(window)) === pages) fits = height;
    else spills = height;
  }
  return fits;
}

function isFitRow(value: unknown): value is FitRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.lines === 'number' && typeof row.last === 'number' && typeof row.text === 'string'
  );
}

/**
 * Prints and measures in one hidden window, with Chromium's own layout, as the PDF will have it.
 * Jobs take turns in that window, since a window made right after another is closed can fail to
 * load.
 */
export class ElectronResumePrinter implements ResumePrinter, PdfPrinter {
  private window: BrowserWindow | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  pdf(html: string): Promise<Buffer> {
    return this.inTurn(async (window) => {
      await loadPage(window, html);
      return printPdf(window);
    });
  }

  print(html: string): Promise<PrintedResume> {
    return this.inTurn(async (window) => {
      await loadPage(window, html);
      const pdf = await printPdf(window);
      const pages = pagesIn(pdf);
      if (!pages) return { pdf, pages: 0, lastFill: null };
      const free = await freeSpace(window, pages);
      const lastFill = Math.round((100 * (TEXT_HEIGHT_PX - free)) / TEXT_HEIGHT_PX);
      return { pdf, pages, lastFill };
    });
  }

  measure(html: string): Promise<FitRow[]> {
    return this.inTurn(async (window) => {
      await loadPage(window, measurableHtml(html));
      const rows: unknown = await window.webContents.executeJavaScript(MEASURE_SCRIPT);
      return Array.isArray(rows) ? rows.filter(isFitRow) : [];
    });
  }

  /** Closes the hidden window, such as when the app quits. */
  close(): void {
    this.window?.destroy();
    this.window = undefined;
  }

  private inTurn<T>(work: (window: BrowserWindow) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => work(this.page()));
    this.queue = run.catch(() => {});
    return run;
  }

  private page(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.window = new BrowserWindow({
      show: false,
      width: 816,
      height: 1056,
      webPreferences: {
        session: printingSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    return this.window;
  }
}
