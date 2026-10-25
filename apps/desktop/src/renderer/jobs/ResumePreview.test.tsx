// @vitest-environment jsdom
import type { Job, JobFile } from '@factwright/core';
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
    downloadFile: vi.fn(async () => ({ ok: true, saved: true }) as const),
    showFile: vi.fn(async () => ({ ok: true }) as const),
    platform: 'darwin',
  } as unknown as FactwrightApi & {
    readPdf: ReturnType<typeof vi.fn>;
    openFile: ReturnType<typeof vi.fn>;
    downloadFile: ReturnType<typeof vi.fn>;
    showFile: ReturnType<typeof vi.fn>;
  };
}

/** A job whose own files are these; only they matter here. */
const jobWith = (files: JobFile[]) =>
  ({ id: 'acme--staff-engineer', files, letters: [], projectPages: [] }) as unknown as Job;

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

  it('saves a copy of a job’s own file, or shows it in Finder, and says when it can’t', async () => {
    drawPages.mockResolvedValue([{ number: 1, ...PAGE }]);
    const api = apiStub({ ok: true, data: new Uint8Array([37]) });
    render(<ResumePreview file={FILE} api={api} job={jobWith([FILE])} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(api.downloadFile).toHaveBeenCalledWith('acme--staff-engineer', FILE.path);
    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect(api.showFile).toHaveBeenCalledWith('acme--staff-engineer', FILE.path);
    api.showFile.mockResolvedValueOnce({
      ok: false,
      message: 'That file isn’t in your workspace anymore.',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Show in Finder' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That file isn’t in your workspace anymore.',
    );
  });

  it('offers neither for a file the job doesn’t list, such as an earlier version', async () => {
    drawPages.mockResolvedValue([{ number: 1, ...PAGE }]);
    const api = apiStub({ ok: true, data: new Uint8Array([37]) });
    const earlier = { ...FILE, path: 'applications/2026-10-07-acme/previous/1/Resume.pdf' };
    render(<ResumePreview file={earlier} api={api} job={jobWith([FILE])} onClose={vi.fn()} />);
    expect(await screen.findByRole('img', { name: 'Page 1 of 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show in Finder' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in your PDF app' })).toBeTruthy();
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
