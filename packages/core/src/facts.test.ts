import { describe, expect, it } from 'vitest';
import {
  addClaim,
  claimParts,
  claimText,
  confirmClaim,
  factBlocks,
  findBlock,
  leavesCodeOpen,
  removeBlock,
  replaceBlock,
  sectionParts,
  sectionText,
} from './facts.ts';

const FILE = [
  '# Acme Health',
  '',
  '## Overview',
  'Staff engineer, 2021–2026. Built the scheduling platform.',
  '',
  '## Scheduling',
  '',
  '### Scheduling platform',
  '`live` `led-and-built` `high`',
  '> Built a scheduling platform used by 40 clinics, cutting wait times ~30%.',
  '- **Short:** Built scheduling for 40 clinics.',
  '- **Numbers:** 40 clinics; wait times down ~30% (as of 2026-05)',
  '- **Source:** Alex 2026-10-01',
  '',
  '### Reminder texts',
  '`unconfirmed` `shipped` `solo` `medium`',
  '> Shipped appointment reminder texts that cut no-shows.',
  '- **Source:** resume alex.pdf 2026-10-10',
  '',
  "## Don't claim",
  '- Never "HIPAA certified".',
  '',
].join('\n');

describe('factBlocks', () => {
  it('reads each heading and what is under it, and joins back to the file exactly', () => {
    const blocks = factBlocks(FILE);
    expect(blocks.map((block) => [block.level, block.title])).toEqual([
      [1, 'Acme Health'],
      [2, 'Overview'],
      [2, 'Scheduling'],
      [3, 'Scheduling platform'],
      [3, 'Reminder texts'],
      [2, "Don't claim"],
    ]);
    expect(blocks.map((block) => block.text).join('')).toBe(FILE);
    expect(blocks.map((block) => block.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('knows a claim by its tags, and leaves them out of what it says', () => {
    const [, overview, , platform, reminders] = factBlocks(FILE);
    expect(overview?.tags).toBeNull();
    expect(overview?.body).toBe('Staff engineer, 2021–2026. Built the scheduling platform.');
    expect(platform?.tags).toEqual(['live', 'led-and-built', 'high']);
    expect(platform?.body).toMatch(/^> Built a scheduling platform/);
    expect(platform?.body).toMatch(/Alex 2026-10-01$/);
    expect(reminders?.tags).toEqual(['unconfirmed', 'shipped', 'solo', 'medium']);
  });

  it('keeps headings in a code block, such as a format example, inside their block', () => {
    const text = [
      '# Facts',
      '## Claim format',
      '```markdown',
      '### Short claim title',
      '`shipped` `led-and-built` `high`',
      '```',
      '## Tags',
      'Status decides the verbs.',
    ].join('\n');
    const blocks = factBlocks(text);
    expect(blocks.map((block) => block.title)).toEqual(['Facts', 'Claim format', 'Tags']);
    expect(blocks.every((block) => block.tags === null)).toBe(true);
    expect(blocks.map((block) => block.text).join('')).toBe(text);
  });

  it('counts no claims in a file that only explains the bank', () => {
    const blocks = factBlocks(FILE, { claims: false });
    expect(blocks.some((block) => block.tags !== null)).toBe(false);
  });

  it('keeps text before the first heading, and Windows line endings', () => {
    const text = 'Notes first.\r\n\r\n### Kept\r\n`built` `solo` `high`\r\n> Built it.\r\n';
    const blocks = factBlocks(text);
    expect(blocks.map((block) => [block.level, block.title])).toEqual([
      [0, ''],
      [3, 'Kept'],
    ]);
    expect(blocks[0]?.body).toBe('Notes first.');
    expect(blocks[1]?.tags).toEqual(['built', 'solo', 'high']);
    expect(blocks[1]?.body).toBe('> Built it.');
    expect(blocks.map((block) => block.text).join('')).toBe(text);
  });

  it("doesn't take a level-four heading, or a hash without a space, for a block", () => {
    const blocks = factBlocks('### One\n`live` `solo` `high`\n#### Detail\n#hashtag\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.body).toBe('#### Detail\n#hashtag');
  });

  it('reads an empty file as no blocks', () => {
    expect(factBlocks('')).toEqual([]);
  });
});

describe('findBlock', () => {
  const blocks = factBlocks(FILE);
  const platform = blocks[3];

  it('finds a block where it was, whatever blank lines follow it', () => {
    expect(findBlock(blocks, { index: 3, text: platform?.text.trimEnd() ?? '' })).toBe(platform);
  });

  it('finds a block that moved, when only one block reads the same', () => {
    expect(findBlock(blocks, { index: 0, text: platform?.text ?? '' })).toBe(platform);
  });

  it('finds nothing for a block that changed since', () => {
    expect(findBlock(blocks, { index: 3, text: '### Scheduling platform\n`live`' })).toBeNull();
  });

  it('finds nothing when two blocks read the same and neither is where it was', () => {
    const twice = factBlocks('## A\nsame\n\n## A\nsame\n\n## B\n');
    expect(findBlock(twice, { index: 2, text: '## A\nsame\n' })).toBeNull();
    expect(findBlock(twice, { index: 1, text: '## A\nsame\n' })).toBe(twice[1]);
  });
});

describe('replaceBlock', () => {
  it('changes one block and leaves every other byte as it was', () => {
    const [, , , platform] = factBlocks(FILE);
    const next =
      '### Scheduling platform\n`live` `led-and-built` `high`\n> Built it for 41 clinics.';
    const changed = replaceBlock(FILE, { index: 3, text: platform?.text ?? '' }, next);
    expect(changed).toBe(FILE.replace(platform?.text ?? '', `${next}\n\n`));
  });

  it('keeps the file’s Windows line endings', () => {
    const text = '## A\r\nold\r\n\r\n## B\r\nkept\r\n';
    const [a] = factBlocks(text);
    expect(replaceBlock(text, { index: 0, text: a?.text ?? '' }, '## A\nnew\nlines')).toBe(
      '## A\r\nnew\r\nlines\r\n\r\n## B\r\nkept\r\n',
    );
  });

  it('keeps a file without a last line ending as it was', () => {
    const text = '## A\nold';
    expect(replaceBlock(text, { index: 0, text }, '## A\nnew\n\n')).toBe('## A\nnew');
  });

  it('refuses a block that changed since the window read it', () => {
    expect(replaceBlock(FILE, { index: 3, text: '### Gone\n`live`\n' }, '### New')).toBeNull();
  });
});

describe('removeBlock', () => {
  it('takes a claim out, with its blank lines', () => {
    const [, , , platform] = factBlocks(FILE);
    const removed = removeBlock(FILE, { index: 3, text: platform?.text ?? '' });
    expect(removed).toBe(FILE.replace(platform?.text ?? '', ''));
    expect(factBlocks(removed ?? '').map((block) => block.title)).not.toContain(
      'Scheduling platform',
    );
  });

  it('refuses a block that changed since the window read it', () => {
    expect(removeBlock(FILE, { index: 4, text: '### Reminder texts\n`shipped`\n' })).toBeNull();
  });
});

describe('addClaim', () => {
  const claim = '### On-call rotation\n`live` `led-team` `high`\n> Led an on-call rotation.';

  it('puts a new claim after the last one, before the closing sections', () => {
    const added = addClaim(FILE, claim);
    expect(factBlocks(added).map((block) => block.title)).toEqual([
      'Acme Health',
      'Overview',
      'Scheduling',
      'Scheduling platform',
      'Reminder texts',
      'On-call rotation',
      "Don't claim",
    ]);
    expect(added).toContain(
      "- **Source:** resume alex.pdf 2026-10-10\n\n### On-call rotation\n`live` `led-team` `high`\n> Led an on-call rotation.\n\n## Don't claim",
    );
  });

  it('puts it at the end of a file without claims, after a blank line', () => {
    expect(addClaim('# Projects\nNone yet.', claim)).toBe(`# Projects\nNone yet.\n\n${claim}\n`);
    expect(addClaim('# Projects\n', claim)).toBe(`# Projects\n\n${claim}\n`);
    expect(addClaim('', claim)).toBe(`${claim}\n`);
  });

  it('keeps the file’s Windows line endings', () => {
    expect(addClaim('# Projects\r\n', claim)).toBe(
      `# Projects\r\n\r\n${claim.replaceAll('\n', '\r\n')}\r\n`,
    );
  });
});

describe('confirmClaim', () => {
  const [, , , platform, reminders] = factBlocks(FILE);

  it('drops `unconfirmed` and makes the user its source, changing nothing else', () => {
    expect(confirmClaim(reminders?.text ?? '', 'Alex 2026-10-12')).toBe(
      [
        '### Reminder texts',
        '`shipped` `solo` `medium`',
        '> Shipped appointment reminder texts that cut no-shows.',
        '- **Source:** Alex 2026-10-12',
        '',
        '',
      ].join('\n'),
    );
  });

  it('adds a source to a claim without one, before its blank lines', () => {
    const text = '### Kept\n`unconfirmed` `built` `solo` `high`\n> Built it.\n\n';
    expect(confirmClaim(text, 'Alex 2026-10-12')).toBe(
      '### Kept\n`built` `solo` `high`\n> Built it.\n- **Source:** Alex 2026-10-12\n\n',
    );
  });

  it('keeps Windows line endings', () => {
    const text = '### Kept\r\n`unconfirmed` `built`\r\n- **Source:** notes 2026-10-01\r\n';
    expect(confirmClaim(text, 'Alex 2026-10-12')).toBe(
      '### Kept\r\n`built`\r\n- **Source:** Alex 2026-10-12\r\n',
    );
  });

  it('leaves alone a claim that is already confirmed, or text that is not one claim', () => {
    expect(confirmClaim(platform?.text ?? '', 'Alex 2026-10-12')).toBeNull();
    expect(confirmClaim('## Overview\n`unconfirmed`\n', 'Alex 2026-10-12')).toBeNull();
    expect(confirmClaim(`${reminders?.text}${platform?.text}`, 'Alex 2026-10-12')).toBeNull();
  });
});

describe('claimParts and claimText', () => {
  const [, , , platform, reminders] = factBlocks(FILE);

  it('splits a claim into its title, tags, wording and details', () => {
    if (!platform) throw new Error('missing block');
    expect(claimParts(platform)).toEqual({
      title: 'Scheduling platform',
      tags: ['live', 'led-and-built', 'high'],
      tagNote: '',
      wording: 'Built a scheduling platform used by 40 clinics, cutting wait times ~30%.',
      details: [
        '- **Short:** Built scheduling for 40 clinics.',
        '- **Numbers:** 40 clinics; wait times down ~30% (as of 2026-05)',
        '- **Source:** Alex 2026-10-01',
      ].join('\n'),
    });
  });

  it('puts a claim back together exactly as the format writes it', () => {
    for (const block of [platform, reminders]) {
      if (!block) throw new Error('missing block');
      expect(claimText(claimParts(block))).toBe(block.text.trimEnd());
    }
  });

  it('keeps words after the tags, and a wording over several lines', () => {
    const [block] = factBlocks(
      '### A\n`live` `solo` (as of 2026)\n> One\n> two\n- **Source:** x\n',
    );
    if (!block) throw new Error('missing block');
    const parts = claimParts(block);
    expect(parts.tagNote).toBe('(as of 2026)');
    expect(parts.wording).toBe('One\ntwo');
    expect(claimText(parts)).toBe(block.text.trimEnd());
  });

  it('reads a claim without a wording, and leaves a later quote in its details', () => {
    const [block] = factBlocks('### A\n`live`\n- **Source:** x\n> a later note\n');
    if (!block) throw new Error('missing block');
    expect(claimParts(block)).toMatchObject({
      wording: '',
      details: '- **Source:** x\n> a later note',
    });
  });

  it('writes a new claim in the format', () => {
    expect(
      claimText({
        title: ' On-call rotation ',
        tags: ['live', 'led-team', 'high'],
        tagNote: '',
        wording: 'Led an on-call rotation.\n',
        details: '\n- **Source:** Alex 2026-10-12\n\n',
      }),
    ).toBe(
      '### On-call rotation\n`live` `led-team` `high`\n> Led an on-call rotation.\n- **Source:** Alex 2026-10-12',
    );
  });
});

describe('sectionParts and sectionText', () => {
  it('splits a section into its title and what it says, and back', () => {
    const [, , scheduling, , , dontClaim] = factBlocks(FILE);
    for (const block of [scheduling, dontClaim]) {
      if (!block) throw new Error('missing block');
      expect(sectionText(block.level, sectionParts(block))).toBe(block.text.trimEnd());
    }
    if (!dontClaim) throw new Error('missing block');
    expect(sectionParts(dontClaim)).toEqual({
      title: "Don't claim",
      spaced: false,
      body: '- Never "HIPAA certified".',
    });
  });

  it('keeps the blank line after a heading, and text before the first heading', () => {
    const [intro, spaced] = factBlocks('Intro.\n\n## Overview\n\nSaid.\n');
    if (!intro || !spaced) throw new Error('missing block');
    expect(sectionParts(spaced)).toEqual({ title: 'Overview', spaced: true, body: 'Said.' });
    expect(sectionText(2, { title: 'Overview', spaced: true, body: 'Changed.' })).toBe(
      '## Overview\n\nChanged.',
    );
    expect(sectionText(0, sectionParts(intro))).toBe('Intro.');
  });
});

describe('leavesCodeOpen', () => {
  it('knows text that opens a code block and never closes it', () => {
    expect(leavesCodeOpen('## A\n```\ncode')).toBe(true);
    expect(leavesCodeOpen('## A\n```js\ncode\n```\n')).toBe(false);
    expect(leavesCodeOpen('## A\n~~~~\ncode\n~~~\n')).toBe(true);
    expect(leavesCodeOpen('## A\nplain')).toBe(false);
  });
});
