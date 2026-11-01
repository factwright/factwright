import { decodeEntities } from './posting.ts';

/*
 * A site's robots.txt and sitemaps come from anywhere, so these read them in one pass, as
 * posting.ts reads pages: neither a file with thousands of lines left open nor a rule made of
 * thousands of "*"s takes longer than its length, or a few times it.
 */

/** The name a robots.txt can give Factwright rules by, in a "User-agent:" line of its own. */
const AGENT = 'factwright';
/** How much of one rule is read. No real one comes near this. */
const MAX_RULE = 1_000;
/** The most rules kept, so a huge file can't make every link slow to check. */
const MAX_RULES = 1_000;
/** A link's path and query longer than this goes unread. No real posting's comes near it. */
const MAX_PATH = 4_000;
/** The most sitemaps a robots.txt can name that are kept. */
const MAX_NAMED = 100;
/** The most links read from one sitemap, which the sitemaps protocol puts at 50,000. */
const MAX_LINKS = 100_000;

interface RobotsRule {
  allow: boolean;
  /** How long the rule is as written, as the longest rule that fits decides. */
  length: number;
  /** What's between its "*"s. */
  parts: readonly string[];
  /** Whether it ends in "$", so it fits only up to the path's end. */
  toEnd: boolean;
}

/** What a site's robots.txt says, for Factwright. */
export interface Robots {
  rules: readonly RobotsRule[];
  /** The sitemaps it names. */
  sitemaps: readonly string[];
  /** The seconds it asks for between requests, when it asks. */
  crawlDelay: number | null;
}

/** A site with no robots.txt asks nothing. */
export const NO_ROBOTS: Robots = { rules: [], sitemaps: [], crawlDelay: null };

interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

function robotsRule(allow: boolean, written: string): RobotsRule {
  const toEnd = written.endsWith('$');
  const parts = (toEnd ? written.slice(0, -1) : written).split('*');
  return { allow, length: written.length, parts, toEnd };
}

/**
 * What a robots.txt says for Factwright, by the rules of RFC 9309: the group naming it when there's
 * one, and otherwise the group for everyone. Several groups for the same name count as one.
 */
export function readRobots(text: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let group: RobotsGroup | null = null;
  // A run of User-agent lines names one group, so it ends at the first line of anything else.
  let naming = false;
  for (const line of text.split(/\r\n|\r|\n/)) {
    const comment = line.indexOf('#');
    const content = comment < 0 ? line : line.slice(0, comment);
    const colon = content.indexOf(':');
    if (colon < 0) continue;
    const key = content.slice(0, colon).trim().toLowerCase();
    const value = content
      .slice(colon + 1)
      .trim()
      .slice(0, MAX_RULE);
    if (key === 'user-agent') {
      if (!naming || !group) {
        group = { agents: [], rules: [], crawlDelay: null };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      naming = true;
    } else if (key === 'sitemap') {
      if (value && sitemaps.length < MAX_NAMED) sitemaps.push(value);
    } else {
      naming = false;
      if (!group) continue;
      if (key === 'allow' || key === 'disallow') {
        // "Disallow:" with nothing after it allows everything, as having no rule does.
        if (value) group.rules.push(robotsRule(key === 'allow', value));
      } else if (key === 'crawl-delay') {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) group.crawlDelay = seconds;
      }
    }
  }
  const named = (agent: string) => groups.filter((each) => each.agents.includes(agent));
  const ours = named(AGENT);
  const chosen = ours.length > 0 ? ours : named('*');
  return {
    rules: chosen.flatMap((each) => each.rules).slice(0, MAX_RULES),
    sitemaps,
    crawlDelay: chosen.find((each) => each.crawlDelay !== null)?.crawlDelay ?? null,
  };
}

/**
 * Whether a link's path and query fit a rule, in which "*" stands for any run of characters and a
 * final "$" for the end. Taking each part at the first place it fits leaves the most room for the
 * rest, so nothing needs trying twice.
 */
function fitsRule({ parts, toEnd }: RobotsRule, path: string): boolean {
  const first = parts[0] ?? '';
  if (!path.startsWith(first)) return false;
  let at = first.length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? '';
    if (toEnd && i === parts.length - 1) {
      return path.length - part.length >= at && path.endsWith(part);
    }
    const found = path.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return !toEnd || at === path.length;
}

/**
 * Whether a robots.txt lets Factwright read a link's path and query: the longest rule that fits
 * decides, and between two as long, the one allowing it. With no rule that fits, it may.
 */
export function robotsAllow(robots: Robots, path: string): boolean {
  if (path.length > MAX_PATH) return false;
  let longest = -1;
  let allowed = true;
  for (const rule of robots.rules) {
    if (rule.length < longest || !fitsRule(rule, path)) continue;
    if (rule.length > longest || rule.allow) allowed = rule.allow;
    longest = rule.length;
  }
  return allowed;
}

/** A link in a sitemap, and the day it last changed, when the sitemap says. */
export interface SitemapLink {
  link: string;
  changed: string | null;
}

/** What a sitemap lists: pages, or, for a sitemap index, other sitemaps. */
export interface Sitemap {
  index: boolean;
  links: SitemapLink[];
}

/** What's between a sitemap's tags, without a CDATA wrapper. */
function tagText(inner: string): string {
  const trimmed = inner.trim();
  const wrapped = trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>');
  return wrapped ? trimmed.slice(9, -3).trim() : decodeEntities(trimmed);
}

/** Every link in a sitemap or a sitemap index, in order. */
export function readSitemap(xml: string): Sitemap {
  const links: SitemapLink[] = [];
  let open = xml.indexOf('<loc>');
  while (open >= 0 && links.length < MAX_LINKS) {
    const close = xml.indexOf('</loc>', open + 5);
    // Nothing closes this one, so nothing closes any after it either.
    if (close < 0) break;
    const next = xml.indexOf('<loc>', close + 6);
    const rest = xml.slice(close + 6, next < 0 ? xml.length : next);
    const from = rest.indexOf('<lastmod>');
    const to = from < 0 ? -1 : rest.indexOf('</lastmod>', from);
    const changed = to < 0 ? '' : tagText(rest.slice(from + 9, to));
    const link = tagText(xml.slice(open + 5, close));
    if (link) {
      links.push({
        link,
        changed: /^\d{4}-\d{2}-\d{2}/.test(changed) ? changed.slice(0, 10) : null,
      });
    }
    open = next;
  }
  return { index: xml.includes('<sitemapindex'), links };
}
