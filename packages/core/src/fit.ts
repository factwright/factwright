/** How well a job fits, as a fit check or job search rates it, from best to worst. */
export const FIT_TIERS = ['strong', 'good', 'worth', 'long', 'skip'] as const;

export type FitTier = (typeof FIT_TIERS)[number];
