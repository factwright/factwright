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
import type { XRayFile } from './useXRay.ts';
import { XRayDialog } from './XRayDialog.tsx';

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

function apiStub(word: PdfResult, pdf: PdfResult = { ok: true, data: new Uint8Array([1]) }) {
  return {
    readPdf: vi.fn(async () => pdf),
    readWord: vi.fn(async () => word),
    factBank: vi.fn(async () => FACTS),
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
    expect(await screen.findByText('Reads cleanly')).toBeTruthy();
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
