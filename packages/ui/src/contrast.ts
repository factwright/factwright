/** WCAG's minimum contrast for normal text (AA). */
export const TEXT_CONTRAST = 4.5;

/** WCAG's minimum contrast for the parts of a control that identify it (AA). */
export const CONTROL_CONTRAST = 3;

/** The WCAG contrast ratio of two #RRGGBB colors, from 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB color: ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => linear(Number.parseInt(part, 16) / 255)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
