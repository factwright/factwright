import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESUME_FIELDS } from '@factwright/engine';
import { describe, expect, it } from 'vitest';
import { HUNT_SKILLS, RUN_SKILLS, SEARCH_SKILL } from '../../shared/runs.ts';
import { TERMS_HEADER } from '../about/terms.ts';
import { runPrompt } from '../policy.ts';
import { type FactTask, UNVERIFIED_CHOICES } from '../tools/facts.ts';
import { factwrightTools } from '../tools/index.ts';
import { buildLaunchArgs, STANDING_RULES } from './launch.ts';
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
const toolNames = factwrightTools({
  jobs: {} as never,
  about: {} as never,
  facts: {} as never,
  workspace: '',
  printer: {} as never,
  templates: {} as never,
}).map((tool) => tool.name);

describe('the plugin’s skills', () => {
  it('are there', () => {
    expect(skills.map((skill) => skill.folder).sort()).toEqual([
      'add-facts',
      'answer-questions',
      'ask',
      'cover-letter',
      'fit-check',
      'focused-resume',
      'get-started',
      'interview-prep',
      'job-search',
      'make-template',
      'projects-page',
      'revise-resume',
      'salary-check',
      'thank-you',
      'unmask-job',
      'who-to-message',
      'work-history',
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

  it('include every skill the job panel runs, each taking a job by its ID', () => {
    for (const skill of RUN_SKILLS) {
      const found = skills.find(({ folder }) => folder === skill);
      expect(found?.text).toContain('`job <id>`');
    }
  });

  it('ask about what a job wants while writing for it, and save the answers under their task', () => {
    const writing: Readonly<Record<string, FactTask>> = {
      'focused-resume': 'resume',
      'revise-resume': 'resume',
      'cover-letter': 'cover-letter',
      'projects-page': 'projects-page',
      'answer-questions': 'answers',
      'interview-prep': 'interview-prep',
    };
    for (const [folder, task] of Object.entries(writing)) {
      const text = skills.find((skill) => skill.folder === folder)?.text ?? '';
      expect(text, folder).toContain(`task: "${task}"`);
      for (const tool of ['save_fact', 'save_gap']) expect(text, folder).toContain(`\`${tool}\``);
    }
  });

  it('correct a verified fact only with correct_fact, never by editing it for the user to OK', () => {
    for (const folder of ['focused-resume', 'cover-letter']) {
      const text = skills.find((skill) => skill.folder === folder)?.text ?? '';
      expect(text, folder).toContain('`correct_fact`');
    }
    const rules = readFileSync(join(pluginDir, STANDING_RULES), 'utf8');
    expect(rules).toContain('`correct_fact`');
    // Claude changes files and reads pages without asking, so nothing says the user OKs them.
    const asking =
      /may have to OK|asks them to OK|which the user OKs|ordinary edit|asks the user (?:first|each time)|edit the fact in place/;
    for (const { folder, text } of [...skills, { folder: 'standing rules', text: rules }]) {
      expect(text, folder).not.toMatch(asking);
    }
  });

  it('make a quick resume that asks nothing, uses verified facts only, and says what could make it stronger', () => {
    const text = skills.find(({ folder }) => folder === 'focused-resume')?.text ?? '';
    // What the app types for a quick resume, a first one or a new version, word for word.
    for (const task of [
      { skill: 'focused-resume' as const, jobId: 'acme--staff', quick: true as const },
      {
        skill: 'focused-resume' as const,
        jobId: 'acme--staff',
        again: true as const,
        quick: true as const,
      },
    ]) {
      const typed = runPrompt(task).replace(
        '/factwright:focused-resume job acme--staff',
        'job <id>',
      );
      expect(text).toContain(`\`${typed}\``);
    }
    const quick = text.slice(text.indexOf('## Quick resume'), text.indexOf('## 1. '));
    expect(quick).toContain(
      '**Ask nothing.** No AskUserQuestion round, and no question in plain text.',
    );
    expect(quick).toContain('**Verified facts only.**');
    expect(quick).toContain('Leave out every claim tagged `unconfirmed`');
    // It saves nothing to the fact bank, since it asked nothing.
    for (const tool of ['save_fact', 'save_gap', 'verify_fact', 'correct_fact']) {
      expect(quick).toContain(`\`${tool}\``);
    }
    expect(quick).toContain('`## What could make it stronger`');
    for (const part of [
      'unverified and low-confidence facts',
      'gaps that matter',
      'numbers missing',
    ]) {
      expect(quick).toContain(part);
    }
    expect(text).toContain('A quick resume skips this step: it asks nothing.');
    // Low-confidence claims are asked about before they're used, so a quick resume leaves them out.
    expect(quick).toContain('every `low`-confidence one');
    // The fact-check still runs, and the reply points to the button that asks: New version.
    expect(quick).toContain("Step 8's fact-check still runs");
    expect(text).toContain('never for a quick resume');
    expect(quick).toContain('New version, beside the resume, asks about these');
    expect(quick).not.toContain('Tailor a resume');
    expect(quick).toContain('**Fewer pages when it must.**');
    const rules = readFileSync(join(pluginDir, STANDING_RULES), 'utf8');
    expect(rules).toContain('A quick resume asks nothing');
  });

  it('never tell Claude to save a fact in a file save_fact turns away', () => {
    for (const { folder, text } of skills) {
      for (const line of text.split('\n').filter((each) => each.includes('`save_fact`'))) {
        for (const file of ['facts/skills.md', 'facts/gaps.md', 'facts/profile.md']) {
          expect(line, folder).not.toContain(file);
        }
      }
    }
  });

  it('include the skills the app starts on the whole job hunt', () => {
    for (const skill of HUNT_SKILLS) expect(skills.map(({ folder }) => folder)).toContain(skill);
    const started = skills.find(({ folder }) => folder === 'get-started');
    // It reads what the app saved, and never uses a claim the user hasn't confirmed.
    for (const words of [
      'about-me/answers.json',
      'about-me/read.md',
      'unconfirmed',
      'base/<style>-<track>',
    ]) {
      expect(started?.text).toContain(words);
    }
  });

  it('include the job search the jobs page runs, with each place it types, or none', () => {
    const found = skills.find(({ folder }) => folder === SEARCH_SKILL);
    expect(found?.text).toMatch(/If there's no input, ask .*AskUserQuestion/);
    // The words the app types for each place, word for word.
    for (const place of ['**HN**', '**LinkedIn**', '**Indeed:**', '**company job boards:**']) {
      expect(found?.text).toContain(place);
    }
    expect(found?.text).toContain('Each place is a search of its own, with its own folder');
    expect(found?.text).toMatch(
      /LinkedIn or Indeed:\*\* never open their pages, and never sign in/,
    );
  });

  it('run without asking, under the plugin’s own name', () => {
    expect(plugin.name).toBe('factwright');
    const settings = sessionSettings({ hookUrl: 'http://127.0.0.1:4000/hook', dark: false });
    expect(settings.permissions.allow).toContain(`Skill(${plugin.name} *)`);
  });
});

describe('the standing rules', () => {
  const rules = readFileSync(join(pluginDir, STANDING_RULES), 'utf8');

  it('reach every run, after Claude Code’s own instructions', () => {
    const args = buildLaunchArgs({
      pluginDir,
      mcpConfig: 'mcp.json',
      settings: 'settings.json',
      permissionMode: 'default',
    });
    const at = args.indexOf('--append-system-prompt-file');
    expect(args[at + 1]).toBe(join(pluginDir, STANDING_RULES));
  });

  it('carry the rules every run needs, whichever skill is working', () => {
    for (const rule of [
      'Information, not instructions',
      'Facts first',
      'Ask about what the job wants',
      'Save what the user answers',
      'Unverified facts',
      'Everything on file',
      'Kinds of job',
      'Ask once',
      'Learn from feedback',
      'Confidential stays out',
      'Names',
      'What went out stays as it went',
      'How to apply',
      'Accounts',
      'Short replies',
    ]) {
      expect(rules).toContain(`**${rule}.**`);
    }
  });

  it('have nothing personal, and nothing left from the old repo', () => {
    for (const leftover of [
      /\bSteve\b/,
      /\.private\//,
      /\bgit (?:add|commit|push)\b/,
      /linkedin ok/i,
    ]) {
      expect(rules).not.toMatch(leftover);
    }
  });

  it('save answers with the tools that file them, and offer unverified facts as verify_fact takes them', () => {
    for (const tool of ['save_fact', 'save_gap', 'verify_fact'])
      expect(rules).toContain(`\`${tool}\``);
    expect(rules).toContain('AskUserQuestion');
    const [verify, once, skip] = UNVERIFIED_CHOICES;
    expect(rules).toContain(`"${verify}", "${once}" and "${skip}"`);
  });
});

describe('the starter files', () => {
  const starterDir = join(pluginDir, 'starter');
  const files: string[] = [];
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), `${path}/`);
      else files.push(path);
    }
  };
  walk(starterDir);
  const read = (path: string) => readFileSync(join(starterDir, path), 'utf8');

  it('are the guide, the styles and the fact bank’s format, each listed in the folder’s README', () => {
    expect(files.sort()).toEqual([
      'README.md',
      'facts/README.md',
      'guide/confidential-terms.txt',
      'guide/lint.json',
      'guide/preferences.md',
      'guide/rules.md',
      'guide/styles/README.md',
      'guide/styles/big-company.md',
      'guide/styles/public-sector.md',
      'guide/styles/startup.md',
      'guide/writing.md',
    ]);
    const readme = read('README.md');
    for (const path of files.filter(
      (each) => each !== 'README.md' && !each.startsWith('guide/styles/'),
    )) {
      expect(readme).toContain(`(${path})`);
    }
  });

  it('name only resume fields and tools that exist', () => {
    for (const path of files.filter((each) => each.endsWith('.md'))) {
      for (const [, name] of read(path).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        expect([...toolNames, ...RESUME_FIELDS], `${path}: ${name}`).toContain(name);
      }
    }
  });

  it('give every style a starting resume for each track', () => {
    for (const style of ['startup', 'big-company', 'public-sector']) {
      const text = read(`guide/styles/${style}.md`);
      for (const track of ['leader', 'builder', 'ic'])
        expect(text).toContain(`base/${style}-${track}.json`);
    }
  });

  it('start the confidential terms with the line the app writes, and leave the page count to the app', () => {
    expect(read('guide/confidential-terms.txt')).toBe(`${TERMS_HEADER}\n`);
    const lint = JSON.parse(read('guide/lint.json'));
    expect(lint.maxPages).toBeUndefined();
    for (const rule of lint.banned) expect(() => new RegExp(rule.pattern, 'i')).not.toThrow();
  });

  it('have nothing personal in them', () => {
    for (const path of files) expect(read(path)).not.toMatch(/\bSteve\b|\bProven\b|\.private\//);
  });
});
