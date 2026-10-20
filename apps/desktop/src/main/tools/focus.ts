import {
  FOCUS_ID,
  FOCUS_POSTED,
  FOCUS_STAGES,
  FOCUS_WORKPLACES,
  focusFile,
  focusName,
  focusOf,
} from '@factwright/core';
import { diskWorkspace } from '../jobs/workspace.ts';

const dollars = (amount: number) => `$${amount.toLocaleString('en-US')}`;

/** The pay rule a focus sets, in words: the range, and which jobs it leaves out. */
function payRule(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) {
    return `${dollars(min)} to ${dollars(max)} a year. Leave out a job whose listed pay is all below ${dollars(min)} or all above ${dollars(max)}.`;
  }
  if (min !== null)
    return `${dollars(min)} a year or more. Leave out a job whose listed pay is all below it.`;
  return max !== null
    ? `Up to ${dollars(max)} a year. Leave out a job whose listed pay is all above it.`
    : null;
}

/**
 * What one job search looks for, by its focus's ID, as search_focus gives it: binding for that
 * run alone, on top of criteria.md, whose deal-breakers still apply. Each part says how to tell
 * whether a job fits it, and the user's own words are their request, as if they'd typed them.
 */
export function searchFocusText(workspace: string, id: string): string {
  if (!FOCUS_ID.test(id)) {
    throw new Error(`“${id}” isn’t a focus’s ID. Give the ID after “focus” in the search’s input.`);
  }
  const focus = focusOf(diskWorkspace(workspace).readText(focusFile(id)));
  if (!focus) {
    throw new Error(
      `There’s no focus ${id} on file. Search without one, and say so in your reply.`,
    );
  }
  const stage = new Map(FOCUS_STAGES.map(([each, label, about]) => [each, `${label} (${about})`]));
  const workplace = new Map(FOCUS_WORKPLACES.map(([each, label]) => [each, label]));
  const posted = FOCUS_POSTED.find(([days]) => days === focus.posted);
  const pay = payRule(focus.payMin, focus.payMax);
  const name = focusName(focus);
  const rules = [
    focus.stages.length > 0 &&
      `- **Kind of company:** ${focus.stages.map((each) => stage.get(each)).join(', or ')}. Tell by the company's stage and size, from the posting, its site or news of its funding. When you can't tell, keep the job and say so in its flags.`,
    pay && `- **Pay:** ${pay} Keep a job that lists no pay, and say so in its flags.`,
    focus.workplaces.length > 0 &&
      `- **Where:** ${focus.workplaces.map((each) => workplace.get(each)).join(' or ')}, as the posting says.`,
    focus.industries.length > 0 && `- **Only these industries:** ${focus.industries.join(', ')}.`,
    focus.avoid.length > 0 && `- **Leave out these industries:** ${focus.avoid.join(', ')}.`,
    posted &&
      posted[0] !== 0 &&
      `- **Posted:** in the ${posted[2]}. Leave out a listing posted earlier. Keep one with no date, and say so in its flags.`,
  ].filter((rule): rule is string => Boolean(rule));
  const notes = focus.notes
    ? [
        '- **The user’s own words for this search,** which are their request, as if they had typed it to you:',
        ...focus.notes.split(/\r?\n/).map((line) => `  > ${line}`),
      ]
    : [];
  return [
    `# This search’s focus${name ? `: ${name}` : ''}`,
    '',
    'The user set it in Find jobs for this search alone. It’s binding for this run, on top of `searches/criteria.md`, whose deal-breakers still apply. Leave criteria.md as it is. Drop each listing that doesn’t fit it, and count those as “outside this search’s focus” in the funnel, with a few examples.',
    '',
    ...rules,
    ...notes,
    '',
    `For this search, end the folder’s name with \`-focus-${id.slice(11)}\`, such as \`2026-11-03-linkedin-focus-${id.slice(11)}\`, put \`"focus": "${id}"\` in jobs.json’s meta, and start report.md with this focus in a line or two. The app names the search after its place in Found by${name ? `, such as “LinkedIn Nov 3 · ${name}”` : ''}, so leave the focus out of meta's source.`,
  ].join('\n');
}
