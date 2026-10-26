import type { FitTier } from '@factwright/core';
import type { Tone } from '../tokens.ts';
import { Pill } from './Pill.tsx';

/** How each fit tier reads on screen, and its tint. */
export const FIT_TIER_DISPLAY: Readonly<Record<FitTier, { label: string; tone: Tone }>> = {
  strong: { label: 'Strong', tone: 'green' },
  good: { label: 'Good', tone: 'blue' },
  worth: { label: 'Worth a look', tone: 'amber' },
  long: { label: 'Long shot', tone: 'gray' },
  skip: { label: 'Skip', tone: 'gray' },
};

export interface FitBadgeProps {
  /** The fit check's score out of 100, if there is one. */
  score?: number | null;
  tier?: FitTier | null;
}

/** A job's fit, such as "78 · Good", or "Not checked yet" before Claude analyzes it. */
export function FitBadge({ score, tier }: FitBadgeProps) {
  const display = tier ? FIT_TIER_DISPLAY[tier] : undefined;
  const parts = [score ?? undefined, display?.label].filter((part) => part !== undefined);
  return <Pill tone={display?.tone ?? 'gray'}>{parts.join(' · ') || 'Not checked yet'}</Pill>;
}
