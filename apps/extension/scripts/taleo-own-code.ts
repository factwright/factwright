// Oracle Taleo Enterprise's own code on its application's steps, as the end-to-end runs and the
// tests act it out: a page saved without it has lists that never fill and buttons that do nothing.
// This follows public captures of Taleo's career sections up to October 2026, Taleo's own public
// scripts, and other tools' notes on its steps, for a made-up company, Bramblecote Logistics. No
// step was saved from a real application for this: past its sign-in, how a step's elements nest
// is a reconstruction, and nothing was signed in to.

/**
 * Taleo Enterprise's own code on a step of its application, as it works: each button, and each
 * link that adds or removes a part, runs `cmdSubmit`, which names itself in the form's `jsfCmdId`
 * and posts the step, its server sending the next step or the same one again, which `posts` says
 * whether to do, and which `taleoCommands` lists here either way; a country's list fills its
 * states' a moment later, and a state's its cities', from Taleo's server, each disabled till then;
 * a source's type fills the list of its sources a moment later; and a program's box suggests
 * programs as you type, keeping the one picked in a hidden field beside it, and letting it go once
 * you change the box. The form's own sending, as Enter in a box would do, only counts, in
 * `taleoSubmits`. The options are made up. It holds everything it needs, as the page runs it.
 */
export function taleoActs(doc: Document, posts: boolean): void {
  // A page a test parsed has no window: what's counted goes on the document.
  const page = (doc.defaultView ?? doc) as { taleoCommands?: string[]; taleoSubmits?: number };
  page.taleoCommands = [];
  page.taleoSubmits = 0;
  const app = doc.body;
  // The page's inline handlers call Taleo's functions: a script of the page's own sets them, where
  // its handlers find them, and `cmdSubmit` tells this of each command by an event.
  const stand = doc.createElement('script');
  stand.textContent = [
    'window.taleo = { core: { event: { setAndReturnFalse: function () { return false; } } } };',
    "window.cmdSubmit = function (form, command) { document.body.dispatchEvent(new CustomEvent('taleo-command', { detail: { form: form, command: command } })); return false; };",
    'window.updateMenu = function () {};',
    'window.execDefaultCmdOnEnterKeyPress = function () {};',
    'window.secureSubmit = function () {};',
  ].join('\n');
  (doc.head ?? doc.body).append(stand);
  app.addEventListener('taleo-command', (event) => {
    const { form, command } = (event as CustomEvent).detail as { form: string; command: string };
    page.taleoCommands?.push(command);
    const sent = doc.getElementById(form) as HTMLFormElement | null;
    const id = doc.getElementById('jsfCmdId') as HTMLInputElement | null;
    if (id) id.value = command;
    if (posts) sent?.submit();
  });

  const STATES: Record<string, Record<string, string[]>> = {
    'United States': {
      Colorado: ['Boulder', 'Colorado Springs', 'Denver', 'Fort Collins'],
      Nevada: ['Las Vegas', 'Reno'],
      Wyoming: ['Casper', 'Cheyenne', 'Laramie'],
    },
    Canada: { Alberta: ['Calgary', 'Edmonton'], Ontario: ['Ottawa', 'Toronto'] },
  };
  const SOURCES: Record<string, string[]> = {
    'Job Board': ['Glassdoor', 'Indeed', 'LinkedIn', 'ZipRecruiter'],
    'Company Website': ['Bramblecote Careers'],
    'Social Network': ['Facebook', 'LinkedIn', 'X'],
    Referral: ['Employee Referral'],
  };
  const PROGRAMS = [
    'Business Administration',
    'Computer Engineering',
    'Computer Science',
    'Data Science',
    'Logistics and Supply Chain',
    'Mathematics',
  ];
  const esc = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const textOf = (select: HTMLSelectElement) => select.selectedOptions[0]?.text ?? '';
  /** Fills a list from Taleo's server a moment later, "Not specified" first, and enables it. */
  const fill = (select: HTMLSelectElement | null, labels: string[], then?: () => void) => {
    if (!select) return;
    select.disabled = true;
    select.innerHTML = '<option value="-1000">Not specified</option>';
    setTimeout(() => {
      select.innerHTML = `<option value="-1000">Not specified</option>${labels
        .map((label, at) => `<option value="${3000 + at}">${esc(label)}</option>`)
        .join('')}`;
      select.disabled = labels.length === 0;
      select.parentElement?.classList.remove('hidden-audible');
      if (then) setTimeout(then, 100);
    }, 500);
  };
  app.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (!(select instanceof HTMLSelectElement)) return;
    const level = /ResidenceLocation-(\d)$/.exec(select.id);
    if (level) {
      const base = select.id.slice(0, -1);
      const next = doc.getElementById(`${base}${Number(level[1]) + 1}`) as HTMLSelectElement | null;
      const country = textOf(doc.getElementById(`${base}0`) as HTMLSelectElement);
      const labels =
        level[1] === '0'
          ? Object.keys(STATES[country] ?? {})
          : (STATES[country]?.[textOf(select)] ?? []);
      // Its next level changes in turn, as Taleo's own code fires a change on it.
      fill(next, labels, () => next?.dispatchEvent(new Event('change', { bubbles: true })));
    }
    if (select.id.endsWith('recruitmentSourceType')) {
      const sources = doc.getElementById('recruitmentSourceDP') as HTMLSelectElement | null;
      if (!sources) return;
      sources.disabled = true;
      setTimeout(() => {
        sources.innerHTML = `<option value=""></option>${(SOURCES[textOf(select)] ?? [])
          .map((label, at) => `<option value="${4000 + at}">${esc(label)}</option>`)
          .join('')}`;
        sources.disabled = false;
      }, 600);
    }
  });

  // A program's box suggests as you type, and keeps the one picked by its key, beside it.
  for (const box of doc.querySelectorAll<HTMLInputElement>('input.sugInput-input')) {
    const list = doc.getElementById(`${box.id}-list`) as HTMLElement | null;
    const key = doc.getElementById(`${box.id}-hidden`) as HTMLInputElement | null;
    if (!list || !key) continue;
    let timer = 0;
    box.addEventListener('keydown', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const words = box.value.toLowerCase();
        const found = PROGRAMS.filter((each) => words && each.toLowerCase().includes(words));
        list.innerHTML = found
          .map(
            (each, at) =>
              `<div class="sugInput-sug-div" data-key="${5000 + PROGRAMS.indexOf(each)}"><span id="${esc(box.id)}.suggestion${at}">${esc(each)}</span></div>`,
          )
          .join('');
        list.style.visibility = found.length > 0 ? 'visible' : 'hidden';
      }, 100) as unknown as number;
    });
    list.addEventListener('click', (event) => {
      const row = (event.target as Element).closest('.sugInput-sug-div');
      if (!row) return;
      box.value = row.textContent ?? '';
      key.value = row.getAttribute('data-key') ?? '';
      box.classList.add('sugInput-input-selected');
      list.style.visibility = 'hidden';
    });
    const unselect = () => {
      if (!box.classList.contains('sugInput-input-selected')) key.value = '';
    };
    box.addEventListener('input', () => box.classList.remove('sugInput-input-selected'));
    box.addEventListener('change', unselect);
  }

  // The form's own sending, as Enter in a box would: counted, and never sent.
  for (const form of doc.querySelectorAll('form')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      page.taleoSubmits = (page.taleoSubmits ?? 0) + 1;
    });
  }
}

/** Taleo's own code, as its application's steps run it, each command posting the step. */
export const taleoCode = () => `<script>(${taleoActs.toString()})(document, true);</script>`;
