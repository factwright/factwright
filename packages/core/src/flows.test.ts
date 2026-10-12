import { describe, expect, it } from 'vitest';
import { layoutFlows } from './flows.ts';

const SIZE = { width: 300, height: 110, nodeWidth: 10, gap: 10 };

describe('layoutFlows', () => {
  // Ten jobs found: six applied and four never were; of those applied, two got a screen.
  const nodes = [
    { id: 'Found', column: 0 },
    { id: 'Applied', column: 1 },
    { id: 'Screen', column: 2 },
    { id: 'In progress', column: 3 },
    { id: 'No response', column: 3 },
    { id: 'Not applied', column: 3 },
    { id: 'Never reached', column: 2 },
  ];
  const links = [
    { from: 'Found', to: 'Applied', value: 6 },
    { from: 'Found', to: 'Not applied', value: 4 },
    { from: 'Applied', to: 'Screen', value: 2 },
    { from: 'Applied', to: 'No response', value: 4 },
    { from: 'Screen', to: 'In progress', value: 2 },
  ];
  const layout = layoutFlows(nodes, links, SIZE);
  const node = (id: string) => layout.nodes.find((each) => each.id === id);

  it('makes each bar as tall as its count, on one scale, and stacks columns from the top', () => {
    // The last column is fullest: 10 jobs and two gaps in 110 pixels, so 9 pixels a job.
    expect(node('Found')).toMatchObject({ x: 0, y: 0, height: 90, value: 10 });
    expect(node('Applied')).toMatchObject({ x: 96.7, y: 0, height: 54 });
    expect(node('In progress')).toMatchObject({ x: 290, y: 0, height: 18 });
    expect(node('No response')).toMatchObject({ y: 28, height: 36 });
    expect(node('Not applied')).toMatchObject({ y: 74, height: 36 });
  });

  it('leaves out nodes nothing went through', () => {
    expect(node('Never reached')).toBeUndefined();
  });

  it('draws each band from where it leaves one bar to where it arrives at the other', () => {
    const band = (from: string, to: string) =>
      layout.links.find((link) => link.from === from && link.to === to);
    // Found's bands leave in the order of where they go: Applied above Not applied.
    expect(band('Found', 'Applied')?.path).toMatch(/^M10,0C/);
    expect(band('Found', 'Not applied')).toMatchObject({ width: 36 });
    expect(band('Found', 'Not applied')?.path).toMatch(/^M10,54C.* 290,74L290,110C/);
    // Applied's: the screen above no response.
    expect(band('Applied', 'Screen')?.path).toMatch(/^M106.7,0C/);
    expect(band('Applied', 'No response')?.path).toMatch(/^M106.7,18C/);
  });
});
