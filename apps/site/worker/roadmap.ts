import type { Idea, Status } from './ideas.ts';

/**
 * The roadmap page, as the Worker fills it in: the roadmap's three columns, planned, in progress
 * and shipped, and the ideas to vote on. The page reads fine without its script, and search
 * engines see the ideas too. Its script makes the votes work, and sends suggestions.
 */

/** The lists the Worker fills in on roadmap.html. */
export const LISTS = [
  'planned',
  'in-progress',
  'shipped',
  'considering',
] as const satisfies readonly Status[];

export type List = (typeof LISTS)[number];

/** Where the Worker puts a list's ideas in roadmap.html, which has each once. */
export const ideasSlot = (list: List) => `data-ideas="${list}"></ol>`;

/** Where it puts how many ideas a column of the roadmap has. */
export const countSlot = (list: List) => `data-ideas-count="${list}"></span>`;

/** How many shipped ideas the roadmap shows, newest first. The releases have the rest. */
export const SHIPPED_SHOWN = 10;

/** Each release, with what changed in it. */
const RELEASES = 'https://github.com/factwright/factwright/releases';

/** What a list says while it's empty. */
const EMPTY: Readonly<Record<List, string>> = {
  planned: 'Nothing planned yet.',
  'in-progress': 'Nothing in progress right now.',
  shipped: 'Nothing shipped from here yet.',
  considering: 'No ideas to vote on yet. <a href="#suggest">Suggest the first one</a>.',
};

/** What each list says when the ideas can't be read. */
const UNAVAILABLE = 'This couldn’t load just now. Try again in a minute.';

/** Some text, safe to put in a page. */
const htmlText = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (letter) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[letter] ?? letter,
  );

/** How many votes, in words, for screen readers: "1 vote", "12 votes". */
export const votesWord = (votes: number) => (votes === 1 ? ' vote' : ' votes');

/**
 * An idea's vote button: its count, pressed once this browser votes, which the page's script
 * works out and turns on. Without the script, it shows the count.
 */
function voteButton(idea: Idea, small: boolean): string {
  return [
    `<button class="vote${small ? ' vote-sm' : ''}" type="button" aria-pressed="false" aria-describedby="idea-${htmlText(idea.id)}" data-vote disabled>`,
    '<svg class="icon" aria-hidden="true"><use href="#i-up" /></svg>',
    '<span class="visually-hidden">Vote, </span>',
    `<span class="vote-count" data-votes>${idea.votes}</span>`,
    `<span class="visually-hidden" data-votes-word>${votesWord(idea.votes)}</span>`,
    '</button>',
  ].join('');
}

/** The idea's ID and the ones merged into it, for the page's script to find this browser's vote. */
const voteData = (idea: Idea) =>
  ` data-idea="${htmlText(idea.id)}" data-merged="${htmlText(idea.merged.join(' '))}"`;

/** An idea's few lines, when it has them. New lines stay, as the page shows them. */
const wordsOf = (idea: Idea, kind: string) =>
  idea.words ? `<p class="${kind}-words">${htmlText(idea.words)}</p>` : '';

/** A card in one of the roadmap's columns. A shipped one links to the release it came in. */
function roadCard(idea: Idea): string {
  const title = `<h4 class="road-card-title" id="idea-${htmlText(idea.id)}">${htmlText(idea.title)}</h4>`;
  if (idea.status === 'shipped') {
    const version = htmlText(idea.version ?? '');
    return [
      '<li class="road-card">',
      title,
      wordsOf(idea, 'road-card'),
      `<div class="road-card-foot"><a class="road-version" href="${RELEASES}/tag/v${version}"><svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>Shipped in ${version}</a></div>`,
      '</li>',
    ].join('\n');
  }
  return [
    `<li class="road-card"${voteData(idea)}>`,
    title,
    wordsOf(idea, 'road-card'),
    `<div class="road-card-foot">${voteButton(idea, true)}</div>`,
    '</li>',
  ].join('\n');
}

/** An idea to vote on, with its vote button beside it. */
function ideaItem(idea: Idea): string {
  return [
    `<li class="idea"${voteData(idea)}>`,
    voteButton(idea, false),
    '<div class="idea-text">',
    `<h3 class="idea-title" id="idea-${htmlText(idea.id)}">${htmlText(idea.title)}</h3>`,
    wordsOf(idea, 'idea'),
    '</div>',
    '</li>',
  ].join('\n');
}

/** A version's parts, to put the newest first: 0.20.0 after 0.9.0, and 0.20.0-beta.1 before 0.20.0. */
function versionParts(version: string | null): number[] {
  const [release = '', pre] = (version ?? '').split('-');
  return [...release.split('.').map(Number), pre === undefined ? 1 : 0];
}

/** Newest version first. */
function newestFirst(a: Idea, b: Idea): number {
  const [left, right] = [versionParts(a.version), versionParts(b.version)];
  for (let part = 0; part < Math.max(left.length, right.length); part += 1) {
    const difference = (right[part] ?? 0) - (left[part] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** A list's items: its ideas, what it says while it's empty, or that they couldn't be read. */
function listItems(list: List, ideas: readonly Idea[] | null): string {
  if (!ideas) return `<li class="road-empty">${UNAVAILABLE}</li>`;
  if (ideas.length === 0) return `<li class="road-empty">${EMPTY[list]}</li>`;
  if (list === 'considering') return ideas.map(ideaItem).join('\n');
  const shown = list === 'shipped' ? ideas.slice(0, SHIPPED_SHOWN) : ideas;
  const more =
    ideas.length > shown.length
      ? `<li class="road-more"><a href="${RELEASES}">Earlier releases on GitHub</a></li>`
      : '';
  return [...shown.map(roadCard), more].join('\n');
}

/**
 * Fills the roadmap page in: each column of the roadmap with its ideas and how many it has, the
 * shipped ones newest first, and the ideas to vote on, in the order they come, most votes first.
 * With no ideas to show, because they couldn't be read, each list says so.
 */
export function fillRoadmap(html: string, ideas: readonly Idea[] | null): string {
  let filled = html;
  for (const list of LISTS) {
    const listed = ideas?.filter((idea) => idea.status === list) ?? null;
    const ordered = list === 'shipped' && listed ? [...listed].sort(newestFirst) : listed;
    filled = filled.replace(
      ideasSlot(list),
      () => `data-ideas="${list}">${listItems(list, ordered)}</ol>`,
    );
    filled = filled.replace(
      countSlot(list),
      () => `data-ideas-count="${list}">${listed?.length || ''}</span>`,
    );
  }
  return filled;
}
