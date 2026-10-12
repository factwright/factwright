import { previewResume, renderHtml } from '@factwright/engine';
import type { PreviewResult } from '../../shared/profile.ts';
import { RESUME_FONTS } from '../resume/fonts.ts';
import type { PdfPrinter } from '../resume/printer.ts';
import type { TemplateLibrary } from '../resume/templates.ts';

/** The most previews kept at once: plenty for the gallery, for a couple of names. */
const KEPT = 40;

/**
 * Each template's preview: a made-up resume printed in it as a PDF, with the user's own name on
 * top once they've given it. Each is printed once and kept, since the gallery shows them all,
 * until the template changes.
 */
export class TemplatePreviews {
  private readonly printed = new Map<string, Promise<Buffer>>();
  private readonly printer: PdfPrinter;
  private readonly templates: Pick<TemplateLibrary, 'find'>;

  constructor(printer: PdfPrinter, templates: Pick<TemplateLibrary, 'find'>) {
    this.printer = printer;
    this.templates = templates;
  }

  async preview(id: unknown, name: unknown): Promise<PreviewResult> {
    const found = typeof id === 'string' ? this.templates.find(id) : null;
    if (!found?.ok) return { ok: false, message: 'There’s no template by that name.' };
    const shown = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : '';
    const key = `${id}\n${found.stamp}\n${shown}`;
    let pdf = this.printed.get(key);
    if (!pdf) {
      const resume = { ...previewResume(), ...(shown && { name: shown }) };
      pdf = this.printer.pdf(renderHtml(resume, found.template, RESUME_FONTS));
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
