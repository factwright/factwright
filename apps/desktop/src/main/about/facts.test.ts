import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANGED_SINCE, type FactBank, type FactResult, firstNameOf } from '../../shared/facts.ts';
import { FactBankFiles } from './facts.ts';

let workspace: string;
let outside: string;
let name: string;
let facts: FactBankFiles;

const write = (path: string, text: string) => {
  const file = join(workspace, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
const read = (path: string) => readFileSync(join(workspace, path), 'utf8');

const ACME = [
  '# Acme Health',
  '',
  '## Overview',
  'Staff engineer, 2021–2026.',
  '',
  '### Scheduling platform',
  '`live` `led-and-built` `high`',
  '> Built a scheduling platform used by 40 clinics.',
  '- **Source:** Alex 2026-10-01',
  '',
  '### Reminder texts',
  '`unconfirmed` `shipped` `solo` `medium`',
  '> Shipped appointment reminder texts.',
  '- **Source:** resume alex.pdf 2026-10-10',
  '',
  "## Don't claim",
  '- Never "HIPAA certified".',
  '',
].join('\n');

/** The bank a change answered with, or a failure with its message. */
const bankOf = (result: FactResult): FactBank => {
  if (!result.ok) throw new Error(result.message);
  return result.bank;
};

const blockOf = (bank: FactBank, path: string, title: string) => {
  const block = bank.files
    .find((file) => file.path === path)
    ?.blocks.find((each) => each.title === title);
  if (!block) throw new Error(`no ${title} in ${path}`);
  return block;
};

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'factwright-facts-'));
  outside = mkdtempSync(join(tmpdir(), 'factwright-outside-'));
  name = 'Alex Rivera';
  facts = new FactBankFiles({ workspace, name: () => name, today: () => '2026-10-12' });
  write('facts/acme.md', ACME);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('read', () => {
  it('lists the files, profile first and the guide last, each with its blocks', () => {
    write('facts/README.md', '# Facts: what’s true about Alex\n\n### Short claim title\n`live`\n');
    write('facts/gaps.md', '# Gaps\n## Doesn’t have\n');
    write('facts/profile.md', '# Profile\n');
    write('facts/skills.md', '# Skills\n');
    write('facts/earlier/beta-labs.md', '## Overview\nSupport lead.\n');
    const bank = facts.read();
    expect(bank.files.map((file) => [file.path, file.title, file.kind])).toEqual([
      ['facts/profile.md', 'Profile', 'claims'],
      ['facts/acme.md', 'Acme Health', 'claims'],
      ['facts/earlier/beta-labs.md', 'Beta labs', 'claims'],
      ['facts/skills.md', 'Skills', 'claims'],
      ['facts/gaps.md', 'Gaps', 'gaps'],
      ['facts/README.md', 'Facts: what’s true about Alex', 'guide'],
    ]);
    expect(bank.firstName).toBe('Alex');
    expect(bank.skipped).toEqual([]);
    // The guide's format example isn't one of the user's claims.
    expect(bank.files.at(-1)?.blocks.every((block) => block.tags === null)).toBe(true);
    expect(blockOf(bank, 'facts/acme.md', 'Reminder texts').tags).toEqual([
      'unconfirmed',
      'shipped',
      'solo',
      'medium',
    ]);
  });

  it('leaves out hidden files, other files, and links that lead elsewhere', () => {
    write('facts/.draft.md', '# Draft\n');
    write('facts/notes.txt', 'Not Markdown.');
    writeFileSync(join(outside, 'secret.md'), '# Secret\n');
    symlinkSync(join(outside, 'secret.md'), join(workspace, 'facts/linked.md'));
    symlinkSync(outside, join(workspace, 'facts/linked-folder'));
    expect(facts.read().files.map((file) => file.path)).toEqual(['facts/acme.md']);
  });

  it('is empty without a fact bank', () => {
    rmSync(join(workspace, 'facts'), { recursive: true });
    expect(facts.read()).toEqual({ files: [], skipped: [], firstName: 'Alex' });
  });

  it('skips a file too big to show, or with a name some computers can’t hold, and says so', () => {
    write('facts/huge.md', `# Huge\n${'x'.repeat(2_000_001)}`);
    // A name with a space in front, which every computer can hold but Windows trims elsewhere.
    write('facts/ notes.md', '# Notes\n');
    expect(facts.read().skipped).toEqual([
      { path: 'facts/ notes.md', why: 'name' },
      { path: 'facts/huge.md', why: 'big' },
    ]);
  });
});

