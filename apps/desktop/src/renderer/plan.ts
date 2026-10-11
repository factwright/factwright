const PLAN_NAMES: Readonly<Record<string, string>> = {
  pro: 'Pro plan',
  max: 'Max plan',
  team: 'Team plan',
  enterprise: 'Enterprise plan',
};

/** A Claude plan in plain words, such as "Max plan", when Claude Code reports a known one. */
export function planName(plan: string | undefined): string | undefined {
  return plan ? PLAN_NAMES[plan] : undefined;
}
