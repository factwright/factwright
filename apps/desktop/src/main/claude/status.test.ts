import { describe, expect, it } from 'vitest';
import { claudeStatus, type StatusDeps } from './status.ts';

const CLAUDE = '/Users/someone/.local/bin/claude';
const SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
});

function deps(found: string | null, outputs: Record<string, string>): StatusDeps {
  return {
    find: async () => found,
    run: async (_claude, args) => outputs[args.join(' ')] ?? '',
  };
}

describe('claudeStatus', () => {
  it('is ready when claude is new enough and signed in', async () => {
    const status = await claudeStatus(
      deps(CLAUDE, { '--version': '2.1.296 (Claude Code)', 'auth status --json': SIGNED_IN }),
    );
    expect(status).toEqual({
      state: 'ready',
      version: '2.1.296',
      plan: 'max',
      method: 'subscription',
    });
  });

  it('says how it signs in, when that isn’t a plan', async () => {
    const status = await claudeStatus(
      deps(CLAUDE, {
        '--version': '2.1.296 (Claude Code)',
        'auth status --json': JSON.stringify({ loggedIn: true, authMethod: 'api_key' }),
      }),
    );
    expect(status).toEqual({ state: 'ready', version: '2.1.296', method: 'api_key' });
  });

  it('says when claude is missing', async () => {
    expect(await claudeStatus(deps(null, {}))).toEqual({ state: 'missing' });
  });

  it('says when claude is too old, without checking sign-in', async () => {
    const status = await claudeStatus(
      deps(CLAUDE, { '--version': '2.0.12 (Claude Code)', 'auth status --json': SIGNED_IN }),
    );
    expect(status).toEqual({ state: 'too-old', version: '2.0.12', minimum: '2.1.270' });
  });

  it('says when claude is signed out', async () => {
    const status = await claudeStatus(
      deps(CLAUDE, {
        '--version': '2.1.296 (Claude Code)',
        'auth status --json': JSON.stringify({ loggedIn: false }),
      }),
    );
    expect(status).toEqual({ state: 'signed-out', version: '2.1.296' });
  });

  it("is unknown when claude's answers can't be read", async () => {
    expect(await claudeStatus(deps(CLAUDE, { '--version': 'command not found' }))).toEqual({
      state: 'unknown',
    });
    expect(
      await claudeStatus(deps(CLAUDE, { '--version': '2.1.296', 'auth status --json': 'oops' })),
    ).toEqual({ state: 'unknown' });
  });
});
