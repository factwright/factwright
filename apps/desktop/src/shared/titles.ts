import { readTitle } from '@factwright/core';

/**
 * Words that end a job title of its own, and short forms of them, so a comma before one starts
 * another title. Support, lead and head are left out, as they often end what comes after a comma
 * within a title, as in "Manager, Customer Support". Plurals don't count, as in "Director, Sales
 * Engineers".
 */
const ROLE_WORDS = new Set(
  `accountant actuary adviser advisor agent analyst architect assistant associate attorney auditor
  barista bartender biologist bookkeeper broker buyer carpenter cashier chef chemist clerk coach
  cofounder consultant controller cook coordinator copywriter counsel counselor custodian dentist
  designer developer dietitian director doctor driver economist editor electrician engineer
  executive foreman founder generalist geologist hygienist inspector instructor janitor lawyer
  lecturer librarian machinist manager marketer master mechanic nurse nutritionist officer operator
  owner paralegal paramedic partner pharmacist physician physicist pilot planner plumber president
  producer professor programmer receptionist recruiter rep representative researcher scientist
  secretary specialist statistician strategist superintendent supervisor surgeon teacher technician
  technologist tester therapist trader translator tutor underwriter welder writer
  avp ceo cfo cio ciso cmo cna coo cpa cto em evp gm lpn mgr pm rn sde sre svp swe tpm vp`.split(
    /\s+/,
  ),
);

/** Whether it names a job of its own, by the word it ends with. */
function namesARole(title: string): boolean {
  const last = title.split(/\s+/).at(-1) ?? '';
  return ROLE_WORDS.has(last.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
}

/**
 * The job titles in what's typed or pasted, where the person sees at once what it came to. What
 * follows a comma stays with the title before it, as in "Director, Sales" and "Software Engineer,
 * Backend", unless it names a job of its own, as in "Product Manager, Program Manager". Reading
 * two titles as one leaves a way out, which is Enter after each, where reading one as two doesn't,
 * so it splits only for what it knows. A new line always starts another.
 */
export function titlesIn(text: string): string[] {
  const titles: string[] = [];
  for (const line of text.split('\n')) {
    const parts = line
      .split(',')
      .map((each) => each.trim())
      .filter(Boolean);
    parts.forEach((part, index) => {
      if (index === 0 || namesARole(part)) titles.push(part);
      else titles[titles.length - 1] = `${titles.at(-1)}, ${part}`;
    });
  }
  return titles;
}

/** Whether it says how senior and nothing of the work, as Director and Senior Manager do. */
function bareLevel(title: string): boolean {
  const { levels, words } = readTitle(title);
  return words.length === 0 ? levels.length > 0 : words.length === 1 && words[0] === 'manager';
}

/**
 * Job titles as Profile has them, with what a comma used to split off a title back on it, as
 * "Director, Sales" used to become Director and Sales. Saved, they can't say whether that's what
 * happened, so only a title that's nothing but a level takes what follows, as it says too little
 * to look for alone, and what follows has to say what the work is without naming a job.
 */
export function savedTitles(titles: readonly string[]): string[] {
  const kept: string[] = [];
  for (const title of titles) {
    const last = kept.at(-1);
    if (last !== undefined && bareLevel(last) && !bareLevel(title) && !namesARole(title)) {
      kept[kept.length - 1] = `${last}, ${title}`;
    } else {
      kept.push(title);
    }
  }
  return kept;
}
