import { LAYOUTS, type Layout, previewResume, renderHtml } from '@factwright/engine';
import type { PreviewResult } from '../../shared/profile.ts';
import { RESUME_FONTS } from '../resume/fonts.ts';
import type { PdfPrinter } from '../resume/printer.ts';

/** The most previews kept at once: every template, for a couple of names. */
const KEPT = LAYOUTS.length * 2;

/**
 * Each template's preview: a made-up resume printed in it as a PDF, with the user's own name on
 * top once they've given it. Each is printed once and kept, since the gallery shows them all.
 */
export class TemplatePreviews {
  private readonly printed = new Map<string, Promise<Buffer>>();
  private readonly printer: PdfPrinter;

  constructor(printer: PdfPrinter) {
    this.printer = printer;
  }

  async preview(layout: unknown, name: unknown): Promise<PreviewResult> {
    if (!(LAYOUTS as readonly unknown[]).includes(layout)) {
      return { ok: false, message: 'There’s no template by that name.' };
    }
    const shown = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : '';
    const key = `${layout}\n${shown}`;
    let pdf = this.printed.get(key);
    if (!pdf) {
      const resume = { ...previewResume(), ...(shown && { name: shown }) };
      pdf = this.printer.pdf(renderHtml(resume, layout as Layout, RESUME_FONTS));
      this.printed.set(key, pdf);
      // The oldest go first once there are more than the gallery can show.
      for (const old of [...this.printed.keys()].slice(0, Math.max(0, this.printed.size - KEPT))) {
        this.printed.delete(old);
      }
    }
    try {
      return { ok: true, data: new Uint8Array(await pdf) };
    } catch {
      this.printed.delete(key);
      return { ok: false, message: 'This preview couldn’t be drawn. Try again.' };
    }
  }
}
