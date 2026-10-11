/** Whether Claude Code is signed in, and how. A Claude plan's method is "subscription". */
export type AuthCheck =
  | { status: 'signed-in'; method?: string; plan?: string }
  | { status: 'signed-out' }
  | { status: 'unreadable' };

/** Reads `claude auth status --json`, the only sign-in check the app makes. */
export function checkAuth(output: string): AuthCheck {
  const json = parseObject(output);
  if (typeof json?.loggedIn !== 'boolean') return { status: 'unreadable' };
  if (!json.loggedIn) return { status: 'signed-out' };
  // Only these fields are kept, never the email or organization.
  const method = asString(json.authMethod);
  return {
    status: 'signed-in',
    method: method === 'claude.ai' ? 'subscription' : method,
    plan: asString(json.subscriptionType),
  };
}

function parseObject(output: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(output);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
