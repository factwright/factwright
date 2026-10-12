import { describe, expect, it } from 'vitest';
import { readTemplate, templateFile } from './template/file.ts';
import { builtInTemplate, DEFAULT_TEMPLATE, TEMPLATE_ID, TEMPLATES } from './templates.ts';

describe('TEMPLATES', () => {
  it('ships two plain templates, Classic first, as the default', () => {
    expect(TEMPLATES.map((each) => [each.id, each.name])).toEqual([
      ['classic', 'Classic'],
      ['minimal', 'Minimal'],
    ]);
    expect(DEFAULT_TEMPLATE).toBe('classic');
    expect(builtInTemplate('minimal')?.name).toBe('Minimal');
    expect(builtInTemplate('timeline')).toBeUndefined();
  });

  it('says what each one looks like in a sentence', () => {
    for (const { look } of TEMPLATES) expect(look).toMatch(/^[A-Z].{20,100}\.$/);
  });

  it('holds each one to the rules a template file has to meet', () => {
    for (const template of TEMPLATES) {
      expect(TEMPLATE_ID.test(template.id)).toBe(true);
      expect(readTemplate(JSON.parse(templateFile(template)), template.id)).toEqual({
        ok: true,
        template,
      });
    }
  });
});
