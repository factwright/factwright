import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  builtInTemplate,
  previewResume,
  type Resume,
  readResume,
  renderHtml,
  type Template,
  templateFile,
} from '@factwright/engine';
import { RESUME_FONTS } from '../resume/fonts.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import { TEMPLATES_FOLDER, type TemplateLibrary } from '../resume/templates.ts';
import { resumeAt } from './resume.ts';

export interface TemplateToolDeps {
  workspace: string;
  printer: ResumePrinter;
  templates: TemplateLibrary;
}

/** Whether a template shows the strengths list, which only some do. */
const showsCompetencies = (template: Template) =>
  [template.body, ...Object.values(template.parts)].some((markup) =>
    /\{\{\s*[#^]?\s*competencies\b/.test(markup),
  );

/** The user's templates, with what each looks like and whose it is. */
export function listTemplates(templates: TemplateLibrary): string {
  const rows = templates.list().map((info) => {
    const found = templates.find(info.id);
    const competencies = found.ok && showsCompetencies(found.template) ? 'yes' : 'no';
    return `| \`${info.id}\` | ${info.name} | ${info.look} | ${info.own ? 'the user’s own' : 'built in'} | ${competencies} |`;
  });
  return [
    'The templates the user can pick. Set a resume’s `layout` to one’s ID. guide/templates.md says which the user picked for each kind of company.',
    '',
    '| ID | Name | Look | Whose | Shows `competencies` |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/** A template's file, to start another from or to change it. */
export function readTemplateFile(templates: TemplateLibrary, id: string): string {
  const found = templates.find(id);
  if (!found.ok) return found.message;
  const where = builtInTemplate(id)
    ? `${id} is built into the app, so it can’t be changed. Start a template of the user’s own from it, under an ID of its own.`
    : `${TEMPLATES_FOLDER}/${id}.json, the user’s own. Save it again with replace to change it.`;
  return `${where}\n\n\`\`\`json\n${templateFile(found.template)}\`\`\``;
}

/** The resume a preview shows: one of the user's, from its folder, or the made-up one. */
async function previewOf(
  workspace: string,
  folder: string | undefined,
): Promise<{ resume: Resume; label: string } | string> {
  if (!folder) return { resume: previewResume(), label: 'the made-up resume the gallery shows' };
  const at = resumeAt(workspace, folder);
  if (!at) return `“${folder}” isn’t a job folder or a starting resume.`;
  let data: unknown;
  try {
    data = JSON.parse(await readFile(join(at.dir, at.data), 'utf8'));
  } catch {
    return `There’s no readable ${at.where}/${at.data} to preview with.`;
  }
  const read = readResume(data);
  if (!read.ok) return `${at.where}/${at.data} has problems, so it can’t be previewed with.`;
  return { resume: read.resume, label: `${at.where}/${at.data}` };
}

/**
 * Saves a template Claude made, once it passes the checks, and prints a preview for Claude to
 * read: the made-up resume the gallery shows, or one of the user's.
 */
export async function saveTemplate(
  input: { id: string; template: unknown; replace: boolean; resume: string | undefined },
  deps: TemplateToolDeps,
): Promise<string> {
  const preview = await previewOf(deps.workspace, input.resume);
  if (typeof preview === 'string') return `Not saved: ${preview}`;
  // A template given as JSON text reads the same as one given as an object.
  let given = input.template;
  if (typeof given === 'string') {
    try {
      given = JSON.parse(given);
    } catch {
      return 'Not saved: the template isn’t valid JSON. Give it as an object.';
    }
  }
  const saved = deps.templates.save(given, input.id, input.replace);
  if (!saved.ok) {
    return ['Not saved. Fix these, then save again:', ...saved.problems.map((p) => `- ${p}`)].join(
      '\n',
    );
  }
  const { template } = saved;
  const path = deps.templates.previewPath(template.id);
  const printed = await deps.printer.print(renderHtml(preview.resume, template, RESUME_FONTS));
  const file = join(deps.workspace, ...path.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, printed.pdf);
  const fill = printed.lastFill === null ? '' : `, the last one ${printed.lastFill}% full`;
  return [
    `Saved ${TEMPLATES_FOLDER}/${template.id}.json, “${template.name}”${saved.replaced ? ', in place of the one before' : ''}. It’s in the user’s templates now.`,
    `Its preview, with ${preview.label}, is ${path}: ${printed.pages} pages${fill}. Read it to check the look.`,
  ].join('\n');
}