describe('change', () => {
  it('gives one claim new words and keeps the rest of the file as it was', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Scheduling platform');
    const next =
      '### Scheduling platform\n`live` `led-and-built` `high`\n> Built it for 41 clinics.';
    const bank = bankOf(facts.change({ path: 'facts/acme.md', ...block, next }));
    expect(read('facts/acme.md')).toBe(ACME.replace(block.text, `${next}\n\n`));
    expect(blockOf(bank, 'facts/acme.md', 'Scheduling platform').body).toBe(
      '> Built it for 41 clinics.',
    );
  });

  it('changes a section, such as the overview', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Overview');
    bankOf(
      facts.change({
        path: 'facts/acme.md',
        ...block,
        next: '## Overview\nStaff engineer, 2020–2026.',
      }),
    );
    expect(read('facts/acme.md')).toContain(
      '## Overview\nStaff engineer, 2020–2026.\n\n### Scheduling',
    );
  });

  it('refuses a claim that changed since the window read it, and keeps the file', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Scheduling platform');
    write('facts/acme.md', ACME.replace('40 clinics', '42 clinics'));
    const result = facts.change({
      path: 'facts/acme.md',
      ...block,
      next: '### Scheduling platform\n`live`\n> Mine.',
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/changed since you opened it/),
      changed: true,
    });
    expect(read('facts/acme.md')).toBe(ACME.replace('40 clinics', '42 clinics'));
  });

  it('refuses text that would break the file apart', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Scheduling platform');
    const change = (next: string) => facts.change({ path: 'facts/acme.md', ...block, next });
    expect(change('### Scheduling platform\n`live`\n```\nopen code')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/code block/),
    });
    expect(change('### Scheduling platform\n`live`\n## Another section')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Headings/),
    });
    expect(change('## Scheduling platform\n`live`')).toMatchObject({
      ok: false,
      message: 'It needs a title.',
    });
    expect(change('### Scheduling platform\n> No tags.')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/status/),
    });
    expect(read('facts/acme.md')).toBe(ACME);
  });

  it('keeps a file’s Windows line endings', () => {
    write('facts/beta.md', '# Beta\r\n\r\n## Overview\r\nOld.\r\n');
    const block = blockOf(facts.read(), 'facts/beta.md', 'Overview');
    bankOf(facts.change({ path: 'facts/beta.md', ...block, next: '## Overview\nNew.\nLines.' }));
    expect(read('facts/beta.md')).toBe('# Beta\r\n\r\n## Overview\r\nNew.\r\nLines.\r\n');
  });

  it('refuses a file outside facts/, or one reached through a link', () => {
    write('guide/rules.md', '## Rules\nOld.\n');
    writeFileSync(join(outside, 'elsewhere.md'), '## Rules\nOld.\n');
    symlinkSync(join(outside, 'elsewhere.md'), join(workspace, 'facts/linked.md'));
    mkdirSync(join(outside, 'folder'));
    writeFileSync(join(outside, 'folder', 'deep.md'), '## Rules\nOld.\n');
    symlinkSync(join(outside, 'folder'), join(workspace, 'facts/folder'));
    for (const path of [
      'guide/rules.md',
      'facts/../guide/rules.md',
      'facts/linked.md',
      'facts/folder/deep.md',
    ]) {
      expect(
        facts.change({ path, index: 0, text: '## Rules\nOld.\n', next: '## Rules\nNew.' }),
      ).toEqual({
        ok: false,
        message: 'That file isn’t in your fact bank anymore.',
      });
    }
    expect(read('guide/rules.md')).toBe('## Rules\nOld.\n');
    expect(readFileSync(join(outside, 'elsewhere.md'), 'utf8')).toBe('## Rules\nOld.\n');
    expect(readFileSync(join(outside, 'folder', 'deep.md'), 'utf8')).toBe('## Rules\nOld.\n');
  });

  it('reaches a file only by the name the folder gives it', () => {
    // On a Mac or Windows, "facts/GAPS.md" would otherwise open gaps.md as a file of facts.
    write('facts/gaps.md', '# Gaps\n');
    expect(facts.add({ path: 'facts/GAPS.md', text: '### C\n`live`\n> Did C.' })).toEqual({
      ok: false,
      message: 'That file isn’t in your fact bank anymore.',
    });
    expect(read('facts/gaps.md')).toBe('# Gaps\n');
  });

  it('leaves no half-saved file behind', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Overview');
    bankOf(facts.change({ path: 'facts/acme.md', ...block, next: '## Overview\nNew.' }));
    expect(readdirSync(join(workspace, 'facts'))).toEqual(['acme.md']);
  });
});

