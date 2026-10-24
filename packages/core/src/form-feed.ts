import { FORM_LIMITS, type FormQuestion } from './extras.ts';
import { type FieldControl, fieldKind } from './forms.ts';
import {
  decodeEntities,
  htmlToText,
  type PostingRequest,
  type PostingSource,
  postingRequests,
  postingSource,
} from './posting.ts';

/*
 * An application form's questions before the form is open, from the applicant system that
 * publishes them: Greenhouse's job API gives a form's questions when asked with
 * `questions=true`. Lever, Ashby and Gem show theirs only on the form itself, where the
 * extension reads them in the browser.
 */

/** A posting on Greenhouse, whose job API gives its form's questions. */
export type FormFeed = Extract<PostingSource, { kind: 'greenhouse' }>;

/**
 * Where a job's form gives its questions before it's open: the first of the job's links that's
 * a posting on Greenhouse, as a company's own careers page can embed one too. Null for a job
 * with none.
 */
export function formFeed(
  links: readonly (string | null | undefined)[],
): { url: string; source: FormFeed } | null {
  for (const link of links) {
    if (!link) continue;
    try {
      const source = postingSource(link);
      if (source.kind === 'greenhouse') return { url: new URL(link).href, source };
    } catch {
      // Not a link.
    }
  }
  return null;
}

/** The requests to try for a form's questions, in order, until one answers: one for each board. */
export const formFeedRequests = (source: FormFeed): PostingRequest[] =>
  postingRequests(source).map((request) => ({ ...request, url: `${request.url}?questions=true` }));

/** How a form takes the answer to each kind of field Greenhouse's job API names. */
const CONTROLS: Readonly<Record<string, FieldControl>> = {
  input_text: 'text',
  textarea: 'long',
  multi_value_single_select: 'choice',
  multi_value_multi_select: 'choices',
  input_file: 'file',
};

/**
 * A field of a question of the form's own, by its name: Greenhouse names each "question_" and a
 * number, with "[]" for one that takes several options. The fields every form has go by names of
 * their own, such as "first_name", "resume" and "cover_letter_text".
 */
const OWN_FIELD = /^question_\d+(?:\[\])?$/;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const squash = (words: string) => words.replace(/\s+/g, ' ').trim();
const cut = (words: string) =>
  words.length > FORM_LIMITS.text ? `${words.slice(0, FORM_LIMITS.text - 1)}…` : words;

/**
 * The most characters a question takes, when its words say, as "500 characters max" does: as the
 * extension reads a limit from a field's words on the page (apps/extension/src/page/form.ts).
 */
function limitSaid(words: string): number | null {
  const said =
    /(\d[\d,]*)\s*(?:characters|chars)\b|max(?:imum)?\.?(?: of)?\s*(\d[\d,]*)\s*char/i.exec(
      words.slice(0, FORM_LIMITS.text * 2),
    );
  const count = said ? Number((said[1] ?? said[2] ?? '').replace(/,/g, '')) : Number.NaN;
  return Number.isInteger(count) && count > 0 ? count : null;
}

/** What a question says under it, which the API gives as HTML, now and then inside entities. */
function hintOf(description: string): string {
  const html = description.includes('<') ? description : decodeEntities(description);
  return cut(squash(htmlToText(html)));
}

/**
 * A Greenhouse form's own questions, from its job API's answer to `questions=true`, kept as the
 * extension keeps the questions it reads on a form: each one's words, what the form says under
 * it, how it takes its answer, its options, whether it's required, and its limit when its words
 * give one. Null for an answer that isn't a job's.
 *
 * Only the questions for your Claude to draft. Never the fields every form has, for your name,
 * email, phone, location, resume and cover letter, nor the demographic and compliance questions,
 * which the API gives apart. Nor one of the form's own that Factwright fills from what's on file,
 * or leaves for you, told apart as the extension tells them: a link, whether you may work there,
 * an equal-opportunity question, agreeing to something, or a file. A choice with only one option
 * has nothing to choose: it's agreeing too.
 */
export function readFormFeed(answer: unknown): FormQuestion[] | null {
  const questions = isObject(answer) ? answer.questions : undefined;
  if (!Array.isArray(questions)) return null;
  return questions
    .flatMap((asked): FormQuestion[] => {
      if (!isObject(asked) || !Array.isArray(asked.fields)) return [];
      const fields = asked.fields.filter(
        (each): each is Json =>
          isObject(each) &&
          OWN_FIELD.test(text(each.name)) &&
          Object.hasOwn(CONTROLS, text(each.type)),
      );
      // One that takes a file or words, as "Attach" or "Enter manually" asks, takes the words.
      const field =
        fields.find((each) => CONTROLS[text(each.type)] !== 'file') ?? fields[0] ?? null;
      const question = cut(squash(decodeEntities(text(asked.label))));
      if (!field || !question) return [];
      const control = CONTROLS[text(field.type)] ?? 'text';
      const hint = hintOf(text(asked.description));
      const options = (Array.isArray(field.values) ? field.values : [])
        .map((value) => cut(squash(decodeEntities(text(isObject(value) ? value.label : '')))))
        .filter(Boolean)
        .slice(0, FORM_LIMITS.options);
      const kind = fieldKind({
        question,
        hint,
        control,
        type: '',
        autocomplete: '',
        name: text(field.name),
        options,
      });
      if (kind !== 'question' || control === 'file') return [];
      const choosing = control === 'choice' || control === 'choices';
      if (choosing && options.length < 2) return [];
      return [
        {
          question,
          hint,
          section: '',
          control,
          options: choosing ? options : [],
          required: asked.required === true,
          limit: choosing ? null : limitSaid(`${question} ${hint}`),
        },
      ];
    })
    .slice(0, FORM_LIMITS.questions);
}
