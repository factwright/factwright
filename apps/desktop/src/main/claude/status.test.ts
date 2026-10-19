import { describe, expect, it, vi } from 'vitest';
import { claudeStatus, type StatusDeps } from './status.ts';

const CLAUDE = '/Users/someone/.local/bin/claude';
const NATIVE = '& "$env:USERPROFILE\\.local\\bin\\claude.exe"';
const SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
});

/** A computer where `claude` is at `found`, answering with `outputs`, on a terminal's PATH. */
function deps(
  found: string | null,
  outputs: Record<string, string>,
  typed: string | null = null,
): StatusDeps {
  return {
    find: async () => found,
    run: async (_claude, args) => outputs[args.join(' ')] ?? '',
    inTerminal: vi.fn(async () => typed),
    installed: () => NATIVE,
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

  it('says when claude is missing, and where its installer will put it', async () => {
    // A new terminal may not find it there by name, so the window's steps start it by its path.
    expect(await claudeStatus(deps(null, {}))).toEqual({ state: 'missing', claude: NATIVE });
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

  it('says what to type for a claude a new terminal doesn’t find by name', async () => {
    const offPath = (outputs: Record<string, string>) => deps(CLAUDE, outputs, NATIVE);
    expect(
      await claudeStatus(
        offPath({
          '--version': '2.1.303 (Claude Code)',
          'auth status --json': JSON.stringify({ loggedIn: false }),
        }),
      ),
    ).toEqual({ state: 'signed-out', version: '2.1.303', claude: NATIVE });
    expect(await claudeStatus(offPath({ '--version': '2.0.12 (Claude Code)' }))).toEqual({
      state: 'too-old',
      version: '2.0.12',
      minimum: '2.1.270',
      claude: NATIVE,
    });
    expect(await claudeStatus(offPath({ '--version': 'oops' }))).toEqual({
      state: 'unknown',
      claude: NATIVE,
    });
  });

  it('never asks how a terminal finds a claude that’s ready, as the window shows no command', async () => {
    const ready = deps(
      CLAUDE,
      { '--version': '2.1.303 (Claude Code)', 'auth status --json': SIGNED_IN },
      NATIVE,
    );
    expect(await claudeStatus(ready)).toEqual({
      state: 'ready',
      version: '2.1.303',
      plan: 'max',
      method: 'subscription',
    });
    expect(ready.inTerminal).not.toHaveBeenCalled();
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
