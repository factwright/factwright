// @vitest-environment jsdom
import type { JobFile } from '@factwright/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FactwrightApi, PdfResult } from '../../shared/api.ts';
import { ResumePreview } from './ResumePreview.tsx';

// pdf.js needs a real canvas, so the test draws made-up pages instead.
const drawPages = vi.hoisted(() => vi.fn());
vi.mock('./pdf.ts', () => ({ drawPages }));

beforeAll(() => {
  // jsdom doesn't open dialogs on its own.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  cleanup();
  drawPages.mockReset();
});

const FILE: JobFile = {
  path: 'applications/2026-10-07-acme/AlexRiveraResume10072026_Acme.pdf',
  name: 'AlexRiveraResume10072026_Acme.pdf',
  format: 'pdf',
  size: 61_440,
  modified: '2026-10-07T12:00:00.000Z',
};
const PAGE = { width: 660, height: 854, url: 'data:image/png;base64,iVBORw0KGgo=' };

function apiStub(read: PdfResult) {
  return {
    readPdf: vi.fn(async () => read),
    openFile: vi.fn(async () => ({ ok: true }) as const),
  } as unknown as FactwrightApi & {
    readPdf: ReturnType<typeof vi.fn>;
    openFile: ReturnType<typeof vi.fn>;
  };
}

describe('ResumePreview', () => {
  it('draws every page of the resume, and opens it in the user’s PDF app', async () => {
    const data = new Uint8Array([37, 80, 68, 70]);
    drawPages.mockResolvedValue([
      { number: 1, ...PAGE },
      { number: 2, ...PAGE },
    ]);
    const api = apiStub({ ok: true, data });
    render(<ResumePreview file={FILE} api={api} onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Drawing the pages…');
    expect(await screen.findByRole('img', { name: 'Page 2 of 2' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Page 1 of 2' })).toBeTruthy();
    expect(screen.getByText('2 pages')).toBeTruthy();
    expect(api.readPdf).toHaveBeenCalledWith(FILE.path);
    expect(drawPages).toHaveBeenCalledWith(data, 660);
    expect((await axe.run(screen.getByRole('dialog'))).violations).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Open in your PDF app' }));
    expect(api.openFile).toHaveBeenCalledWith(FILE.path);
  });

  it('says why when it can’t show the pages', async () => {
    render(
      <ResumePreview
        file={FILE}
        api={apiStub({ ok: false, message: 'That file isn’t in your workspace anymore.' })}
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That file isn’t in your workspace anymore.',
    );
    expect(drawPages).not.toHaveBeenCalled();
    cleanup();
    drawPages.mockRejectedValue(new Error('Invalid PDF structure.'));
    render(
      <ResumePreview
        file={FILE}
        api={apiStub({ ok: true, data: new Uint8Array() })}
        onClose={vi.fn()}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Couldn’t show this PDF here. Open it instead.',
    );
  });
});
