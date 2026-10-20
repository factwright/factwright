import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  builtInTemplate,
  previewLetter,
  previewResume,
  type Resume,
  readResume,
  readTemplate,
  renderHtml,
  renderLetterHtml,
  type Template,
  templateFile,
  templateLeavesOut,
} from '@factwright/engine';
import { RESUME_FONTS } from '../resume/fonts.ts';
import type { ResumePrinter } from '../resume/printer.ts';
import { TEMPLATES_FOLDER, type TemplateLibrary } from '../resume/templates.ts';
import { huntCall, type ToolCall } from './mcp.ts';
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
    const dropped = found.ok ? templateLeavesOut(found.template) : [];
    const rest = dropped.length > 0 ? `no: leaves out ${dropped.join(' and ')}` : 'yes';
    return `| \`${info.id}\` | ${info.name} | ${info.look} | ${info.own ? 'the user’s own' : 'built in'} | ${competencies} | ${rest} |`;
  });
  return [
    'The templates the user can pick. Set a resume’s `layout` to one’s ID. guide/templates.md says which the user picked for each kind of company.',
    '',
    '| ID | Name | Look | Whose | Shows `competencies` | Shows `projects` and `extra_sections` |',
    '|---|---|---|---|---|---|',
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
 * read: the made-up resume the gallery shows, or one of the user's. A run started to make a
 * template, which saves without asking, may replace only the templates it saved itself. Any
 * other run replacing one of the user's templates puts the one before in the trash.
 */
export async function saveTemplate(
  input: { id: string; template: unknown; replace: boolean; resume: string | undefined },
  deps: TemplateToolDeps,
  call: ToolCall = huntCall(),
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
  // A template that drops the projects or the extra sections would print resumes without them,
  // and nobody would see it.
  const read = readTemplate(given, input.id);
  const dropped = read.ok ? templateLeavesOut(read.template) : [];
  if (dropped.length > 0) {
    return `Not saved: it leaves out ${dropped.join(' and ')}. Show {{#projects}} and {{#extra_sections}} as the app’s own templates do, so a resume with them prints them.`;
  }
  const before = deps.templates.has(input.id) && !call.templates.has(input.id);
  if (input.replace && before && call.scope === 'template') {
    return `Not saved: ${TEMPLATES_FOLDER}/${input.id}.json is one of the user’s templates from before this run, which this run can’t replace. Save yours under an ID of its own. The user can change theirs in a run that asks first.`;
  }
  const saved = await deps.templates.save(given, input.id, input.replace, before);
  if (!saved.ok) {
    return ['Not saved. Fix these, then save again:', ...saved.problems.map((p) => `- ${p}`)].join(
      '\n',
    );
  }
  const { template } = saved;
  call.templates.add(template.id);
  const path = deps.templates.previewPath(template.id);
  const printed = await deps.printer.print(renderHtml(preview.resume, template, RESUME_FONTS));
  const file = join(deps.workspace, ...path.split('/'));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, printed.pdf);
  const fill = printed.lastFill === null ? '' : `, the last one ${printed.lastFill}% full`;
  // A cover letter in it, from the same person, with the header their resume has.
  const { name, headline, contact } = preview.resume;
  const letter = { ...previewLetter(), name, headline, contact: contact ?? {} };
  const letterPath = deps.templates.letterPreviewPath(template.id);
  const letterPrinted = await deps.printer.print(renderLetterHtml(letter, template, RESUME_FONTS));
  await writeFile(join(deps.workspace, ...letterPath.split('/')), letterPrinted.pdf);
  const letterPages = letterPrinted.pages === 1 ? '1 page' : `${letterPrinted.pages} pages`;
  return [
    `Saved ${TEMPLATES_FOLDER}/${template.id}.json, “${template.name}”${saved.replaced ? (before ? ', in place of the one before, which is in the trash to restore' : ', in place of the one before') : ''}. It’s in the user’s templates now.`,
    `Its preview, with ${preview.label}, is ${path}: ${printed.pages} pages${fill}. Read it to check the look.`,
    template.letter
      ? `A cover letter in its letter layout is ${letterPath}: ${letterPages}. Read it too: its header should match the resume’s.`
      : `It has no letter layout, so cover letters print plainly in its fonts and colors, as ${letterPath} shows: ${letterPages}.`,
  ].join('\n');
}
