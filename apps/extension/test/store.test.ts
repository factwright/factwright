import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPLICANT_SYSTEMS } from '../src/applicant-systems.ts';
import { manifest } from '../src/manifest.ts';

/** What each store asks for, in words to paste, and the steps (store/README.md). */
const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'store', 'README.md'),
  'utf8',
);

/** One of the README's parts, by its heading: the listing both stores take, or a store's own. */
const part = (heading: string) =>
  README.split(/^## /m).find((each) => each.startsWith(`${heading}\n`)) ?? '';

/** The words a part has you paste into a store: each quoted line, without its ">". */
const pasted = (text: string) =>
  text
    .split('\n')
    .filter((line) => /^\s*>/.test(line))
    .map((line) => line.replace(/^\s*>\s?/, ''));

/**
 * Other companies' names, which nothing pasted into a store may carry: the applicant systems the
 * job application sites cover, the job sites the extension reads or never fills, and the brands
 * around Factwright. The Chrome Web Store turned the first listing down as keyword spam over a
 * list of job sites. Each is matched as it's written, so a word such as "lever" isn't one.
 */
const OTHERS = [
  ...APPLICANT_SYSTEMS.map((system) => system.name),
  'LinkedIn',
  'Indeed',
  'Glassdoor',
  'ZipRecruiter',
  'Wellfound',
  'Hacker News',
  'Gem',
  'Claude',
  'Anthropic',
  'Google',
  'Apple',
  'Mac',
  'macOS',
  'Microsoft',
  'Windows',
  'GitHub',
  'Stripe',
  'Cloudflare',
];

/** The names some words carry, each as a word of its own. */
const named = (words: string, names: readonly string[]) =>
  names.filter((name) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(words));

describe('the store listing and answers', () => {
  it('name no other company, in anything pasted into either store', () => {
    const lines = pasted(README);
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) expect(named(line, OTHERS), line).toEqual([]);
  });

  it('never name one browser in the other’s store, or either in the listing both take', () => {
    for (const [heading, others] of [
      ['The listing', ['Chrome', 'Chromium', 'Firefox', 'Mozilla']],
      ['Chrome Web Store', ['Firefox', 'Mozilla']],
      ['Firefox Add-ons', ['Chrome', 'Chromium']],
    ] as const) {
      const lines = pasted(part(heading));
      expect(lines.length, heading).toBeGreaterThan(0);
      for (const line of lines) expect(named(line, others), `${heading}: ${line}`).toEqual([]);
    }
  });

  it('give the manifest’s description as the summary, which Chrome keeps to 132 characters', () => {
    const summary = /\*\*Summary\*\*[^\n]*\n> (.+)/.exec(README)?.[1];
    expect(summary).toBe(manifest('chrome', '0.3.0').description);
    expect(summary?.length).toBeLessThanOrEqual(132);
  });
});
