/**
 * The parts of a job's posting that Analyze job scores a job on, which Add job asks for when the
 * user pastes a posting, and whether pasted text looks to have each. It goes by words a posting
 * uses for each part, so it's a guide for the user, never a check that stops them.
 */

/** The least a whole posting runs to, in characters: shorter text is likely only part of one. */
export const WHOLE_POSTING = 1200;

/** What you'd do: the work, the team, who it reports to. */
const WORK =
  /\b(responsibilit|what you(?:'|’)?ll do|what you will do|you will|duties|day[- ]to[- ]day|in this role|about the role|the role|job summary|accountabilities|reports? to)/i;

/** What they want: years, skills, degrees, certifications. */
const ASKS =
  /\b(qualifications?|requirements?|what you(?:'|’)?ll need|what we(?:'|’)?re looking for|you have|you bring|must[- ]have|nice to have|years? of|experience (?:with|in)|bachelor|master(?:'|’)?s|ph\.?d|degree (?:in|or|required|preferred)|certifi)/i;

/**
 * Pay and benefits: an amount with its currency before or after it, or the words for it. Not
 * "equity" alone, which is as often diversity's, nor "bonus points". An amount is tried only from
 * where its digits start, so a long run of them takes no longer than its length.
 */
const PAY =
  /([$£€]\s?\d|(?<![\d.,])\d[\d.,]*\s?(?:[$£€]|(?:usd|eur|gbp)\b)|\b(salary|compensation|pay range|base pay|hourly|per hour|per year|benefits|401\(?k\)?|bonus(?!\s+points?)|stock options?)\b)/i;

/** Where: the place, and remote, hybrid or on-site. */
const PLACE = /\b(remote|hybrid|on[- ]?site|in[- ]office|location|relocat)/i;

/** One part of a posting to paste, and whether the text has it. */
export interface PostingPart {
  id: 'whole' | 'work' | 'asks' | 'pay' | 'place';
  label: string;
  found: boolean;
}

/** The parts of a posting to paste, in the order a posting tends to give them, each found or not. */
export function postingParts(text: string): PostingPart[] {
  const pasted = text.trim();
  return [
    {
      id: 'whole',
      label: 'All of it, from the job’s title down to the end',
      found: pasted.length >= WHOLE_POSTING,
    },
    {
      id: 'work',
      label: 'What you’d do: the work, the team, who it reports to',
      found: WORK.test(pasted),
    },
    {
      id: 'asks',
      label: 'What they want: years, skills, degrees, certifications',
      found: ASKS.test(pasted),
    },
    { id: 'pay', label: 'Pay and benefits, if it says', found: PAY.test(pasted) },
    {
      id: 'place',
      label: 'Where: the place, and remote, hybrid or on-site',
      found: PLACE.test(pasted),
    },
  ];
}
