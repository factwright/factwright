// @vitest-environment jsdom
import { builtInTemplate, docxFile, previewResume, type Template } from '@factwright/engine';
import { readDocx } from '@factwright/xray';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi, PdfResult } from '../../shared/api.ts';
import type { FactBank } from '../../shared/facts.ts';
import type { Revision, RevisionState } from '../../shared/revision.ts';
import type { XRayFile } from './useXRay.ts';
import { XRayDialog, type XRayRevise } from './XRayDialog.tsx';

// pdf.js needs a real browser, so a PDF reads as a Word file stands in for it.
const readResumePdf = vi.hoisted(() => vi.fn());
vi.mock('../jobs/pdf.ts', () => ({ readResumePdf }));

/** The made-up resume as a Word file, made by the engine as the app makes it. */
const resumeWord = async () =>
  new Uint8Array(await docxFile(previewResume(), builtInTemplate('classic') as Template));

/** A Word file with its contact details in its header, which many systems skip. */
function headerWord(): Uint8Array {
  const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const body = [
    p('SUMMARY'),
    p(
      'Product manager with eight years in marketplaces. Turns messy problems into clear bets, and ships them with small teams.',
    ),
    p('EXPERIENCE'),
    p('Product Manager 2019 – 2021'),
  ].join('');
  return zipSync({
    'word/document.xml': strToU8(`<w:document ${w}><w:body>${body}</w:body></w:document>`),
    'word/header1.xml': strToU8(
      `<w:hdr ${w}>${p('Jordan Avery')}${p('jordan@example.com · (555) 014-2387')}</w:hdr>`,
    ),
  });
}

beforeAll(() => {
  // jsdom doesn't open dialogs on its own, or scroll.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  HTMLElement.prototype.scrollTo ??= () => {};
});

afterEach(() => {
  cleanup();
  readResumePdf.mockReset();
});

const PDF: XRayFile = { path: 'applications/acme/Resume.pdf', name: 'Resume.pdf', format: 'pdf' };
const WORD: XRayFile = {
  path: 'applications/acme/Resume.docx',
  name: 'Resume.docx',
  format: 'docx',
};

const POSTING = [
  '## What you bring',
  '- SQL and A/B testing',
  '- Experience with Tableau',
  '## Nice to have',
  '- User research',
].join('\n');

/** A fact bank as the window gets it, a file to a block. */
function bank(files: Record<string, string>): FactBank {
  return {
    files: Object.entries(files).map(([path, text]) => ({
      path,
      title: path,
      kind: 'claims',
      blocks: [{ index: 0, level: 0, title: '', text, tags: null, body: text }],
    })),
    skipped: [],
    firstName: 'Jordan',
  };
}

const FACTS = bank({
  'facts/northwind.md':
    '### Repeat booking program\n`shipped` `led-and-built` `high`\n- **Keywords:** user research',
});

