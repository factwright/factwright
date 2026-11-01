import { describe, expect, it } from 'vitest';
import {
  isNewerVersion,
  isVersion,
  MOST_SHORT_LINE_LENGTH,
  MOST_SHORT_LINES,
  shortNotesProblem,
} from './whats-new.ts';

describe('isVersion', () => {
  it('takes a version as releases number them, and nothing else', () => {
    expect(isVersion('0.19.0')).toBe(true);
    expect(isVersion('10.0.12')).toBe(true);
    expect(isVersion('1.0.0-rc.1')).toBe(true);
    expect(isVersion('0.19')).toBe(false);
    expect(isVersion('soon')).toBe(false);
    expect(isVersion('')).toBe(false);
    expect(isVersion(19)).toBe(false);
    expect(isVersion(null)).toBe(false);
  });
});

describe('isNewerVersion', () => {
  it.each([
    ['0.19.0', '0.18.1'],
    ['0.19.1', '0.19.0'],
    ['1.0.0', '0.99.99'],
    // By number, where comparing them as text would have 0.9.3 the newer.
    ['0.10.0', '0.9.3'],
    ['0.19.10', '0.19.9'],
  ])('%s is newer than %s', (version, than) => {
    expect(isNewerVersion(version, than)).toBe(true);
    expect(isNewerVersion(than, version)).toBe(false);
  });

  it('counts a version as no newer than itself', () => {
    expect(isNewerVersion('0.19.0', '0.19.0')).toBe(false);
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0-rc.1')).toBe(false);
  });

  it('counts a prerelease as the version it leads to', () => {
    expect(isNewerVersion('1.0.0-rc.1', '0.19.0')).toBe(true);
    expect(isNewerVersion('1.0.0-rc.2', '1.0.0-rc.1')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(false);
    expect(isNewerVersion('1.0.1', '1.0.0-rc.1')).toBe(true);
  });
});

describe('shortNotesProblem', () => {
  const line = (words: string) => `- ${words}`;

  it('takes a few plain lines, with or without a line break at the end', () => {
    expect(shortNotesProblem(`${line('One')}\n${line('Two')}\n`)).toBeNull();
    expect(shortNotesProblem(line('One'))).toBeNull();
    expect(shortNotesProblem(`${line('One')}\r\n${line('Two')}\r\n`)).toBeNull();
  });

  it('refuses notes with nothing in them', () => {
    expect(shortNotesProblem(' \n\n')).toMatch(/empty/);
  });

  it('refuses more lines than the most it takes', () => {
    const lines = (count: number) => Array.from({ length: count }, () => line('Words')).join('\n');
    expect(shortNotesProblem(lines(MOST_SHORT_LINES))).toBeNull();
    expect(shortNotesProblem(lines(MOST_SHORT_LINES + 1))).toMatch(/at most/);
  });

  it('refuses a line that isn’t in the list', () => {
    expect(shortNotesProblem('A summary first.\n- One')).toMatch(/A summary first/);
    expect(shortNotesProblem('# What’s new\n- One')).toMatch(/What’s new/);
  });

  it('refuses a line too long to read at a glance', () => {
    const atMost = line('x'.repeat(MOST_SHORT_LINE_LENGTH - 2));
    expect(shortNotesProblem(atMost)).toBeNull();
    expect(shortNotesProblem(`${atMost}x`)).toMatch(/characters at most/);
  });
});
