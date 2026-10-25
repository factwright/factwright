import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type FieldAnswer,
  type FormAnswer,
  type FormTask,
  formPage,
  type PageForm,
} from '../src/page/form.ts';

/**
 * Filling a field that holds something already, as Fill does everywhere it has an answer: what's
 * there goes, a set of boxes ends up just as answered, a file you attached stays, and a page that
 * reads a resume it's given gets the time it takes.
 */

const HERE = 'https://jobs.example/apply';

const run = (task: FormTask, doc: Document = document) => formPage(task, doc, HERE);

async function read(doc: Document = document): Promise<PageForm> {
  const answer = await run({ do: 'read' }, doc);
  if (answer.did !== 'read') throw new Error('It didn’t read the form.');
  return answer.form;
}

const filledOf = (answer: FormAnswer) => {
  if (answer.did !== 'fill') throw new Error(`Not filled: ${answer.did}`);
  return answer.filled;
};

/** An answer for the field with this question. */
async function to(question: string, answer: Omit<FieldAnswer, 'ref' | 'key'>) {
  const field = (await read()).fields.find((each) => each.question === question);
  if (!field) throw new Error(`No field asks ${question}`);
  return { ref: field.ref, key: field.key, ...answer };
}

const fill = async (...answers: FieldAnswer[]) =>
  filledOf(await run({ do: 'fill', url: HERE, answers }));

/** A file list as a browser's, which jsdom lacks, and a file field that takes one. */
class Files {
  list: File[] = [];
  items = { add: (file: File) => this.list.push(file) };
  get files() {
    return this.list;
  }
}

function takesFiles(input: HTMLInputElement): { changes: number } {
  let held: File[] = [];
  const counted = { changes: 0 };
  Object.defineProperty(input, 'files', {
    get: () => held,
    set: (list: File[]) => {
      held = [...list];
    },
    configurable: true,
  });
  input.addEventListener('change', () => {
    counted.changes += 1;
  });
  return counted;
}

beforeEach(() => {
  (globalThis as { DataTransfer?: unknown }).DataTransfer = Files;
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as { DataTransfer?: unknown }).DataTransfer;
});

describe('filling what’s there', () => {
  it('puts the answer in place of what a box holds', async () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" name="email" type="email" value="old@example.com">`;
    const filled = await fill(await to('Email', { text: 'ana@example.com' }));
    expect(filled).toEqual([expect.objectContaining({ ok: true, shown: 'ana@example.com' })]);
    expect(filled[0]?.kept).toBeUndefined();
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('ana@example.com');
  });

  it('leaves a set of boxes with just the answer’s picks ticked', async () => {
    document.body.innerHTML = `
      <fieldset><legend>Which do you know?</legend>
        <label><input type="checkbox" name="known" value="go" checked> Go</label>
        <label><input type="checkbox" name="known" value="rust"> Rust</label>
        <label><input type="checkbox" name="known" value="sql" checked> SQL</label>
      </fieldset>`;
    const ticked = () =>
      [...document.querySelectorAll<HTMLInputElement>('input')].map((box) => box.checked);
    const filled = await fill(await to('Which do you know?', { pick: ['Rust', 'SQL'] }));
    expect(filled).toEqual([expect.objectContaining({ ok: true, shown: 'Rust, SQL' })]);
    expect(ticked()).toEqual([false, true, true]);
    // An answer none of its options says leaves them as they are.
    const none = await fill(await to('Which do you know?', { pick: ['Haskell'] }));
    expect(none).toEqual([expect.objectContaining({ ok: false, why: 'no-option' })]);
    expect(ticked()).toEqual([false, true, true]);
  });

  it('leaves a list that takes several with just the answer’s picks', async () => {
    document.body.innerHTML = `
      <label for="days">Which days can you work?</label>
      <select id="days" name="days" multiple>
        <option selected>Monday</option><option>Tuesday</option><option>Wednesday</option>
      </select>`;
    let changes = 0;
    document.getElementById('days')?.addEventListener('change', () => {
      changes += 1;
    });
    const answer = await to('Which days can you work?', { pick: ['Tuesday', 'Wednesday'] });
    expect(await fill(answer)).toEqual([
      expect.objectContaining({ ok: true, shown: 'Tuesday, Wednesday' }),
    ]);
    const options = [...(document.getElementById('days') as HTMLSelectElement).options];
    expect(options.map((option) => option.selected)).toEqual([false, true, true]);
    // Filled again as it is, the page hears nothing new.
    await fill(answer);
    expect(changes).toBe(1);
  });

  it('picks a list’s option once: one picked already isn’t picked again', async () => {
    document.body.innerHTML = `
      <label for="country">Country</label>
      <select id="country" name="country"><option value="">Select…</option><option>Canada</option><option>United States</option></select>`;
    let changes = 0;
    document.getElementById('country')?.addEventListener('change', () => {
      changes += 1;
    });
    const answer = await to('Country', { pick: ['United States'] });
    await fill(answer);
    await fill(answer);
    expect(changes).toBe(1);
    expect((document.getElementById('country') as HTMLSelectElement).value).toBe('United States');
  });

  it('never ticks a box you agree with', async () => {
    document.body.innerHTML = `
      <label><input type="checkbox" name="terms" id="terms"> I agree to the terms</label>`;
    const filled = await fill(await to('I agree to the terms', { pick: ['Yes'] }));
    expect(filled).toEqual([expect.objectContaining({ ok: false })]);
    expect((document.getElementById('terms') as HTMLInputElement).checked).toBe(false);
  });
});

