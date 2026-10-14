import { describe, expect, it } from 'vitest';
import { billedByUse, planLevels } from './levels.ts';

describe('the levels that suit the user’s Claude', () => {
  it('are the best overall on every plan but Pro', () => {
    for (const plan of ['max', 'team', 'enterprise']) {
      expect(planLevels(plan, 'subscription')).toBe('best');
    }
    expect(planLevels('pro', 'subscription')).toBe('pro');
  });

  it('are Pro’s wherever every token is billed: an API key, a key helper or a cloud provider', () => {
    for (const method of ['api_key', 'api_key_helper', 'third_party']) {
      expect(billedByUse(method)).toBe(true);
      expect(planLevels(undefined, method)).toBe('pro');
    }
  });

  it('are the best overall when Claude Code doesn’t say the plan', () => {
    // Such as a token from claude setup-token, which runs on a plan it doesn't name.
    expect(planLevels(undefined, 'oauth_token')).toBe('best');
    expect(planLevels(undefined, 'subscription')).toBe('best');
    expect(planLevels()).toBe('best');
    expect(billedByUse(undefined)).toBe(false);
  });
});
