/**
 * The levels Factwright suggests for the user's Claude, until they choose their own: the best
 * overall, or Pro's, which use less. Pro's suit a Pro plan, whose limits are the tightest, and any
 * way of signing in that bills every token.
 */
export type PlanLevels = 'best' | 'pro';

/**
 * Ways of signing in to Claude Code that bill every token, by its names for them: an API key,
 * which signing in with a Console account makes too, a key from a helper, and a cloud provider
 * such as Amazon Bedrock.
 */
const BILLED_BY_USE: readonly string[] = ['api_key', 'api_key_helper', 'third_party'];

/** Whether the way the user signs in bills every token, by Claude Code's name for it. */
export const billedByUse = (method: string | undefined): boolean =>
  method !== undefined && BILLED_BY_USE.includes(method);

/**
 * The suggested levels for the user's plan, such as "pro" or "max", and the way they sign in.
 * Claude Code doesn't say which Max tier or kind of Team seat someone has, so every plan but Pro
 * gets the best overall.
 */
export const planLevels = (plan?: string, method?: string): PlanLevels =>
  plan === 'pro' || billedByUse(method) ? 'pro' : 'best';
