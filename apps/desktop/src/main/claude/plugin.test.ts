import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESUME_FIELDS } from '@factwright/engine';
import { describe, expect, it } from 'vitest';
import { factwrightTools } from '../tools/index.ts';
import { sessionSettings } from './settings.ts';

const pluginDir = fileURLToPath(new URL('../../../../../plugin/', import.meta.url));
const skillsDir = join(pluginDir, 'skills');
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const text = readFileSync(join(skillsDir, entry.name, 'SKILL.md'), 'utf8');
    const head = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
    const fields = Object.fromEntries(
      head.split('\n').map((line) => {
        const [key = '', ...rest] = line.split(':');
        return [
          key.trim(),
          rest
            .join(':')
            .trim()
            .replace(/^"(.*)"$/, '$1'),
        ];
      }),
    );
    return { folder: entry.name, text, fields };
  });

const plugin = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
// Tool names only: the tools need no app, so these stubs never run.
const toolNames = factwrightTools({ jobs: {} as never, workspace: '', printer: {} as never }).map(
  (tool) => tool.name,
);

describe('the plugin’s skills', () => {
  it('are there', () => {
    expect(skills.map((skill) => skill.folder).sort()).toEqual([
      'add-facts',
      'answer-questions',
      'fit-check',
      'focused-resume',
      'interview-prep',
      'salary-check',
      'unmask-job',
      'who-to-message',
    ]);
  });

  it.each(skills)('$folder has a name, a description and a hint', ({ folder, fields }) => {
    expect(fields.name).toBe(folder);
    expect(fields.description?.length).toBeGreaterThan(80);
    // Claude Code lists at most 1,536 characters of a skill's description.
    expect(fields.description?.length).toBeLessThanOrEqual(1536);
    expect(fields['argument-hint']).toMatch(/^\[.+\]$/);
  });

  it.each(skills)('$folder only names tools, resume fields and skills that exist', ({ text }) => {
    for (const [, name] of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
      expect([...toolNames, ...RESUME_FIELDS]).toContain(name);
    }
    for (const [, name] of text.matchAll(/\/factwright:([a-z-]+)/g)) {
      expect(skills.map((skill) => skill.folder)).toContain(name);
    }
  });

  it('use every one of Factwright’s tools between them', () => {
    const named = new Set(
      skills.flatMap(({ text }) =>
        [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(([, name]) => name ?? ''),
      ),
    );
    expect(toolNames.filter((name) => named.has(name))).toEqual(toolNames);
  });

  it.each(skills)('$folder has nothing left from the old repo', ({ text }) => {
    for (const leftover of [
      /\bSteve\b/,
      /\bgit (?:add|commit|push)\b/,
      /\bnode (?:dashboard|engine)\//,
      /\.private\//,
      /linkedin ok/i,
      /SendUserFile/,
      /model: "opus"/,
    ]) {
      expect(text).not.toMatch(leftover);
    }
  });

  it('run without asking, under the plugin’s own name', () => {
    expect(plugin.name).toBe('factwright');
    const settings = sessionSettings({ hookUrl: 'http://127.0.0.1:4000/hook', dark: false });
    expect(settings.permissions.allow).toContain(`Skill(${plugin.name} *)`);
  });
});
