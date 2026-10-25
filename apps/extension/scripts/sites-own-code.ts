// What applicant systems' own code does on their forms, which the forms saved as fixtures don't
// have, as the end-to-end runs act it out in a real browser: Lever's location box looking up the
// places it suggests, and Ashby's Yes and No, its Resume field and its Autofill from resume. Each
// goes in a form's page before its </body>. The places are made up.

/**
 * Lever's own code for its location box, as it works: as you type, it looks the city up, saying
 * it's loading, then lists the places it found, or says it found none, and a click on one keeps
 * it, in the box and in a hidden field, which is what Lever takes. And for its resume: its lines
 * that say how reading one went show only as they say it, as Lever's styles have them, and a
 * resume put in the field is read for a moment, "Analyzing resume...", then fills in your current
 * company from it, as Lever's does, in place of what's there.
 */
export const LEVER_LOOKS_UP = `<script>
(() => {
  const upload = document.getElementById('resume-upload-input');
  const [failed, working, read, big] = ['failure', 'working', 'success', 'oversize'].map((each) =>
    document.querySelector('.resume-upload-' + each),
  );
  for (const line of [failed, working, read, big]) line.style.display = 'none';
  upload.addEventListener('change', () => {
    document.querySelector('.filename').textContent = upload.files[0] ? upload.files[0].name : '';
    read.style.display = 'none';
    working.style.display = '';
    setTimeout(() => {
      working.style.display = 'none';
      read.style.display = '';
      document.querySelector('input[name="org"]').value = 'Read From The Resume Inc.';
    }, 800);
  });
})();
(() => {
  const PLACES = ['Denver City, Texas, United States', 'Denver, Colorado, United States', 'Boulder, Colorado, United States'];
  const box = document.getElementById('location-input');
  const kept = document.getElementById('selected-location');
  const results = document.querySelector('.dropdown-results');
  const none = document.querySelector('.dropdown-no-results');
  const loading = document.querySelector('.dropdown-loading-results');
  const plain = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  none.style.display = 'none';
  loading.style.display = 'none';
  let timer = 0;
  let looked = '';
  // It looks a place up once the box's words change, not on any key, as Tab.
  box.addEventListener('keyup', () => {
    if (box.value === looked) return;
    looked = box.value;
    clearTimeout(timer);
    kept.value = '';
    results.replaceChildren();
    none.style.display = 'none';
    loading.style.display = box.value.trim() ? '' : 'none';
    if (!box.value.trim()) return;
    timer = setTimeout(() => {
      loading.style.display = 'none';
      const city = plain(box.value.split(',')[0] || '');
      const found = PLACES.filter((place) => city && plain(place).includes(city));
      if (found.length === 0) none.style.display = '';
      for (const place of found) {
        const option = document.createElement('div');
        option.className = 'dropdown-location';
        option.textContent = place;
        option.addEventListener('click', () => {
          box.value = place;
          looked = place;
          kept.value = JSON.stringify({ name: place });
          results.replaceChildren();
        });
        results.append(option);
      }
    }, 150);
  });
})();
</script>`;

/**
 * Ashby's own code on its application, as it works on a real form (Talkiatry's, 2026-10-25, read
 * without submitting), which its page saved as a fixture doesn't have, as the runs and the tests act
 * it out on a page's own document:
 * - a Yes or No click keeps the answer, `true` or `false`, presses that button and lets the other
 *   go, and ticks the hidden box beside them for Yes alone; then Ashby's server keeps it too
 *   (ApiSetFormValue), a moment later;
 * - a file put in the Resume field is shown by its name beside it, and kept in the field, and read
 *   no further;
 * - a resume dropped in "Autofill from resume" shows "Parsing your resume…", and once it's read,
 *   Ashby puts in the whole form as its server had it when the reading started, with what the
 *   resume says (ApiAutofillApplicationFormWithUploadedResume): a Yes or No answered meanwhile is
 *   taken back, as the reset seen live, which Submit then says isn't answered.
 * What Ashby's server has is on the document, as `ashbyServer`, by each question's name.
 */
