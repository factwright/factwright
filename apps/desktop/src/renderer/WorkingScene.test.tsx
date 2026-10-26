// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StepKind } from '../shared/activity.ts';
import { WorkingScene } from './WorkingScene.tsx';

afterEach(cleanup);

const KINDS: StepKind[] = [
  'reading',
  'searching',
  'writing',
  'checking',
  'building',
  'helpers',
  'thinking',
];

describe('WorkingScene', () => {
  it.each(KINDS)('draws %s, hidden from screen readers, as the words say it too', (kind) => {
    const { container } = render(<WorkingScene kind={kind} lanes={2} />);
    const scene = container.querySelector('[data-scene]');
    expect(scene?.getAttribute('data-scene')).toBe(kind);
    expect(scene?.getAttribute('aria-hidden')).toBe('true');
    expect(scene?.querySelector('svg')?.children.length).toBeGreaterThan(0);
  });

  it('draws a lane for each helper, from two to four', () => {
    const lanes = (count: number) =>
      render(<WorkingScene kind="helpers" lanes={count} />).container.querySelectorAll('line')
        .length;
    expect(lanes(1)).toBe(2);
    expect(lanes(3)).toBe(3);
    expect(lanes(9)).toBe(4);
  });

  it('gives each picture of a page sliding out a clip of its own', () => {
    const { container } = render(
      <>
        <WorkingScene kind="building" />
        <WorkingScene kind="building" />
      </>,
    );
    const clips = [...container.querySelectorAll('clipPath')].map((clip) => clip.id);
    expect(new Set(clips).size).toBe(2);
    for (const id of clips)
      expect(container.querySelector(`[clip-path="url(#${id})"]`)).not.toBeNull();
  });
});
