import { FIT_TIERS, JOB_STATUSES } from '@factwright/core';
import { render } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { Button } from './components/Button.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { FitBadge } from './components/FitBadge.tsx';
import { IconButton } from './components/IconButton.tsx';
import { Logo } from './components/Logo.tsx';
import { Markdown } from './components/Markdown.tsx';
import { MoodBadge } from './components/MoodBadge.tsx';
import { NavItem } from './components/NavItem.tsx';
import { Notice } from './components/Notice.tsx';
import { RUN_STATES, RunStatus } from './components/RunStatus.tsx';
import { ScoreBar } from './components/ScoreBar.tsx';
import { SearchField } from './components/SearchField.tsx';
import { SegmentedControl } from './components/SegmentedControl.tsx';
import { Stat } from './components/Stat.tsx';
import { StatusPill } from './components/StatusPill.tsx';
import { StatusSelect } from './components/StatusSelect.tsx';
import { VisuallyHidden } from './components/VisuallyHidden.tsx';

describe('accessibility', () => {
  it('finds no problems in any component', async () => {
    const { container } = render(
      <main>
        <Button variant="primary">Add job</Button>
        <Button disabled>Run</Button>
        <IconButton label="Settings" icon={<svg aria-hidden="true" />} />
        <SearchField label="Search jobs" shortcut="⌘K" />
        <SegmentedControl
          label="Views"
          options={[
            { value: 'active', label: 'Active', count: 7 },
            { value: 'closed', label: 'Closed' },
          ]}
          value="active"
          onChange={() => {}}
        />
        <nav aria-label="Main">
          <NavItem icon={null} label="Jobs" count={18} current />
          <NavItem icon={null} label="Fact bank" />
        </nav>
        {JOB_STATUSES.map((status) => (
          <StatusPill key={status} status={status} />
        ))}
        {FIT_TIERS.map((tier) => (
          <FitBadge key={tier} score={70} tier={tier} />
        ))}
        <FitBadge />
        {RUN_STATES.map((state) => (
          <RunStatus key={state} state={state} />
        ))}
        <Stat label="Needs you" value={2} detail="1 follow-up" tone="need" />
        <Notice title="How to apply">Apply on their careers page.</Notice>
        <StatusSelect status="applied" label="Status for Acme Robotics" onChange={() => {}} />
        <MoodBadge mood="mixed" />
        <ScoreBar label="Work" points={33} max={40}>
          Build tooling at scale
        </ScoreBar>
        <Markdown
          text={
            '# Posting\n\nBuild **tools**. See [the team](https://acme.example).\n\n- One\n  - Two'
          }
        />
        <VisuallyHidden>Only for screen readers</VisuallyHidden>
        <Logo />
        <EmptyState title="No jobs yet" icon={<svg aria-hidden="true" />}>
          Jobs you find show up here.
        </EmptyState>
      </main>,
    );
    // jsdom can't lay out a page, so contrast is checked from the tokens in contrast.test.ts.
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