describe('add', () => {
  const claim =
    '### On-call rotation\n`live` `led-team` `high`\n> Led an on-call rotation.\n- **Source:** Alex 2026-10-12';

  it('puts a new claim after the file’s last one', () => {
    const bank = bankOf(facts.add({ path: 'facts/acme.md', text: claim }));
    expect(bank.files[0]?.blocks.map((block) => block.title)).toEqual([
      'Acme Health',
      'Overview',
      'Scheduling platform',
      'Reminder texts',
      'On-call rotation',
      "Don't claim",
    ]);
  });

  it('only adds a claim, and only to a file of facts', () => {
    write('facts/gaps.md', '# Gaps\n');
    expect(facts.add({ path: 'facts/gaps.md', text: claim })).toMatchObject({ ok: false });
    expect(facts.add({ path: 'facts/acme.md', text: '## A section\nWords.' })).toMatchObject({
      ok: false,
    });
    expect(facts.add({ path: 'facts/missing.md', text: claim })).toMatchObject({ ok: false });
    expect(read('facts/acme.md')).toBe(ACME);
  });
});

describe('remove', () => {
  it('deletes a claim, and nothing else', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Reminder texts');
    bankOf(facts.remove({ path: 'facts/acme.md', ...block }));
    expect(read('facts/acme.md')).toBe(ACME.replace(block.text, ''));
  });

  it('keeps sections, and a claim that changed since', () => {
    const bank = facts.read();
    const overview = blockOf(bank, 'facts/acme.md', 'Overview');
    expect(facts.remove({ path: 'facts/acme.md', ...overview })).toMatchObject({ ok: false });
    const claim = blockOf(bank, 'facts/acme.md', 'Reminder texts');
    expect(
      facts.remove({ path: 'facts/acme.md', index: claim.index, text: `${claim.text}more` }),
    ).toMatchObject({ ok: false });
    expect(read('facts/acme.md')).toBe(ACME);
  });
});

describe('confirm', () => {
  it('drops `unconfirmed` and gives the user and today as its source', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Reminder texts');
    const bank = bankOf(facts.confirm({ path: 'facts/acme.md', ...block }));
    expect(read('facts/acme.md')).toBe(
      ACME.replace(
        '`unconfirmed` `shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** resume alex.pdf 2026-10-10',
        '`shipped` `solo` `medium`\n> Shipped appointment reminder texts.\n- **Source:** Alex 2026-10-12',
      ),
    );
    expect(blockOf(bank, 'facts/acme.md', 'Reminder texts').tags).toEqual([
      'shipped',
      'solo',
      'medium',
    ]);
  });

  it('says "confirmed" when the user gave no name', () => {
    name = '  ';
    const block = blockOf(facts.read(), 'facts/acme.md', 'Reminder texts');
    bankOf(facts.confirm({ path: 'facts/acme.md', ...block }));
    expect(read('facts/acme.md')).toContain('- **Source:** confirmed 2026-10-12');
  });

  it('leaves alone a claim that’s already confirmed', () => {
    const block = blockOf(facts.read(), 'facts/acme.md', 'Scheduling platform');
    expect(facts.confirm({ path: 'facts/acme.md', ...block })).toEqual({
      ok: false,
      message: 'That fact is already confirmed.',
    });
  });
});

describe('what the user doesn’t have', () => {
  const GAPS =
    "# Gaps\n\n## Doesn't have\n| Topic | Their answer | Date |\n|---|---|---|\n| Rust | No | 2026-10-08 |\n| Kafka | No | 2026-10-12 |\n";

  it('adds a row, and takes one back as the window read it', () => {
    write('facts/gaps.md', GAPS);
    const added = facts.addGap({ topic: 'GraphQL', answer: 'No', date: '2026-10-14' });
    expect(added).toMatchObject({ ok: true, added: true });
    expect(read('facts/gaps.md')).toContain(
      '| Kafka | No | 2026-10-12 |\n| GraphQL | No | 2026-10-14 |\n',
    );
    bankOf(facts.removeGap({ index: 0, line: '| Rust | No | 2026-10-08 |' }));
    expect(read('facts/gaps.md')).not.toContain('Rust');
    // A row that changed since the window read it stays.
    expect(facts.removeGap({ index: 0, line: '| Kafka | Not really | 2026-10-12 |' })).toEqual({
      ok: false,
      message: CHANGED_SINCE,
      changed: true,
    });
    expect(read('facts/gaps.md')).toContain('| Kafka | No | 2026-10-12 |');
  });

  it('starts gaps.md when there’s none, but never in place of a link', () => {
    expect(facts.addGap({ topic: 'GraphQL', answer: 'No', date: '2026-10-14' })).toMatchObject({
      ok: true,
      added: true,
    });
    expect(read('facts/gaps.md')).toContain('| GraphQL | No | 2026-10-14 |');
    rmSync(join(workspace, 'facts', 'gaps.md'));
    symlinkSync(join(outside, 'gaps.md'), join(workspace, 'facts', 'gaps.md'));
    expect(facts.addGap({ topic: 'Kafka', answer: 'No', date: '2026-10-14' }).ok).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('firstNameOf', () => {
  it('takes the first word of a name, or nothing', () => {
    expect(firstNameOf(' Alex  Rivera ')).toBe('Alex');
    expect(firstNameOf('')).toBeNull();
  });
});
