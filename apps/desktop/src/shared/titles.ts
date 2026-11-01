/** Words that end a job's name without ending as most do, and short names of jobs. */
const JOB_WORDS = new Set(
  `actuary aide agent apprentice architect associate attorney barista chef clerk coach cook counsel
  dean executive guard host hostess intern maid mason mechanic medic midwife nanny nurse paralegal
  para paraprofessional paramedic pilot president principal rep representative secretary teller
  trainee valet
  ae avp bdr ceo cfo cio ciso cmo cna coo cpa cro csm cto em emt evp gm lpn mgr np pa pm rn sde sdr
  sre svp swe tpm vp`.split(/\s+/),
);

/** How most jobs' names end: manager, analyst, scientist, technician, accountant, foreman. */
const JOB_ENDING = /(?:er|or|yst|ist|ian|ant|man|wright|smith)$/;

/** Words that say a job's place in a team, so with other words they name one: "Shift Lead". */
const LEVEL_WORD = /\b(?:director|vp|vice president|svp|evp|avp|head|lead|chief|principal)\b/;

/** What says how senior someone is and little of the work: "Director", "Senior Manager". */
const ONLY_A_LEVEL =
  /^(?:(?:senior|sr\.?|associate|assistant|executive|group|regional|area)\s+)*(?:director|manager|mgr|head|lead|chief|vp|vice president|svp|evp|avp)$/i;

/**
 * Whether it looks like the name of a job, from how it ends, before what says how senior or which
 * one: "Analyst II", "Physician Assistant (PA)", "Dean of Students". Plurals don't count, as in
 * "Director, Sales Engineers". It's a guess from the words alone, so it can take something else for
 * a job, such as Data Center, and that only keeps two entries apart, as they've always been.
 */
function looksLikeJob(text: string): boolean {
  const words = (text.replace(/\s*\([^)]*\)$|\s+(?:of|for|at)\s.*$/i, '') || text)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
  while (words.length > 1 && /^(?:\d+|i{1,3}|iv|v)$/.test(words.at(-1) ?? '')) words.pop();
  const last = words.at(-1) ?? '';
  if (words.length > 1 && last === 'tech') return true;
  if (text.includes(' ') && LEVEL_WORD.test(text.toLowerCase())) return true;
  return JOB_WORDS.has(last) || JOB_ENDING.test(last);
}

/**
 * The job titles in what's typed or pasted, where the person sees at once what it came to. A comma
 * starts another title, as it always has, unless what follows clearly goes with what's before: the
 * title before says only how senior or names a job, and what follows says what the work is without
 * naming a job itself. So "Director, Sales", "Software Engineer, Backend" and "Registered Nurse,
 * ICU" are one each, and "Product Manager, Program Manager", "Bartender, Server" and "Customer
 * Service, Sales" are two. Keeping two titles apart is the safer mistake, as a job goes by a kind
 * of job's titles, and one title can always be said without a comma. A new line starts another.
 */
export function titlesIn(text: string): string[] {
  const titles: string[] = [];
  for (const line of text.split('\n')) {
    let first = '';
    for (const part of line.split(',').map((each) => each.trim())) {
      if (!part) continue;
      const canTakeIt = ONLY_A_LEVEL.test(first) || looksLikeJob(first);
      const isOnItsOwn =
        looksLikeJob(part) || (ONLY_A_LEVEL.test(first) && ONLY_A_LEVEL.test(part));
      if (first && canTakeIt && !isOnItsOwn) {
        titles[titles.length - 1] = `${titles.at(-1)}, ${part}`;
      } else {
        titles.push(part);
        first = part;
      }
    }
  }
  return titles;
}

/**
 * Job titles as Profile has them, with what a comma used to split off a title back on it, as
 * "Director, Sales" used to become Director and Sales. Saved, they can't say whether that's what
 * happened, so only a title that says nothing but how senior takes what follows, as it says too
 * little to look for alone, and what follows has to say what the work is without naming a job.
 */
export function savedTitles(titles: readonly string[]): string[] {
  const kept: string[] = [];
  for (const title of titles) {
    const last = kept.at(-1);
    if (last && ONLY_A_LEVEL.test(last) && !ONLY_A_LEVEL.test(title) && !looksLikeJob(title)) {
      kept[kept.length - 1] = `${last}, ${title}`;
    } else {
      kept.push(title);
    }
  }
  return kept;
}
