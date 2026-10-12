import { useMemo } from 'react';
import { encode } from 'uqr';
import styles from './SyncDialog.module.css';

/**
 * A QR code for a phone's camera, drawn as one SVG path. It's always dark on white, the way
 * cameras read best, in dark mode too.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    const squares = qr.data.flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])),
    );
    return { size: qr.size, path: squares.join('') };
  }, [value]);
  return (
    <svg
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
