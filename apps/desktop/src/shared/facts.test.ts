import { describe, expect, it } from 'vitest';
import {
  blockProblem,
  CHANGED_SINCE,
  FACT_LIMITS,
  factFile,
  inFactOrder,
  isFactPath,
  parseFactChange,
  parseFactTarget,
  parseNewFact,
  stopped,
} from './facts.ts';

describe('isFactPath', () => {
  it('takes a Markdown file in facts/, in folders or not', () => {
    expect(isFactPath('facts/acme.md')).toBe(true);
    expect(isFactPath('facts/proven/ai.md')).toBe(true);
    expect(isFactPath('facts/Earlier roles.MD')).toBe(true);
  });

  it('refuses anything else, or a way out of the folder', () => {
    for (const path of [
      'guide/rules.md',
      'facts.md',
      'facts/',
      'facts/acme.txt',
      'facts/../guide/rules.md',
      'facts/./acme.md',
      'facts/.hidden.md',
      'facts//acme.md',
      '/facts/acme.md',
      'facts\\acme.md',
      'facts/a:b.md',
      'facts/ acme.md',
      `facts/${'a'.repeat(300)}.md`,
      42,
      null,
    ]) {
      expect(isFactPath(path), String(path)).toBe(false);
    }
  });
});

describe('parseFactTarget, parseFactChange and parseNewFact', () => {
  const target = { path: 'facts/acme.md', index: 3, text: '### A\n`live`\n' };

  it('takes a block as the window read it, and its new text', () => {
    expect(parseFactTarget(target)).toEqual(target);
    expect(parseFactChange({ ...target, next: '### A\n`built`' })).toEqual({
      ...target,
      next: '### A\n`built`',
    });
    expect(parseNewFact({ path: 'facts/acme.md', text: '### B\n`live`' })).toEqual({
      path: 'facts/acme.md',
      text: '### B\n`live`',
    });
  });

  it('refuses what the window could only send by mistake, or on purpose', () => {
    expect(parseFactTarget({ ...target, index: -1 })).toBeNull();
    expect(parseFactTarget({ ...target, index: 1.5 })).toBeNull();
    expect(parseFactTarget({ ...target, path: '../secret.md' })).toBeNull();
    expect(parseFactTarget({ ...target, text: 'nul\u0000' })).toBeNull();
    expect(parseFactTarget([target])).toBeNull();
    expect(parseFactChange({ ...target, next: '  ' })).toBeNull();
    expect(parseFactChange({ ...target, next: 'x'.repeat(FACT_LIMITS.block + 1) })).toBeNull();
    expect(parseNewFact({ path: 'facts/acme.md', text: 42 })).toBeNull();
  });
});

describe('blockProblem', () => {
  it('takes one block at the level it replaces', () => {
    expect(blockProblem('### A\n`live`\n> Words.', 3, { claim: true })).toBeNull();
    expect(blockProblem('## Overview\nWords.', 2, { claim: false })).toBeNull();
    expect(blockProblem('Just words.', 0, { claim: false })).toBeNull();
  });

  it('says what would break the file apart', () => {
    expect(blockProblem('### A\n`live`\n```\ncode', 3, { claim: true })).toMatch(/code block/);
    expect(blockProblem('### A\n`live`\n### B\n`live`', 3, { claim: true })).toMatch(/Headings/);
    expect(blockProblem('Words.\n## Heading', 0, { claim: false })).toMatch(/Headings/);
    expect(blockProblem('## Heading', 0, { claim: false })).toMatch(/Headings/);
    expect(blockProblem('`live`\n> Words.', 3, { claim: true })).toBe('It needs a title.');
    expect(blockProblem('### A\n> No tags.', 3, { claim: true })).toMatch(/status/);
    expect(blockProblem(`### ${'a'.repeat(301)}\n\`live\``, 3, { claim: true })).toMatch(/title/);
  });
});

describe('inFactOrder and factFile', () => {
  it('lists the profile first, then jobs, projects, skills, gaps and the guide', () => {
    expect(
      inFactOrder([
        'facts/README.md',
        'facts/skills.md',
        'facts/zeta.md',
        'facts/gaps.md',
        'facts/projects.md',
        'facts/acme.md',
        'facts/profile.md',
      ]),
    ).toEqual([
      'facts/profile.md',
      'facts/acme.md',
      'facts/zeta.md',
      'facts/projects.md',
      'facts/skills.md',
      'facts/gaps.md',
      'facts/README.md',
    ]);
  });

  it('titles a file by its first heading, or else its name', () => {
    expect(factFile('facts/acme.md', '# Acme Health\n').title).toBe('Acme Health');
    expect(factFile('facts/earlier-roles.md', '## Overview\n').title).toBe('Earlier roles');
    expect(factFile('facts/gaps.md', '### Looks like one\n`live`\n')).toMatchObject({
      kind: 'gaps',
      blocks: [{ tags: null }],
    });
  });
});

describe('stopped', () => {
  it('marks a change refused because the block changed since', () => {
    expect(stopped(CHANGED_SINCE)).toEqual({ ok: false, message: CHANGED_SINCE, changed: true });
    expect(stopped('Nope.')).toEqual({ ok: false, message: 'Nope.' });
  });
});