export function ashbyActs(doc: Document, readMs = 800): void {
  const own = (doc.defaultView ?? doc) as unknown as {
    ashbyServer?: Record<string, boolean | null>;
    ashbyParses?: number;
  };
  const server: Record<string, boolean | null> = {};
  own.ashbyServer = server;
  own.ashbyParses = 0;
  const later = (ms: number, then: () => void) =>
    (doc.defaultView ?? globalThis).setTimeout(then, ms);
  /** Each Yes and No, with the answer it keeps, which the page shows. */
  const boxes = [...doc.querySelectorAll('.ashby-application-form-input-yesno')].map((box) => {
    const buttons = [...box.querySelectorAll('button[aria-pressed]')];
    const hidden = box.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    const name = hidden?.name ?? '';
    server[name] = null;
    const yesNo = { name, value: null as boolean | null, show: () => {} };
    yesNo.show = () => {
      for (const button of buttons) {
        const on = yesNo.value !== null && (button.textContent?.trim() === 'Yes') === yesNo.value;
        button.setAttribute('aria-pressed', String(on));
        button.classList.toggle('_active_1svni_57', on);
      }
      if (hidden) hidden.checked = yesNo.value === true;
    };
    for (const button of buttons) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        yesNo.value = button.textContent?.trim() === 'Yes';
        yesNo.show();
        const value = yesNo.value;
        later(150, () => {
          server[name] = value;
        });
      });
    }
    return yesNo;
  });
  // The Resume field shows the file it took by its name, as Ashby's does.
  const resume = doc.getElementById('_systemfield_resume') as HTMLInputElement | null;
  resume?.addEventListener('change', () => {
    const name = resume.files?.[0]?.name;
    const zone = resume.parentElement;
    if (!name || !zone) return;
    zone.querySelector('.ashby-application-form-input-file-item')?.remove();
    const item = doc.createElement('div');
    item.className = 'ashby-application-form-input-file-item';
    const words = doc.createElement('p');
    words.className = 'ashby-application-form-input-file-item-name';
    words.textContent = name;
    item.append(words);
    resume.after(item);
  });
  // "Autofill from resume": reading shows only while it reads.
  const pane = doc.querySelector('.ashby-application-form-autofill-input-root');
  const pending = doc.querySelector('.ashby-application-form-autofill-input-pending-layer');
  const dropped = pane?.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (pending instanceof HTMLElement) pending.hidden = true;
  dropped?.addEventListener('change', () => {
    if (!dropped.files?.length || !(pending instanceof HTMLElement)) return;
    own.ashbyParses = (own.ashbyParses ?? 0) + 1;
    pending.hidden = false;
    const asWas = { ...server };
    later(readMs, () => {
      pending.hidden = true;
      for (const box of boxes) {
        box.value = asWas[box.name] ?? null;
        server[box.name] = box.value;
        box.show();
      }
      const name = doc.getElementById('_systemfield_name') as HTMLInputElement | null;
      if (name) name.value = 'Alex Rivera';
    });
  });
}

/** Ashby's own code, as a script for a page in a browser (ashbyActs). */
export const ashbyCode = (readMs = 800) =>
  `<script>(${ashbyActs.toString()})(document, ${readMs});</script>`;

/** A form's page with what its site's own code does in it. */
export const withOwnCode = (page: string, code: string) =>
  page.replace('</body>', `${code}</body>`);

/**
 * Workday's own code on its application, as it works, which its pages saved as fixtures don't
 * have, as the runs and the tests act it out on a page's own document. It follows what public
 * sources show of Workday's pages: its dropdowns are Canvas Kit's, a button whose list opens at
 * the page's end, naming it nowhere, and lingers a moment as it closes; its lists you search look
 * up what's typed only on Enter, with its key code, show what they found at the page's end, tied
 * to their box by its widget's ID, a dozen rows at a time, and keep what's picked as a pill, where
 * How Did You Hear About Us? keeps its sources in groups, which a search doesn't look through; a
 * date's parts take only the digits typed, a key at a time, and show them beside their boxes;
 * Add and Add Another add a part for another job or school, with ids from Workday's own counter;
 * Self Identify's boxes take one tick, and Save and Continue swaps the next page in, in the same
 * tab, from the address `pages` names, or not at all where it names none. Submit, on Review, only
 * counts how often it's pressed, in `workdaySubmits`, as Save and Continue's presses are in
 * `workdayNexts`. Picking a country puts the address in again, as Workday's does. Escape closes
 * nothing, as on some of Workday's sites, and a press elsewhere closes what's open. The options are
 * made up. It holds everything it needs, as the page runs it.
 */
