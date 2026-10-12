import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtInTemplate, type Template, templateFile } from '@factwright/engine';
import { describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from '../resume/templates.ts';
import { TemplatePreviews } from './previews.ts';

const printer = () => ({ pdf: vi.fn(async (html: string) => Buffer.from(`%PDF ${html.length}`)) });

function workspace(): { library: TemplateLibrary; save: (id: string, template: Template) => void } {
  const root = mkdtempSync(join(tmpdir(), 'factwright-previews-'));
  mkdirSync(join(root, 'templates'));
  return {
    library: new TemplateLibrary({ workspace: root }),
    save: (id, template) =>
      writeFileSync(join(root, 'templates', `${id}.json`), templateFile(template)),
  };
}

describe('TemplatePreviews', () => {
  it('prints a made-up resume in a template, with the user’s own name once given', async () => {
    const fake = printer();
    const previews = new TemplatePreviews(fake, workspace().library);
    const sample = await previews.preview('classic', '');
    expect(sample.ok).toBe(true);
    expect(fake.pdf.mock.calls[0]?.[0]).toContain('<div class="name">Jordan Avery</div>');
    // Caladea sets the classic template, carried in the page.
    expect(fake.pdf.mock.calls[0]?.[0]).toContain('font-family:"Caladea"');
    await previews.preview('classic', '  Sam Lee ');
    expect(fake.pdf.mock.calls[1]?.[0]).toContain('<div class="name">Sam Lee</div>');
  });

  it('prints each once, however often it’s shown', async () => {
    const fake = printer();
    const previews = new TemplatePreviews(fake, workspace().library);
    await previews.preview('minimal', 'Sam Lee');
    await previews.preview('minimal', 'Sam Lee');
    expect(fake.pdf).toHaveBeenCalledOnce();
  });

  it('prints the user’s own templates, and again once one changes', async () => {
    const fake = printer();
    const { library, save } = workspace();
    const previews = new TemplatePreviews(fake, library);
    const classic = builtInTemplate('classic') as Template;
    save('two-tone', { ...classic, css: '.name{color:#123}' });
    expect((await previews.preview('two-tone', '')).ok).toBe(true);
    expect(fake.pdf.mock.calls[0]?.[0]).toContain('.name{color:#123}');
    await previews.preview('two-tone', '');
    expect(fake.pdf).toHaveBeenCalledOnce();
    save('two-tone', { ...classic, css: '.name{color:#123456}' });
    await previews.preview('two-tone', '');
    expect(fake.pdf).toHaveBeenCalledTimes(2);
    expect(fake.pdf.mock.calls[1]?.[0]).toContain('.name{color:#123456}');
  });

  it('says when a template doesn’t exist, or its preview couldn’t be drawn, and tries again later', async () => {
    const fake = printer();
    const previews = new TemplatePreviews(fake, workspace().library);
    for (const id of ['fancy', '../classic', 42]) {
      expect(await previews.preview(id, '')).toEqual({
        ok: false,
        message: 'There’s no template by that name.',
      });
    }
    fake.pdf.mockRejectedValueOnce(new Error('the window closed'));
    expect(await previews.preview('minimal', '')).toEqual({
      ok: false,
      message: 'This preview couldn’t be drawn. Try again.',
    });
    expect((await previews.preview('minimal', '')).ok).toBe(true);
  });
});
