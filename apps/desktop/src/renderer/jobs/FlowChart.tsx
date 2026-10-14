import {
  type Journey,
  type JourneyNode,
  type JourneyOutcome,
  type JourneyStage,
  journeyFlows,
  layoutFlows,
} from '@factwright/core';
import type { Tone } from '@factwright/ui';
import { useEffect, useId, useRef, useState } from 'react';
import styles from './FlowChart.module.css';

/** Each step in the tint of the status it matches, as everywhere else in the app. */
const STAGE_TONES: Readonly<Record<JourneyStage, Tone>> = {
  found: 'gray',
  checked: 'slate',
  resume: 'violet',
  applied: 'blue',
  screen: 'teal',
  interview: 'purple',
  final: 'purple',
  offer: 'green',
};

/** How jobs ended: good news green, still going blue, a no red, and silence gray. */
const OUTCOME_TONES: Readonly<Record<JourneyOutcome, Tone>> = {
  'In progress': 'blue',
  'Accepted offer': 'green',
  'Declined offer': 'violet',
  Rejected: 'red',
  Withdrew: 'amber',
  'No response': 'gray',
  'Role closed': 'slate',
  Passed: 'gray',
  'Not applied': 'gray',
};

/** The steps' names, short enough to fit between the columns. Endings keep theirs. */
const SHORT_NAMES: Readonly<Record<JourneyStage, string>> = {
  found: 'Found',
  checked: 'Checked',
  resume: 'Resume',
  applied: 'Applied',
  screen: 'Screen',
  interview: 'Interviews',
  final: 'Final round',
  offer: 'Offer',
};

const nameOf = (node: JourneyNode | undefined, id: string) =>
  node?.kind === 'stage' ? SHORT_NAMES[node.stage] : id;

const toneOf = (node: JourneyNode | undefined): Tone =>
  !node ? 'gray' : node.kind === 'stage' ? STAGE_TONES[node.stage] : OUTCOME_TONES[node.outcome];

const color = (tone: Tone) => `var(--fw-tone-${tone}-fg)`;

/** Room at the right for the last column's labels, and above and below for those at the edges. */
const LABEL_ROOM = 150;
const EDGE = 10;
const HEIGHT = 400;
/** Narrower than this, the labels would run into the next column, so the chart scrolls instead. */
const MIN_WIDTH = 760;

const plural = (count: number) => `${count} job${count === 1 ? '' : 's'}`;

/** The chart's width as it's drawn, so its text stays its own size however wide the window. */
function useWidth(fallback: number) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0);
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { box, width };
}

/**
 * Every path the user's jobs took, drawn as a flow chart (a Sankey diagram): from the jobs found
 * at the left, through each step, to how they ended at the right, each band as thick as the jobs
 * that went that way. Hovering a band says how many.
 */
export function FlowChart({ list }: { list: readonly Journey[] }) {
  const { box, width } = useWidth(672);
  const titleId = useId();
  const descriptionId = useId();
  const { nodes, links } = journeyFlows(list);
  if (links.length === 0) {
    return <p className={styles.empty}>Nothing to draw yet. Jobs show here once you find some.</p>;
  }
  const drawn = Math.max(MIN_WIDTH, width);
  const layout = layoutFlows(nodes, links, {
    width: drawn - LABEL_ROOM,
    height: HEIGHT - 2 * EDGE,
    nodeWidth: 10,
    gap: 16,
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <div ref={box} className={styles.chart}>
      <svg
        className={styles.svg}
        width={drawn}
        height={HEIGHT}
        viewBox={`0 ${-EDGE} ${drawn} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <title id={titleId}>How your jobs moved, from finding them to how they ended</title>
        <desc id={descriptionId}>
          {links.map(({ from, to, value }) => `${from} to ${to}: ${plural(value)}.`).join(' ')}
        </desc>
        <g>
          {layout.links.map((link) => (
            <path
              key={`${link.from}>${link.to}`}
              className={styles.band}
              d={link.path}
              fill={color(toneOf(byId.get(link.to)))}
            >
              <title>{`${link.from} → ${link.to}: ${plural(link.value)}`}</title>
            </path>
          ))}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={10}
                height={Math.max(node.height, 1)}
                rx={2}
                fill={color(toneOf(byId.get(node.id)))}
              >
                <title>{`${node.id}: ${plural(node.value)}`}</title>
              </rect>
              <text
                className={styles.label}
                x={node.x + 16}
                y={node.y + node.height / 2}
                dominantBaseline="middle"
              >
                <tspan className={styles.name}>{nameOf(byId.get(node.id), node.id)}</tspan>
                <tspan className={styles.count} dx={5}>
                  {node.value}
                </tspan>
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