export function workdayActs(doc: Document, pages: string): void {
  // A page a test parsed has no window: what's counted goes on the document.
  const counts = (doc.defaultView ?? doc) as { workdaySubmits?: number; workdayNexts?: number };
  counts.workdaySubmits = 0;
  counts.workdayNexts = 0;
  /** Each dropdown's options, by its name. */
  const LISTS: Record<string, string[]> = {
    country: ['Canada', 'Mexico', 'United States of America'],
    countryRegion: ['California', 'Colorado', 'New York', 'Texas'],
    phoneType: ['Landline', 'Mobile', 'Work'],
    degree: [
      'High School or Equivalent',
      'Associates',
      'Bachelors',
      'Masters',
      'Doctorate',
      'Other',
    ],
    disabilityForm: ['English', 'Español'],
    veteranStatus: [
      'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE',
      'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN',
      'I AM NOT A VETERAN',
      'I DO NOT WISH TO SELF-IDENTIFY',
    ],
    hispanicOrLatino: ['Yes', 'No'],
    gender: ['Female', 'Male', 'Not declared'],
    a1f3c2e0b9d84e5f9a7c6b5d: ['Yes', 'No'],
    b2e4d3f1c0e95f6a0b8d7c6e: ['Yes', 'No'],
  };
  /** Each list you search's options, by its box's id: in groups, or not. */
  const SEARCHED: Record<string, Record<string, string[]>> = {
    'source--source': {
      'Job Board': ['Indeed', 'LinkedIn', 'Glassdoor'],
      'Company Website': ['Larkspur Careers Site'],
      Referral: ['Employee Referral'],
    },
    'phoneNumber--countryPhoneCode': {
      '': ['Canada (+1)', 'Mexico (+52)', 'United States of America (+1)'],
    },
    fieldOfStudy: {
      '': [
        'Accounting',
        'Biology',
        'Business Administration',
        'Chemistry',
        'Computer Engineering',
        'Computer Science',
        'Economics',
        'Electrical Engineering',
        'English',
        'Finance',
        'History',
        'Marketing',
        'Mathematics',
        'Mechanical Engineering',
        'Physics',
        'Psychology',
      ],
    },
    'skills--skills': {
      '': ['Product Management', 'Roadmapping', 'SQL (Programming Language)', 'User Research'],
    },
  };
  /** The lists you search that keep any number of picks, as Skills does. */
  const MANY = new Set(['skills--skills']);
  /** The most rows a list you search shows at once, as Workday's draws only those in view. */
  const ROWS = 12;
  const STEPS = [
    'my-information',
    'my-experience',
    'application-questions',
    'voluntary-disclosures',
    'self-identify',
    'review',
  ];
  const words = (element: Element | null) =>
    (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** A list you search's options, by its box: its own, or a field of study's, wherever it is. */
  const searchedOf = (input: Element) =>
    SEARCHED[input.id] ?? (/--fieldOfStudy$/.test(input.id) ? SEARCHED.fieldOfStudy : {}) ?? {};
  /** What's open: a dropdown's list, or a list you search's, and the control it's for. */
  let opened: { control: HTMLElement; popup: HTMLElement; group: string } | null = null;
  const close = () => {
    if (!opened) return;
    const { control, popup } = opened;
    opened = null;
    control.removeAttribute('aria-expanded');
    const menu = popup.querySelector('[visibility]');
    if (menu) {
      // Canvas Kit's list lingers a moment as it closes.
      menu.setAttribute('visibility', 'closing');
      setTimeout(() => popup.remove(), 200);
    } else popup.remove();
    if (control instanceof HTMLInputElement) {
      control.removeAttribute('data-automation-id');
      control.parentElement?.removeAttribute('data-automation-id');
      control.parentElement?.setAttribute('data-automation-hiddensearch', 'false');
    }
  };
  /** A box at the page's end, as Canvas Kit's popups and Workday's are. */
  const atTheEnd = () => {
    const box = doc.createElement('div');
    box.setAttribute('data-behavior-click-outside-close', 'topmost');
    box.setAttribute('data-popper-placement', 'bottom');
    box.style.cssText = 'position: absolute; inset: 0px auto auto 0px; z-index: 30;';
    doc.body.append(box);
    return box;
  };
  /** A dropdown's list, as Canvas Kit draws it, its first option saying to pick one. */
  const openList = (button: HTMLElement) => {
    close();
    const popup = atTheEnd();
    const menu = doc.createElement('div');
    menu.setAttribute('visibility', 'opened');
    const list = doc.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.setAttribute('tabindex', '-1');
    list.id = `menu-${Math.random().toString(36).slice(2, 7)}`;
    const options = ['Select One', ...(LISTS[button.getAttribute('name') ?? ''] ?? [])];
    options.forEach((text, at) => {
      const option = doc.createElement('li');
      option.setAttribute('role', 'option');
      option.id = `opt-${at}`;
      option.setAttribute('data-value', at === 0 ? '' : `${(at * 7919).toString(16)}e4c1f2`);
      if (at === 0) {
        option.setAttribute('aria-selected', 'true');
        option.setAttribute('aria-disabled', 'true');
      }
      const label = doc.createElement('div');
      label.textContent = text;
      option.append(label);
      list.append(option);
    });
    menu.append(list);
    popup.append(menu);
    button.setAttribute('aria-expanded', 'true');
    opened = { control: button, popup, group: '' };
  };
  /** A dropdown's button shows the option picked, and keeps it, as Canvas Kit does. */
  const pickIn = (button: HTMLElement, option: Element) => {
    const text = words(option);
    const id = option.getAttribute('data-value') ?? '';
    const label = doc.querySelector(`label[for="${button.id}"]`);
    const asked = words(label).replace(/\*$/, '');
    button.textContent = text;
    button.setAttribute('value', id);
    button.setAttribute(
      'aria-label',
      `${asked} ${text}${button.closest('[data-automation-id^="formField"]')?.querySelector('abbr') ? ' Required' : ''}`,
    );
    const kept = button.nextElementSibling;
    if (kept instanceof HTMLInputElement) {
      kept.value = id;
      kept.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Picking a country puts the address in again, as Workday's does for each country's.
    if (button.getAttribute('name') === 'country') {
      const address = doc.querySelector('[data-fkit-id="address--null"]');
      const markup = address?.innerHTML ?? '';
      if (address) address.innerHTML = markup;
    }
  };
  /** A list you search's popup, tied to its widget, with a row for each option, a dozen at most. */
  const openSearch = (input: HTMLInputElement, group: string, typed: string | null) => {
    close();
    const widget = input.getAttribute('data-uxi-multiselect-id') ?? '';
    const groups = searchedOf(input);
    const flat = Object.keys(groups).every((name) => name === '');
    let rows: { text: string; group: boolean }[];
    let title = '';
    if (typed !== null) {
      // Only a list with no groups looks up what's typed: one with groups shows them all.
      const wanted = typed.trim().toLowerCase();
      const found = flat
        ? (groups[''] ?? []).filter((text) => text.toLowerCase().includes(wanted))
        : [];
      if (found.length === 0) title = 'No matches found';
      rows = found.length > 0 ? found.map((text) => ({ text, group: false })) : top(groups);
    } else if (group) {
      rows = (groups[group] ?? []).map((text) => ({ text, group: false }));
      title = group;
    } else rows = top(groups);
    const popup = atTheEnd();
    const prompt = doc.createElement('div');
    prompt.setAttribute('data-associated-widget', widget);
    prompt.setAttribute('data-automation-id', 'responsiveMonikerPrompt');
    prompt.setAttribute('data-uxi-widget-type', 'prompt');
    const header = doc.createElement('div');
    header.setAttribute('data-automation-id', 'multiSelectHeader');
    if (group) {
      const back = doc.createElement('div');
      back.setAttribute('data-automation-id', 'backButton');
      back.setAttribute('role', 'button');
      back.setAttribute('aria-label', 'Back');
      header.append(back);
    }
    const heading = doc.createElement('div');
    heading.setAttribute('data-automation-id', 'promptTitle');
    heading.textContent = title;
    header.append(heading);
    const list = doc.createElement('div');
    list.setAttribute('data-automation-id', 'activeListContainer');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Options Expanded');
    const shown = doc.createElement('div');
    shown.setAttribute('role', 'presentation');
    rows.slice(0, ROWS).forEach((row, at) => {
      const item = doc.createElement('div');
      item.setAttribute('data-automation-id', 'menuItem');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-posinset', String(at + 1));
      item.setAttribute('aria-setsize', String(rows.length));
      item.setAttribute('aria-label', `${row.text} not checked`);
      const leaf = doc.createElement('div');
      leaf.setAttribute('data-automation-id', 'promptLeafNode');
      leaf.setAttribute('data-uxi-multiselectlistitem-type', row.group ? '2' : '1');
      leaf.setAttribute('data-uxi-multiselectlistitem-hassidecharm', String(row.group));
      if (!row.group) {
        const radio = doc.createElement('input');
        radio.type = 'radio';
        radio.setAttribute('data-automation-id', 'radioBtn');
        radio.tabIndex = -1;
        leaf.append(radio);
      }
      const label = doc.createElement('div');
      label.setAttribute('data-automation-id', 'promptOption');
      label.setAttribute('data-automation-label', row.text);
      label.textContent = row.text;
      leaf.append(label);
      item.append(leaf);
      shown.append(item);
    });
    list.append(shown);
    prompt.append(header, list);
    popup.append(prompt);
    input.setAttribute('data-automation-id', 'searchBox');
    input.parentElement?.setAttribute('data-automation-id', 'monikerSearchBox');
    input.parentElement?.setAttribute('data-automation-hiddensearch', 'true');
    opened = { control: input, popup, group };
  };
  const top = (groups: Record<string, string[]>) =>
    Object.entries(groups).flatMap(([group, options]) =>
      group ? [{ text: group, group: true }] : options.map((text) => ({ text, group: false })),
    );
  /** A list you search keeps the option picked as a pill beside its box, in place of any before, for one. */
  const keep = (input: HTMLInputElement, text: string) => {
    const box = input.closest('[data-automation-id="multiselectInputContainer"]');
    if (!box) return;
    let kept = box.querySelector('[data-automation-id="selectedItemList"]');
    if (!kept) {
      const wrapper = doc.createElement('div');
      wrapper.tabIndex = -1;
      kept = doc.createElement('ul');
      kept.setAttribute('role', 'listbox');
      kept.setAttribute('data-automation-id', 'selectedItemList');
      kept.setAttribute('aria-label', 'items selected');
      wrapper.append(kept);
      box.querySelector('[data-automation-hiddensearch]')?.after(wrapper);
    }
    const item = doc.createElement('li');
    item.setAttribute('role', 'presentation');
    item.setAttribute('data-automation-id', 'menuItem');
    const pill = doc.createElement('div');
    pill.setAttribute('role', 'option');
    pill.setAttribute('data-automation-id', 'selectedItem');
    pill.setAttribute('title', text);
    pill.setAttribute('aria-label', `${text}, press delete to clear value.`);
    const clear = doc.createElement('div');
    clear.setAttribute('data-automation-id', 'DELETE_charm');
    clear.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('p');
    label.setAttribute('data-automation-id', 'promptOption');
    label.setAttribute('data-automation-label', text);
    label.textContent = text;
    pill.append(clear, label);
    item.append(pill);
    if (MANY.has(input.id)) kept.append(item);
    else kept.replaceChildren(item);
    input.value = '';
    const count = kept.children.length;
    const said = box.querySelector('[data-automation-id="promptAriaInstruction"]');
    if (said) said.textContent = `${count} item${count === 1 ? '' : 's'} selected`;
  };
  /**
   * Adds a part for another job or school, as a copy of the section's last one, with nothing in
   * it, its ids from Workday's own counter, and its heading the next number.
   */
  let counter = 300;
  const add = (button: Element) => {
    const section = button.closest('[role="group"][aria-labelledby$="-section"]');
    const parts = [...(section?.querySelectorAll(':scope > [role="group"]') ?? [])];
    const last = parts.at(-1);
    if (!section || !last) return;
    const n = parts.length + 1;
    const from = /data-fkit-id="([a-zA-Z]+)-(\d+)--null"/.exec(last.outerHTML);
    if (!from) return;
    counter += 1;
    const made = doc.createElement('template');
    made.innerHTML = last.outerHTML
      .replaceAll(`${from[1]}-${from[2]}--`, `${from[1]}-${counter}--`)
      .replace(/-(\d+)-panel"/g, `-${n}-panel"`)
      .replace(/(<h5[^>]*>[^<]*?) \d+</, `$1 ${n}<`)
      .replaceAll(/label(\d{3})(\d)"/g, `label${counter}$2"`);
    const copy = made.content.firstElementChild as HTMLElement;
    for (const input of copy.querySelectorAll('input, textarea')) {
      (input as HTMLInputElement).value = '';
      input.removeAttribute('value');
      (input as HTMLInputElement).checked = false;
    }
    for (const dropdown of copy.querySelectorAll('button[aria-haspopup="listbox"]')) {
      dropdown.textContent = 'Select One';
      dropdown.setAttribute('value', '');
    }
    for (const pills of copy.querySelectorAll('[data-automation-id="selectedItemList"]')) {
      pills.parentElement?.remove();
    }
    for (const display of copy.querySelectorAll('[data-automation-id$="-display"]')) {
      display.textContent = /Month/.test(display.id)
        ? 'MM'
        : /Day/.test(display.id)
          ? 'DD'
          : 'YYYY';
    }
    for (const part of copy.querySelectorAll('input[role="spinbutton"]')) {
      part.removeAttribute('aria-valuenow');
    }
    last.after(copy);
    button.textContent = 'Add Another';
  };
  /** Swaps the next page of the application in, as Save and Continue does, in the same tab. */
  const next = async () => {
    const now = words(
      doc.querySelector('[data-automation-id="progressBarActiveStep"] label:last-of-type'),
    );
    const at = STEPS.findIndex((step) => step.replace(/-/g, ' ') === now.toLowerCase());
    const step = STEPS[at + 1];
    if (!pages || !step) return;
    // Workday saves the page to its server first, which takes a moment.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const page = new DOMParser().parseFromString(
      await (await fetch(`${pages}workday-${step}.html`)).text(),
      'text/html',
    );
    const progress = doc.querySelector('[data-automation-id="progressBar"]');
    const into = page.querySelector('[data-automation-id="progressBar"]');
    if (progress && into) progress.innerHTML = into.innerHTML;
    const main = doc.getElementById('mainContent');
    const content = page.getElementById('mainContent');
    if (main && content) main.innerHTML = content.innerHTML;
    doc.defaultView?.scrollTo(0, 0);
  };
  // A press anywhere but what's open closes it, as Canvas Kit's and Workday's popups do.
  doc.addEventListener('mousedown', (event) => {
    const target = event.target as Element;
    if (opened && !opened.popup.contains(target) && !opened.control.contains(target)) close();
  });
  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const option = target.closest('[data-behavior-click-outside-close] li[role="option"]');
    if (option && opened && !(opened.control instanceof HTMLInputElement)) {
      if (option.getAttribute('aria-disabled') !== 'true') pickIn(opened.control, option);
      close();
      return;
    }
    const back = target.closest('[data-automation-id="backButton"]');
    if (back && opened?.control instanceof HTMLInputElement) {
      openSearch(opened.control, '', null);
      return;
    }
    const row = target.closest(
      '[data-automation-id="responsiveMonikerPrompt"] [data-automation-id="menuItem"]',
    );
    if (row && opened?.control instanceof HTMLInputElement) {
      const input = opened.control;
      const leaf = row.querySelector('[data-automation-id="promptLeafNode"]');
      const text =
        row
          .querySelector('[data-automation-id="promptOption"]')
          ?.getAttribute('data-automation-label') ?? '';
      // A group shows its own options; one of them is kept, and a list that keeps one closes.
      if (leaf?.getAttribute('data-uxi-multiselectlistitem-type') === '2') {
        openSearch(input, text, null);
        return;
      }
      keep(input, text);
      if (!MANY.has(input.id)) close();
      return;
    }
    const clear = target.closest('[data-automation-id="DELETE_charm"]');
    if (clear) {
      const kept = clear.closest('[data-automation-id="selectedItemList"]');
      clear.closest('li')?.remove();
      if (kept && kept.children.length === 0) kept.parentElement?.remove();
      return;
    }
    const dropdown = target.closest('button[aria-haspopup="listbox"]');
    if (dropdown instanceof HTMLElement) {
      if (opened?.control === dropdown) close();
      else openList(dropdown);
      return;
    }
    const search = target
      .closest('[data-automation-id="multiselectInputContainer"]')
      ?.querySelector('input');
    if (search instanceof HTMLInputElement) {
      if (opened?.control !== search) openSearch(search, '', null);
      return;
    }
    const button = target.closest('button');
    const said = words(button);
    if (button?.getAttribute('data-automation-id') === 'add-button') {
      add(button);
      return;
    }
    if (button?.getAttribute('data-automation-id') === 'pageFooterNextButton') {
      if (said === 'Submit') counts.workdaySubmits = (counts.workdaySubmits ?? 0) + 1;
      else {
        counts.workdayNexts = (counts.workdayNexts ?? 0) + 1;
        void next();
      }
    }
  });
  doc.addEventListener('change', (event) => {
    // Self Identify's boxes take one tick: the others can't be ticked meanwhile.
    const box = event.target as Element;
    if (!(box instanceof HTMLInputElement) || !/-disabilityStatus$/.test(box.id)) return;
    for (const other of doc.querySelectorAll<HTMLInputElement>('input[id$="-disabilityStatus"]')) {
      if (other !== box) other.disabled = box.checked;
    }
  });
  doc.addEventListener('keydown', (event) => {
    const target = event.target as Element;
    // A list you search looks up what's typed only on Enter, by its key code, as Workday checks.
    const search = target.closest('[data-automation-id="multiselectInputContainer"] input');
    if (search instanceof HTMLInputElement && event.keyCode === 13) {
      event.preventDefault();
      openSearch(search, '', search.value);
      // A list that keeps one keeps the only one it found itself.
      const found = opened?.popup.querySelectorAll('[data-uxi-multiselectlistitem-type="1"]');
      const titled = words(
        opened?.popup.querySelector('[data-automation-id="promptTitle"]') ?? null,
      );
      if (!MANY.has(search.id) && found?.length === 1 && !titled) {
        keep(
          search,
          found[0]
            ?.querySelector('[data-automation-id="promptOption"]')
            ?.getAttribute('data-automation-label') ?? '',
        );
        close();
      }
      return;
    }
    // A date's month, day or year takes digits a key at a time, and shows them beside its box.
    const part = target.closest('input[role="spinbutton"]');
    if (!(part instanceof HTMLInputElement)) return;
    const display = part.parentElement?.querySelector('[data-automation-id$="-display"]');
    const year = /Year/.test(part.id);
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      const typed = `${part.dataset.typed ?? ''}${event.key}`.slice(year ? -4 : -2);
      part.dataset.typed = typed;
      const value = String(Number(typed));
      part.value = value;
      part.setAttribute('aria-valuenow', value);
      part.setAttribute('aria-valuetext', value);
      if (display) display.textContent = year ? typed : typed.padStart(2, '0');
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      part.dataset.typed = '';
      part.value = '';
      part.removeAttribute('aria-valuenow');
      if (display)
        display.textContent = /Month/.test(part.id) ? 'MM' : /Day/.test(part.id) ? 'DD' : 'YYYY';
    }
  });
  // A date's box shows only what its keys put in it: a value set any other way goes back.
  doc.addEventListener('input', (event) => {
    const part = (event.target as Element).closest('input[role="spinbutton"]');
    if (part instanceof HTMLInputElement) part.value = part.getAttribute('aria-valuenow') ?? '';
  });
}

/** Workday's own code, as its page runs it, with the next pages of its application at `pages`. */
export const workdayCode = (pages: string) =>
  `<script>(${workdayActs.toString()})(document, ${JSON.stringify(pages)});</script>`;
