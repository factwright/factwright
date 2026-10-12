import { describe, expect, it } from 'vitest';
import { LAYOUTS } from './schema.ts';
import { TEMPLATES, templateOf } from './templates.ts';

describe('TEMPLATES', () => {
  it('offers every layout once, each with its own name', () => {
    expect(TEMPLATES.map((each) => each.layout).sort()).toEqual([...LAYOUTS].sort());
    expect(new Set(TEMPLATES.map((each) => each.name)).size).toBe(LAYOUTS.length);
  });

  it('says what each one looks like in a sentence', () => {
    for (const { look } of TEMPLATES) expect(look).toMatch(/^[A-Z].{20,100}\.$/);
  });

  it('finds a layout’s template', () => {
    expect(templateOf('compact').name).toBe('Compact');
    expect(templateOf('modern').columns).toBe(2);
  });
});