describe('a file field', () => {
  const resume = (name: string, base64 = 'JVBERi0xLjc=') => ({
    name,
    type: 'application/pdf',
    base64,
  });

  beforeEach(() => {
    document.body.innerHTML = `
      <label for="resume">Resume</label><input id="resume" name="resume" type="file">`;
  });

  it('keeps a file you attached, and puts the job’s in where there’s none', async () => {
    const input = document.getElementById('resume') as HTMLInputElement;
    const counted = takesFiles(input);
    input.files = [new File(['mine'], 'MyOwnResume.pdf')] as unknown as FileList;
    const answer = await to('Resume', { file: resume('AnaRuizResume10202026_Talkiatry.pdf') });
    expect(await fill(answer)).toEqual([
      expect.objectContaining({ ok: true, shown: 'MyOwnResume.pdf', kept: true }),
    ]);
    expect(counted.changes).toBe(0);
    input.files = [] as unknown as FileList;
    expect(await fill(answer)).toEqual([
      expect.objectContaining({ ok: true, shown: 'AnaRuizResume10202026_Talkiatry.pdf' }),
    ]);
    expect(counted.changes).toBe(1);
  });

  it('sends the job’s file once, and a newer one in its place', async () => {
    const input = document.getElementById('resume') as HTMLInputElement;
    const counted = takesFiles(input);
    const first = await to('Resume', { file: resume('AnaRuizResume.pdf') });
    await fill(first);
    await fill(first);
    expect(counted.changes).toBe(1);
    // The job's resume made again, under the same name: the newer one goes in.
    const newer = await to('Resume', { file: resume('AnaRuizResume.pdf', 'JVBERi0xLjcKbmV3') });
    const [replaced] = await fill(newer);
    expect(replaced).toMatchObject({ ok: true, shown: 'AnaRuizResume.pdf' });
    expect(replaced?.kept).toBeUndefined();
    expect(counted.changes).toBe(2);
  });

  it('counts a file the page shows it took, beside the field, as one you attached', async () => {
    document.body.innerHTML = `
      <label for="resume">Resume</label>
      <div class="upload"><input id="resume" name="resume" type="file">
        <p class="ashby-application-form-input-file-item-name">Resume (3).pdf</p></div>`;
    takesFiles(document.getElementById('resume') as HTMLInputElement);
    const answer = await to('Resume', { file: resume('AnaRuizResume.pdf') });
    expect(await fill(answer)).toEqual([
      expect.objectContaining({ ok: true, shown: 'Resume (3).pdf', kept: true }),
    ]);
  });
});

describe('a page reading a resume', () => {
  it('waits while the page says it’s reading one, and not at all otherwise', async () => {
    document.body.innerHTML = `
      <div id="reading" hidden><span>Parsing your resume. Autofilling key fields...</span></div>
      <p>We’ll read every application carefully.</p>`;
    const started = Date.now();
    expect(await run({ do: 'wait', ms: 5000, quiet: 0 })).toEqual({ did: 'wait', busy: false });
    expect(Date.now() - started).toBeLessThan(500);
    const reading = document.getElementById('reading') as HTMLElement;
    reading.hidden = false;
    setTimeout(() => {
      reading.hidden = true;
    }, 400);
    const waiting = Date.now();
    expect(await run({ do: 'wait', ms: 5000, quiet: 200 })).toEqual({ did: 'wait', busy: false });
    expect(Date.now() - waiting).toBeGreaterThanOrEqual(400);
    // A page that never stops says it's still reading, once it's waited as long as it may.
    reading.hidden = false;
    expect(await run({ do: 'wait', ms: 300, quiet: 0 })).toEqual({ did: 'wait', busy: true });
  });
});