function apiStub(
  word: PdfResult,
  pdf: PdfResult = { ok: true, data: new Uint8Array([1]) },
  facts: FactBank = FACTS,
) {
  return {
    readPdf: vi.fn(async () => pdf),
    readWord: vi.fn(async () => word),
    factBank: vi.fn(async () => facts),
    copyText: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as FactwrightApi & {
    readWord: ReturnType<typeof vi.fn>;
    copyText: ReturnType<typeof vi.fn>;
  };
}

describe('XRayDialog', () => {
  it('shows what a system reads, and the posting’s terms with what to do about each', async () => {
    const api = apiStub({ ok: true, data: await resumeWord() });
    render(
      <XRayDialog
        api={api}
        files={[WORD]}
        start={WORD.path}
        posting={async () => POSTING}
        onClose={vi.fn()}
      />,
    );
    // The X-ray's code loads as it reads its first file, which takes longest in the file's first
    // test: half a second, with every package's tests at once.
    expect(await screen.findByText('Reads cleanly', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText('2 of 4 key terms · Nothing to fix')).toBeTruthy();
    const text = screen.getByRole('region', { name: 'The text' });
    expect(within(text).getByText('JORDAN AVERY')).toBeTruthy();
    expect(within(text).getAllByText('Experience').length).toBeGreaterThan(0);
    expect(api.readWord).toHaveBeenCalledWith(WORD.path);
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);

    await userEvent.click(screen.getByText('Keywords'));
    const must = screen.getByRole('region', { name: 'Must-haves' });
    expect(within(must).getByText('SQL')).toBeTruthy();
    expect(
      within(within(must).getByRole('list', { name: 'Real gaps' })).getByText('Tableau'),
    ).toBeTruthy();
    const nice = screen.getByRole('region', { name: 'Nice to have' });
    expect(within(nice).getByText('Add it')).toBeTruthy();
    expect(
      within(nice).getByText('Your fact bank backs it: northwind.md · Repeat booking program.'),
    ).toBeTruthy();
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);

    await userEvent.click(screen.getByText('What it fills in'));
    expect(screen.getByText('jordan.avery@example.com')).toBeTruthy();
    const jobs = screen.getByRole('region', { name: 'Jobs' });
    expect(within(jobs).getByText('Senior Product Manager')).toBeTruthy();
  });

  it('says to check a term first when a file of the fact bank couldn’t be read', async () => {
    const skipped: FactBank = { ...FACTS, skipped: [{ path: 'facts/gaps.md', why: 'big' }] };
    render(
      <XRayDialog
        api={apiStub({ ok: true, data: await resumeWord() }, undefined, skipped)}
        files={[WORD]}
        start={WORD.path}
        posting={async () => POSTING}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('Reads cleanly');
    await userEvent.click(screen.getByText('Keywords'));
    const nice = screen.getByRole('region', { name: 'Nice to have' });
    expect(within(nice).getByText('Check it first')).toBeTruthy();
    expect(within(nice).queryByText('Add it')).toBeNull();
    expect(screen.getByText(/Some of your fact bank’s files couldn’t be read/)).toBeTruthy();
  });

  it('lists a problem with what to do, and shows where it is in the text', async () => {
    const api = apiStub({ ok: true, data: headerWord() });
    render(
      <XRayDialog api={api} files={[WORD]} start={WORD.path} posting={null} onClose={vi.fn()} />,
    );
    expect(await screen.findByText('1 problem reading it')).toBeTruthy();
    const fix = screen.getByRole('region', { name: 'To fix' });
    expect(within(fix).getByText('Your contact details are in the header or footer')).toBeTruthy();
    const show = within(fix).getByRole('button', { name: 'Show it in the text' });
    await userEvent.click(show);
    expect(show.getAttribute('aria-pressed')).toBe('true');
    const text = screen.getByRole('region', { name: 'The text' });
    const line = within(text).getByText('jordan@example.com', { exact: false }).closest('li');
    expect(line?.className).toMatch(/shown/);
    // A screen reader hears what's flagged, too.
    expect(line?.textContent).toContain('(flagged: Headers and footers)');
    expect(within(text).getAllByText('Header')).toHaveLength(2);
  });

  it('says when a file has no text to read, as a scanned page has none', async () => {
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const empty = zipSync({
      'word/document.xml': strToU8(`<w:document ${w}><w:body></w:body></w:document>`),
    });
    render(
      <XRayDialog
        api={apiStub({ ok: true, data: empty })}
        files={[WORD]}
        start={WORD.path}
        posting={async () => POSTING}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('No text to read.')).toBeTruthy();
    expect(screen.getByText('1 problem reading it')).toBeTruthy();
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);
    await userEvent.click(screen.getByText('Keywords'));
    expect(
      screen.getByText('There’s no text in this file to check the posting’s terms in.'),
    ).toBeTruthy();
  });

  it('says keywords need a job’s posting, for a starting resume', async () => {
    render(
      <XRayDialog
        api={apiStub({ ok: true, data: await resumeWord() })}
        files={[WORD]}
        start={WORD.path}
        posting={null}
        onClose={vi.fn()}
      />,
    );
    await screen.findByText('Reads cleanly');
    await userEvent.click(screen.getByText('Keywords'));
    expect(screen.getByText(/Keywords are checked against a job’s posting/)).toBeTruthy();
  });

  it('switches between a resume’s PDF and Word file, and says why one can’t be read', async () => {
    const api = apiStub(
      { ok: true, data: await resumeWord() },
      { ok: false, message: 'That file isn’t in your workspace anymore.' },
    );
    render(
      <XRayDialog
        api={api}
        files={[PDF, WORD]}
        start={PDF.path}
        posting={null}
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That file isn’t in your workspace anymore.',
    );
    expect(screen.getByRole('dialog').textContent).toContain('Resume.pdf');
    await userEvent.click(screen.getByText('Word'));
    expect(await screen.findByText('Reads cleanly')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('Resume.docx');
  });

  it('reads a PDF with pdf.js, and says when it can’t', async () => {
    readResumePdf.mockResolvedValue(readDocx(await resumeWord()));
    const props = { files: [PDF], start: PDF.path, posting: null, onClose: vi.fn() };
    render(<XRayDialog api={apiStub({ ok: false, message: '' })} {...props} />);
    expect(await screen.findByText('Reads cleanly')).toBeTruthy();
    cleanup();
    readResumePdf.mockRejectedValue(new Error('Invalid PDF structure.'));
    render(<XRayDialog api={apiStub({ ok: false, message: '' })} {...props} />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t read this file. Open it in its own app to check it.',
    );
  });

  it('copies the text as a system reads it', async () => {
    const api = apiStub({ ok: true, data: await resumeWord() });
    render(
      <XRayDialog api={api} files={[WORD]} start={WORD.path} posting={null} onClose={vi.fn()} />,
    );
    await screen.findByText('Reads cleanly');
    await userEvent.click(screen.getByRole('button', { name: 'Copy the text' }));
    expect(api.copyText.mock.calls[0]?.[0]).toMatch(/^JORDAN AVERY\nSenior Product Manager\n/);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});

describe('Send for revision', () => {
  /** An X-ray's API that can keep a revision, with where the resume stands as given. */
  function reviseApi(
    word: Uint8Array,
    stands: RevisionState = { last: null, locked: null },
    prepared: { ok: true } | { ok: false; message: string } = { ok: true },
  ) {
    return {
      ...apiStub({ ok: true, data: word }),
      prepareRevision: vi.fn(async () => prepared),
      revisionOf: vi.fn(async () => stands),
      openFile: vi.fn(async () => ({ ok: true }) as const),
    } as unknown as FactwrightApi & {
      prepareRevision: ReturnType<typeof vi.fn>;
      revisionOf: ReturnType<typeof vi.fn>;
      openFile: ReturnType<typeof vi.fn>;
    };
  }

  const revise = (changes: Partial<XRayRevise> = {}): XRayRevise => ({
    jobId: 'acme--staff',
    busy: false,
    start: vi.fn(),
    ...changes,
  });

  /** Opens the X-ray of a job's resume on its Revise tab. */
  async function openRevise(
    api: FactwrightApi,
    plan: XRayRevise,
    { files = [WORD], onClose = vi.fn() }: { files?: XRayFile[]; onClose?: () => void } = {},
  ) {
    render(
      <XRayDialog
        api={api}
        files={files}
        start={files[0]?.path ?? WORD.path}
        posting={async () => POSTING}
        revise={plan}
        onClose={onClose}
      />,
    );
    await screen.findByRole('region', { name: 'The text' });
    await userEvent.click(screen.getByText('Revise'));
  }

  const send = (count: number) =>
    screen.getByRole('button', { name: `Send ${count} for revision` });

  it('ticks what a revision can fix to start, and types only the picked IDs into the run', async () => {
    const api = reviseApi(await resumeWord());
    const plan = revise();
    const onClose = vi.fn();
    await openRevise(api, plan, { onClose });
    // The fact bank backs User research, so it's ticked. Tableau is a gap, to ask about first.
    const add = screen.getByRole('checkbox', { name: 'Add “User research”' }) as HTMLInputElement;
    expect(add.checked).toBe(true);
    const ask = screen.getByRole('checkbox', { name: 'Ask about “Tableau”' }) as HTMLInputElement;
    expect(ask.checked).toBe(false);
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);
    expect(screen.getByText('Nothing goes to your Claude until you send it.')).toBeTruthy();

    await userEvent.click(ask);
    await userEvent.click(send(2));
    expect(api.prepareRevision).toHaveBeenCalledWith({
      jobId: 'acme--staff',
      resume: 'Resume.docx',
      // In the posting's order: its must-haves first.
      findings: [
        expect.objectContaining({ kind: 'question', title: 'Ask about “Tableau”' }),
        expect.objectContaining({ kind: 'content', title: 'Add “User research”' }),
      ],
      before: 'Reads cleanly · 2 of 4 key terms · Nothing to fix',
    });
    const [{ findings }] = api.prepareRevision.mock.calls[0] as [{ findings: { id: string }[] }];
    for (const { id } of findings) expect(id).toMatch(/^term-[0-9a-f]{8}$/);
    // The run gets their IDs alone: none of the posting's words.
    expect(plan.start).toHaveBeenCalledWith({
      skill: 'revise-resume',
      jobId: 'acme--staff',
      resume: 'Resume.docx',
      findings: findings.map(({ id }) => id),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('asks how to fix what comes from the template, before sending it', async () => {
    const api = reviseApi(headerWord());
    const plan = revise();
    await openRevise(api, plan);
    const template = screen.getByRole('region', { name: 'From the template' });
    const header = within(template).getByRole('checkbox', { name: /^Headers and footers/ });
    expect((header as HTMLInputElement).checked).toBe(false);
    await userEvent.click(header);
    expect(screen.getByText('Pick how to fix the template.')).toBeTruthy();
    const button = screen.getByRole('button', { name: /^Send \d+ for revision$/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: /^Fix my template/ }));
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);
    await userEvent.click(button);
    expect(plan.start).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'fix',
        findings: expect.arrayContaining(['check-margins']),
      }),
    );
    expect(api.prepareRevision).toHaveBeenCalledWith(expect.objectContaining({ template: 'fix' }));
  });

  it('starts the picks over for each of the resume’s files', async () => {
    readResumePdf.mockResolvedValue(readDocx(headerWord()));
    await openRevise(reviseApi(headerWord()), revise(), { files: [PDF, WORD] });
    await userEvent.click(screen.getByRole('checkbox', { name: /^Headers and footers/ }));
    await userEvent.click(screen.getByRole('radio', { name: /^Fix my template/ }));
    await userEvent.click(screen.getByText('Word'));
    await screen.findByRole('checkbox', { name: /^Headers and footers/ });
    const header = screen.getByRole('checkbox', { name: /^Headers and footers/ });
    expect((header as HTMLInputElement).checked).toBe(false);
    await userEvent.click(header);
    // The template's choice starts over too.
    expect(screen.getByText('Pick how to fix the template.')).toBeTruthy();
  });

  it('says why it can’t send: the app says it stays as sent, or Claude is busy or not ready', async () => {
    const locked = 'You applied with this resume, so it stays as you sent it.';
    await openRevise(reviseApi(await resumeWord(), { last: null, locked }), revise());
    expect(await screen.findByText(locked)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /for revision$/ })).toBeNull();
    cleanup();

    await openRevise(reviseApi(await resumeWord()), revise({ busy: true }));
    expect(
      await screen.findByText('Your Claude is busy with another run. Send this once it’s done.'),
    ).toBeTruthy();
    expect((send(1) as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    await openRevise(reviseApi(await resumeWord()), revise({ start: null }));
    expect(
      await screen.findByText(
        'Your Claude isn’t ready yet. The card in the sidebar says what to do.',
      ),
    ).toBeTruthy();
    expect((send(1) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says why when the previous version couldn’t be kept, and starts nothing', async () => {
    const message = 'Couldn’t keep the resume’s previous version, so nothing changed.';
    const plan = revise();
    await openRevise(
      reviseApi(await resumeWord(), { last: null, locked: null }, { ok: false, message }),
      plan,
    );
    await userEvent.click(send(1));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect(plan.start).not.toHaveBeenCalled();
  });

  /** A revision of the resume, by the titles it picked, with each one's ID as this X-ray gives it. */
  async function revisionOf(titles: readonly string[], at = '2026-10-15T10:00:00.000Z') {
    const { xray, findingsOf } = await import('@factwright/xray');
    const shown = findingsOf(
      xray(readDocx(await resumeWord()), { posting: POSTING, facts: null, bank: 'all' }),
    );
    const previous = 'applications/acme/previous/2026-10-15-050000';
    const last: Revision = {
      at,
      resume: 'Resume.docx',
      findings: titles.map((title) => {
        const finding = shown.find((each) => each.title === title);
        return finding
          ? { id: finding.id, kind: finding.kind, title }
          : { id: 'check-dates', kind: 'content', title };
      }),
      before: '1 problem reading it · 1 of 4 key terms',
      previous,
      files: [`${previous}/Resume.docx`],
    };
    return last;
  }

  it('shows what the last revision fixed, once the resume’s been rebuilt', async () => {
    const last = await revisionOf([
      'Dates: 2 jobs with dates some systems can’t read',
      'Ask about “Tableau”',
    ]);
    // A term this X-ray doesn't list, such as from a posting that's changed, wasn't checked.
    last.findings.push({ id: 'term-00000000', kind: 'content', title: 'Add “Kafka”' });
    const api = reviseApi(await resumeWord(), { last, locked: null });
    await openRevise(api, revise(), { files: [{ ...WORD, modified: '2026-10-15T10:20:00.000Z' }] });
    expect(api.revisionOf).toHaveBeenCalledWith('acme--staff', 'Resume.docx');
    expect(screen.getByRole('status').textContent).toMatch(
      /Revised Oct 15(, 2026)?: 1 of 2 fixed · 1 not checked · 2 of 4 key terms/,
    );
    const revised = screen.getByRole('region', { name: /^Revised Oct 15/ });
    expect(revised.textContent).toContain('1 of 2 fixed · 1 not checked · Before: 1 problem');
    const outcome = (title: string) =>
      within(revised).getByText(title).closest('li')?.textContent ?? '';
    expect(outcome('Dates: 2 jobs with dates some systems can’t read')).toContain('Fixed');
    expect(outcome('Ask about “Tableau”')).toContain('Still there');
    expect(outcome('Add “Kafka”')).toContain('Not checked this time');
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);
    await userEvent.click(
      within(revised).getByRole('button', { name: 'Open the previous version' }),
    );
    expect(api.openFile).toHaveBeenCalledWith(last.files[0]);
  });

  it('says a revision was sent, until the resume’s rebuilt, even while Claude isn’t ready', async () => {
    const last = await revisionOf(['Ask about “Tableau”']);
    await openRevise(
      reviseApi(await resumeWord(), { last, locked: null }),
      revise({ start: null }),
      {
        files: [{ ...WORD, modified: '2026-10-15T09:00:00.000Z' }],
      },
    );
    const sent = screen.getByRole('region', { name: /^Sent for revision Oct 15/ });
    expect(sent.textContent).toContain('The resume hasn’t been rebuilt since.');
    expect(within(sent).queryByRole('button', { name: 'Open the previous version' })).toBeNull();
    expect(screen.getByRole('status').textContent).not.toContain('Revised');
  });
});
