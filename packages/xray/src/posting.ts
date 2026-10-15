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
  /** The heading of the part it's in, such as "Licenses and certifications", or null. */
  heading: string | null;
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
  /\b(?:skills|experience|competenc(?:y|ies)|profile|background|knowledge|tech stack|stack|education|certifications?|licen[cs]es?|licensure|degrees?|credentials?)\b/i;

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

/**
 * A Markdown heading's words, such as "Requirements" in "## Requirements ##", read by hand: a
 * pattern for it reads the line again from every space and "#" when it doesn't match.
 */
function markdownHeading(text: string): string | null {
  const marks = /^#{1,6}(?=\s)/.exec(text)?.[0];
  if (!marks) return null;
  let words = text.slice(marks.length).trim();
  // A closing run of "#", after a space, as "## Requirements ##" has. "## C#" keeps its "#".
  let end = words.length;
  while (end > 0 && words.charAt(end - 1) === '#') end -= 1;
  if (end === 0 || /\s/.test(words.charAt(end - 1))) words = words.slice(0, end).trim();
  return words || null;
}

/** A heading's words, when a line is one: "## Requirements", "**What you bring**", "Bonus:". */
function headingOf(line: string): string | null {
  const text = line.trim();
  const marked =
    markdownHeading(text) ??
    text.match(/^\*\*([^*]+?):?\*\*:?$/)?.[1] ??
    text.match(/^__([^_]+?):?__:?$/)?.[1];
  if (marked) return marked;
  if (/^[-*•+]|^\d+[.)]/.test(text)) return null;
  const words = text.split(/\s+/).length;
  if (words <= 8 && /:$/.test(text)) return text.slice(0, -1);
  // A line on its own, in capitals or not, is a heading only when every word in it is one a
  // heading uses, so "Requirements" is, and "Strong SQL skills" or "SQL" stays a requirement.
  if (words <= 6 && !/[.!?,;]$/.test(text) && headingWords(text)) return text;
  return null;
}

/** Words postings head their parts with, such as "what you'll need" or "bonus points". */
const HEADING_WORDS = new Set(
  (
    'a about additional an and apply are background basic be benefits bonus bring candidate ' +
    'company compensation core credit culture day desired do education essential experience ' +
    'extra for from have haves how ideal impact in is it job join key location looking minimum ' +
    'mission must need nice of offer on opportunity our outcomes perks plus pluses points ' +
    'preferred process profile qualification qualifications requirement requirements ' +
    'required responsibilities responsibility role should skills stack success team tech the ' +
    'this to us values we what who why will with work would you your'
  ).split(' '),
);

/** Whether every word of a line is one a heading uses. */
const headingWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']ll\b/g, ' will')
    .replace(/[’']re\b/g, ' are')
    .replace(/[’']s\b/g, '')
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .every((word) => HEADING_WORDS.has(word));

/** Lines a saved posting starts with, which are about the file rather than the job. */
const SAVED_NOTE = /^(?:#\s+job posting\s*$|-\s+\*\*(?:source|saved):\*\*|-{3,}\s*$)/i;

/**
 * The posting's lines that ask for something, each with how much: must-haves from its
 * requirements, nice-to-haves from its preferred or bonus parts and from the work it describes.
 * About the company, pay and benefits ask for nothing. A posting with no requirements part is
 * read whole, as must-haves; `sectioned` says which it was.
 */
export function readPosting(text: string): { lines: PostingLine[]; sectioned: boolean } {
  // Each clause, with the text its markers are read in: its own, after its line's label.
  const lines: { text: string; marked: string; part: Part | null; heading: string | null }[] = [];
  let part: Part | null = null;
  let title: string | null = null;
  let sectioned = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || SAVED_NOTE.test(line)) continue;
    const heading = headingOf(line);
    if (heading !== null) {
      const next = partOf(heading);
      // A heading that doesn't say what it holds, such as the job's title, starts a part of its own.
      part = next ?? 'other';
      title = heading;
      if (next === 'must' || next === 'nice') sectioned = true;
      continue;
    }
    // Each clause asks on its own: "RN license; BSN preferred" needs the license, not the BSN.
    // A label before them, as in "Bonus: Kafka; Flink", goes for every clause.
    const body = line.replace(/^[-*•+]\s+|^\d+[.)]\s+/, '');
    const label = /^([^:]{1,40}):\s/.exec(body)?.[1];
    for (const [at, clause] of body.split(/;\s+|(?<=[\p{L})]{2}[.!?])\s+(?=\p{Lu})/u).entries()) {
      const text = clause.trim();
      if (text) {
        lines.push({
          text,
          marked: at > 0 && label ? `${label}: ${text}` : text,
          part,
          heading: title,
        });
      }
    }
  }
  const asked = lines.flatMap(({ text: line, marked, part: where, heading }): PostingLine[] => {
    const nice = NICE_HERE.test(marked);
    const ask = (need: Need): PostingLine[] => [{ text: line, need, heading }];
    if (!sectioned && where === 'other') return [];
    if (!sectioned) return ask(nice ? 'nice' : 'must');
    if (where === 'must') return ask(nice ? 'nice' : 'must');
    if (where === 'nice') return ask('nice');
    if (where === 'role') return ask(!nice && MUST_HERE.test(marked) ? 'must' : 'nice');
    return [];
  });
  return { lines: asked, sectioned };
}
