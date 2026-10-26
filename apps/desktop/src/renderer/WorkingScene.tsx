import { type CSSProperties, useId } from 'react';
import type { StepKind } from '../shared/activity.ts';
import styles from './WorkingScene.module.css';

/** A line of text on a page, as a rounded bar. */
const Line = ({
  x,
  y,
  width,
  className = styles.faint,
}: {
  x: number;
  y: number;
  width: number;
  className?: string | undefined;
}) => <rect x={x} y={y} width={width} height={2.4} rx={1.2} className={className} />;

/** Reading: a page turns over onto the one before it, again and again. */
const Reading = () => (
  <>
    <rect x={8} y={8} width={18} height={21} rx={2} className={styles.paper} />
    <rect x={26} y={8} width={18} height={21} rx={2} className={styles.paper} />
    <Line x={11} y={13} width={12} />
    <Line x={11} y={18} width={10} />
    <Line x={11} y={23} width={12} />
    <Line x={29} y={13} width={12} />
    <Line x={29} y={18} width={12} />
    <Line x={29} y={23} width={9} />
    <g className={styles.turn}>
      <rect x={26} y={8} width={18} height={21} rx={2} className={styles.leaf} />
      <Line x={29} y={13} width={12} className={styles.inkFaint} />
      <Line x={29} y={18} width={10} className={styles.inkFaint} />
    </g>
  </>
);

/** Searching: a lens sweeps back and forth over lines of text. */
const Searching = () => (
  <>
    <Line x={7} y={10} width={38} />
    <Line x={7} y={17} width={32} />
    <Line x={7} y={24} width={36} />
    <g className={styles.sweep}>
      <circle cx={14} cy={16} r={6} className={styles.lens} />
      <path d="M18.4 20.4 L23 25" className={styles.handle} />
    </g>
  </>
);

/** Writing: a pen draws a line of handwriting, left to right. */
const Writing = () => (
  <>
    <Line x={8} y={10} width={30} />
    <path
      d="M8 23 C 11 19, 13 26, 16 22.5 S 21 20, 24 23 S 29 25.5, 32 22 S 38 20.5, 42 23"
      pathLength={100}
      className={styles.ink}
    />
    <g className={styles.pen}>
      <path
        d="M11.15 21.2 L16.6 10.3 Q16.9 8.9 15.4 8.4 L13.4 7.5 Q12.1 7.1 11.6 8.4 L7.55 19.4 Z"
        className={styles.penBody}
      />
      <path d="M8 23 L11.15 21.2 L7.55 19.4 Z" className={styles.nib} />
    </g>
  </>
);

/** Checking facts: ticks land in a column of boxes, one after another. */
const Checking = () => (
  <>
    {[8, 15.5, 23].map((y, at) => (
      <g key={y} style={{ '--at': at } as CSSProperties}>
        <rect x={9} y={y} width={6} height={6} rx={1.5} className={styles.box} />
        <Line x={19} y={y + 1.8} width={at === 1 ? 18 : 24} />
        <path
          d={`M10 ${y + 2.6} l2 2.2 l4.2 -5`}
          pathLength={10}
          className={`${styles.tick} ${styles.landing}`}
        />
      </g>
    ))}
  </>
);

/** Building a PDF: a finished page slides out from under the top. */
function Building() {
  // Its own ID, as another strip's picture may be on the page too.
  const slot = useId();
  return (
    <>
      <clipPath id={slot}>
        <rect x={0} y={9} width={52} height={27} />
      </clipPath>
      <g clipPath={`url(#${slot})`}>
        <g className={styles.slide}>
          <rect x={14} y={5} width={24} height={26} rx={1.8} className={styles.paper} />
          <Line x={17} y={10} width={13} className={styles.inkFaint} />
          <Line x={17} y={15} width={18} />
          <Line x={17} y={19.5} width={16} />
          <Line x={17} y={24} width={18} />
        </g>
      </g>
      <rect x={9} y={6.5} width={34} height={3} rx={1.5} className={styles.slot} />
    </>
  );
}

/** Thinking: three dots drift up and down, each a moment after the last. */
const Thinking = () => (
  <>
    {[17, 26, 35].map((cx, at) => (
      <circle
        key={cx}
        cx={cx}
        cy={18}
        r={2.6}
        className={styles.drift}
        style={{ '--at': at } as CSSProperties}
      />
    ))}
  </>
);

/** Helpers at work: a lane for each, side by side, each with a runner going its own pace. */
function Helpers({ lanes }: { lanes: number }) {
  const count = Math.min(Math.max(lanes, 2), 4);
  return (
    <>
      {Array.from({ length: count }, (_, at) => {
        const y = 18 - (count - 1) * 4 + at * 8;
        return (
          <g key={y} style={{ '--at': at } as CSSProperties}>
            <line x1={7} y1={y} x2={45} y2={y} className={styles.lane} />
            <rect
              x={7}
              y={y - 1.8}
              width={8}
              height={3.6}
              rx={1.8}
              className={`${styles.runner} ${styles.dot}`}
            />
          </g>
        );
      })}
    </>
  );
}

/**
 * The working strip's picture of the step Claude is on: pages turning while it reads, a lens
 * sweeping while it searches, a pen drawing while it writes, ticks landing while facts are
 * checked, a page sliding out while a PDF is built, lanes side by side while its helpers work,
 * and drifting dots while it thinks. Small and calm, in the app's colors, so light and dark both
 * suit it, and still for anyone who asks for less motion. The words beside it say the same, so
 * it's hidden from screen readers.
 */
export function WorkingScene({ kind, lanes = 0 }: { kind: StepKind; lanes?: number }) {
  return (
    <span className={styles.scene} data-scene={kind} aria-hidden="true">
      <svg viewBox="0 0 52 36" width={52} height={36} focusable="false" aria-hidden="true">
        {kind === 'reading' && <Reading />}
        {kind === 'searching' && <Searching />}
        {kind === 'writing' && <Writing />}
        {kind === 'checking' && <Checking />}
        {kind === 'building' && <Building />}
        {kind === 'helpers' && <Helpers lanes={lanes} />}
        {kind === 'thinking' && <Thinking />}
      </svg>
    </span>
  );
}
