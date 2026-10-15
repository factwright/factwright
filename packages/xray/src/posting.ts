/**
 * A posting's requirements, read from its saved text: which lines say what the job must have,
 * which say what's nice to have, and which describe the work. Postings head these parts in many
 * ways, so each heading is read for what it means.
 */

/** How much a posting's line asks for what it names. */
export type Need = 'must' | 'nice';

export interface PostingLine {
  text: string;
  need: Need;
}

/** What a part of a posting holds. */
type Part = 'must' | 'nice' | 'role' | 'other';

const NICE =
  /\b(?:nice|bonus|plus(?:es)?|preferred|desired|desirable|ideally|great if|extra credit|optional|would be (?:great|nice|a plus)|good to have|stand out|advantage(?:ous)?|not required)\b/i;
const MUST =
  /\b(?:requirements?|required|qualifications?|must|what you(?:'ll| will)? need|you(?:'ll| will)? need|what you bring|you bring|you have|who you are|about you|looking for|minimum|basic|essential|ideal candidate|you should have|should have|you are)\b/i;
const OTHER =
  /\b(?:about (?:us|the company|the team|our)|benefits|perks|compensation|salary|pay|what we offer|we offer|why (?:join|work)|our values|values|culture|equal opportunity|eeo|diversity|how to apply|hiring process|interview process|our process|location|logistics|who we are|the company)\b/i;
const ROLE =
  /\b(?:responsibilit(?:y|ies)|what you(?:'ll| will) do|the role|your role|role|day[- ]to[- ]day|duties|in this role|the job|the work|what you(?:'ll| will) work on|key tasks|impact|you(?:'ll| will))\b/i;
const MUST_LATE =
  /\b(?:skills|experience|competenc(?:y|ies)|profile|background|knowledge|tech stack|stack)\b/i;

/** Words in a line of a list that make it a nice-to-have, or a must-have, whatever its part. */
const NICE_HERE =
  /\b(?:preferred|a plus|is a plus|are a plus|nice to have|bonus|ideally|desired|desirable|good to have|an advantage|not required|optional)\b/i;
const MUST_HERE = /\b(?:required|must|minimum)\b/i;

/** What a heading's words say its part holds, or null for a heading that doesn't say. */
function partOf(heading: string): Part | null {
  const text = heading.replace(/[’]/g, "'");
  if (NICE.test(text)) return 'nice';
  if (MUST.test(text)) return 'must';
  if (OTHER.test(text)) return 'other';
  if (ROLE.test(text)) return 'role';
  if (MUST_LATE.test(text)) return 'must';
  return null;
}

/** A heading's words, when a line is one: "## Requirements", "**What you bring**", "Bonus:". */
function headingOf(line: string): string | null {
  const text = line.trim();
  const marked =
    text.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1] ??
    text.match(/^\*\*([^*]+?):?\*\*:?$/)?.[1] ??
    text.match(/^__([^_]+?):?__:?$/)?.[1];
  if (marked) return marked;
  if (/^[-*•+]|^\d+[.)]/.test(text)) return null;
  const words = text.split(/\s+/).length;
  if (words <= 8 && /:$/.test(text)) return text.slice(0, -1);
  if (words <= 6 && /^[\p{Lu}][\p{Lu}\s&'’/,-]+$/u.test(text)) return text;
  if (words <= 6 && !/[.!?,;]$/.test(text) && partOf(text)) return text;
  return null;
}

/** Lines a saved posting starts with, which are about the file rather than the job. */
const SAVED_NOTE = /^(?:#\s+job posting\s*$|-\s+\*\*(?:source|saved):\*\*|-{3,}\s*$)/i;

/**
 * The posting's lines that ask for something, each with how much: must-haves from its
 * requirements, nice-to-haves from its preferred or bonus parts and from the work it describes.
 * About the company, pay and benefits ask for nothing. A posting with no requirements part is
 * read whole, as must-haves; `sectioned` says which it was.
 */
export function readPosting(text: string): { lines: PostingLine[]; sectioned: boolean } {
  const lines: { text: string; part: Part | null }[] = [];
  let part: Part | null = null;
  let sectioned = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || SAVED_NOTE.test(line)) continue;
    const heading = headingOf(line);
    if (heading !== null) {
      const next = partOf(heading);
      // A heading that doesn't say what it holds, such as the job's title, starts a part of its own.
      part = next ?? 'other';
      if (next === 'must' || next === 'nice') sectioned = true;
      continue;
    }
    // Each clause asks on its own: "RN license; BSN preferred" needs the license, not the BSN.
    for (const clause of line
      .replace(/^[-*•+]\s+|^\d+[.)]\s+/, '')
      .split(/;\s+|(?<=[\p{L})]{2}[.!?])\s+(?=\p{Lu})/u)) {
      if (clause.trim()) lines.push({ text: clause.trim(), part });
    }
  }
  const asked = lines.flatMap(({ text: line, part: where }): PostingLine[] => {
    if (!sectioned && where === 'other') return [];
    if (!sectioned) return [{ text: line, need: NICE_HERE.test(line) ? 'nice' : 'must' }];
    if (where === 'must') return [{ text: line, need: NICE_HERE.test(line) ? 'nice' : 'must' }];
    if (where === 'nice') return [{ text: line, need: 'nice' }];
    if (where === 'role') return [{ text: line, need: MUST_HERE.test(line) ? 'must' : 'nice' }];
    return [];
  });
  return { lines: asked, sectioned };
}
