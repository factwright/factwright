// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type RunTab, RunTabs } from './RunTabs.tsx';

afterEach(cleanup);

/** The tabs, with the panel they show, as Claude's panel has them. */
function renderTabs(tabs: RunTab[]) {
  return render(
    <>
      <RunTabs tabs={tabs} selected="run-1" onSelect={vi.fn()} panelId="claude" />
      <div id="claude" role="tabpanel" aria-labelledby="claude-run-1" />
    </>,
  );
}

describe('RunTabs', () => {
  it('says how far a run at work has come on its to-do list, in its tab', () => {
    renderTabs([
      {
        id: 'run-1',
        title: 'Talkiatry · Tailored resume',
        state: 'working',
        step: { at: 3, of: 7 },
      },
      { id: 'run-2', title: 'Acme · Cover letter', state: 'working', step: null },
    ]);
    const resume = screen.getByRole('tab', {
      name: /^Talkiatry · Tailored resume, working, step 3 of 7$/,
    });
    expect(resume.textContent).toContain('3/7');
    const letter = screen.getByRole('tab', { name: /^Acme · Cover letter, working$/ });
    expect(letter.textContent).not.toMatch(/\d\/\d/);
  });

  it('says nothing of the list once a run waits on the user, or is done', () => {
    renderTabs([
      {
        id: 'run-1',
        title: 'Talkiatry · Tailored resume',
        state: 'waiting',
        step: { at: 3, of: 7 },
      },
      { id: 'run-2', title: 'Acme · Cover letter', state: 'done', step: { at: 2, of: 2 } },
    ]);
    expect(
      screen.getByRole('tab', { name: /^Talkiatry · Tailored resume, waiting on you$/ })
        .textContent,
    ).not.toContain('3/7');
    expect(
      screen.getByRole('tab', { name: /^Acme · Cover letter, done$/ }).textContent,
    ).not.toContain('2/2');
  });

  it('finds no accessibility problems', async () => {
    const { container } = renderTabs([
      {
        id: 'run-1',
        title: 'Talkiatry · Tailored resume',
        state: 'working',
        step: { at: 3, of: 7 },
      },
      { id: 'run-2', title: 'Acme · Cover letter', state: 'in-line' },
    ]);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
