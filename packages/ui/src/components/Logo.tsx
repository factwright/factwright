import { MARK_VIEWBOX, markCut } from '../brand.ts';

/**
 * Factwright's mark: two lines on one thread, traced down to the fact behind them. Sizes up to
 * 28 px get a heavier cut, so the rings stay open.
 */
export function Logo({ size = 24 }: { size?: number }) {
  const cut = markCut(size);
  const color = 'var(--fw-accent)';
  return (
    <svg width={size} height={size} viewBox={MARK_VIEWBOX} aria-hidden="true">
      <path
        d={cut.links.map(([x, top, bottom]) => `M${x} ${top}V${bottom}`).join('')}
        stroke={color}
        strokeWidth={cut.linkStroke}
      />
      {cut.rings.map(([cx, cy]) => (
        <circle
          key={cy}
          cx={cx}
          cy={cy}
          r={cut.ringRadius}
          fill="none"
          stroke={color}
          strokeWidth={cut.ringStroke}
        />
      ))}
      <circle cx={cut.dot[0]} cy={cut.dot[1]} r={cut.dot[2]} fill={color} />
      {cut.lines.map(([x, y, width]) => (
        <rect
          key={y}
          x={x}
          y={y}
          width={width}
          height={cut.lineHeight}
          rx={cut.lineHeight / 2}
          fill={color}
        />
      ))}
    </svg>
  );
}
