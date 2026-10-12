import { describe, expect, it, vi } from 'vitest';
import { TemplatePreviews } from './previews.ts';

const printer = () => ({ pdf: vi.fn(async (html: string) => Buffer.from(`%PDF ${html.length}`)) });

describe('TemplatePreviews', () => {
  it('prints a made-up resume in a template, with the user’s own name once given', async () => {
    const fake = printer();
    const previews = new TemplatePreviews(fake);
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
    const previews = new TemplatePreviews(fake);
    await previews.preview('banner', 'Sam Lee');
    await previews.preview('banner', 'Sam Lee');
    expect(fake.pdf).toHaveBeenCalledOnce();
  });

  it('says when a template doesn’t exist, or its preview couldn’t be drawn, and tries again later', async () => {
    const fake = printer();
    const previews = new TemplatePreviews(fake);
    expect(await previews.preview('fancy', '')).toEqual({
      ok: false,
      message: 'There’s no template by that name.',
    });
    fake.pdf.mockRejectedValueOnce(new Error('the window closed'));
    expect(await previews.preview('minimal', '')).toEqual({
      ok: false,
      message: 'This preview couldn’t be drawn. Try again.',
    });
    expect((await previews.preview('minimal', '')).ok).toBe(true);
  });
});
