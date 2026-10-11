import { describe, expect, it } from 'vitest';
import { checkVersion, MIN_VERSION } from './version.ts';

describe('checkVersion', () => {
  it('reads the version Claude Code prints', () => {
    expect(checkVersion('2.1.296 (Claude Code)\n')).toEqual({ status: 'ok', version: '2.1.296' });
  });

  it('accepts the minimum version itself', () => {
    expect(checkVersion(`${MIN_VERSION} (Claude Code)`)).toEqual({
      status: 'ok',
      version: MIN_VERSION,
    });
  });

  it.each(['2.1.1000', '2.10.0', '3.0.0'])('compares %s part by part, as numbers', (version) => {
    expect(checkVersion(`${version} (Claude Code)`)).toEqual({ status: 'ok', version });
  });

  it.each(['2.1.269', '2.0.999', '1.9.400'])('flags %s as too old', (version) => {
    expect(checkVersion(`${version} (Claude Code)`)).toEqual({ status: 'too-old', version });
  });

  it.each([
    '',
    'zsh: command not found: claude',
    '2.1 (Claude Code)',
    'Error: Node.js 18.0.0 is not supported',
  ])('cannot read %j', (output) => {
    expect(checkVersion(output)).toEqual({ status: 'unreadable' });
  });
});
