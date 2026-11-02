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
  update: string | null = null,
): StatusDeps {
  return {
    find: async () => found,
    run: async (_claude, args) => outputs[args.join(' ')] ?? '',
    inTerminal: vi.fn(async () => typed),
    installed: () => NATIVE,
    update: vi.fn(async () => update),
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
    expect(status).toEqual({ state: 'too-old', version: '2.0.12', minimum: '2.1.295' });
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
      minimum: '2.1.295',
      claude: NATIVE,
    });
    expect(await claudeStatus(offPath({ '--version': 'oops' }))).toEqual({
      state: 'unknown',
      claude: NATIVE,
    });
  });

  it('says what updates a claude too old that a package manager installed', async () => {
    const update = 'brew upgrade claude-code';
    const outputs = { '--version': '2.0.12 (Claude Code)' };
    const tooOld = { state: 'too-old', version: '2.0.12', minimum: '2.1.295', update };
    const onPath = deps(CLAUDE, outputs, null, update);
    expect(await claudeStatus(onPath)).toEqual(tooOld);
    expect(onPath.update).toHaveBeenCalledWith(CLAUDE, true);
    const offPath = deps(CLAUDE, outputs, NATIVE, update);
    expect(await claudeStatus(offPath)).toEqual({ ...tooOld, claude: NATIVE });
    expect(offPath.update).toHaveBeenCalledWith(CLAUDE, false);
  });

  it('asks about a package manager only for a claude that’s too old', async () => {
    const signedOut = deps(
      CLAUDE,
      {
        '--version': '2.1.303 (Claude Code)',
        'auth status --json': JSON.stringify({ loggedIn: false }),
      },
      null,
      'brew upgrade claude-code',
    );
    expect(await claudeStatus(signedOut)).toEqual({ state: 'signed-out', version: '2.1.303' });
    expect(signedOut.update).not.toHaveBeenCalled();
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
