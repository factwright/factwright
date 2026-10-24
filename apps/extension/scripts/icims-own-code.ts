// iCIMS's own code on its application's pages, as the end-to-end runs and the tests act it out:
// a page saved without it has its lists as plain selects, kept hidden, and Add More does nothing.
// This follows public captures of iCIMS's career portal from 2022 to October 2026, and the source
// of its icimsDropdown widget, for a made-up company, Bramblecrest Robotics. No page was saved from
// a real application for this, and nothing was signed in to.

/**
 * iCIMS's own code on a page of its application, as it works: each list its server marks as one
 * becomes iCIMS's dropdown, a link that shows the option picked, beside its list, kept hidden, and
 * a box that searches it, which opens when the mouse goes down on the link, shows the options from
 * the server a page of 25 at a time, a moment later, searches half a second after a key comes up
 * in its box, keeps only an option clicked on, which a list from the server keeps as its select's
 * only option, and closes when the mouse goes down elsewhere; a country's state starts over once
 * the country changes; Add More adds a block for another job or school in place, as iCIMS fetches
 * it, and hides its own row; and the form's sending, as Enter in a box or its buttons do, and its
 * resume box's, which sends the form to read the resume into it, only count how often they happen,
 * in `icimsSubmits` and `icimsResumePosts`. The options are made up. It holds everything it needs,
 * as the page runs it.
 */
export function icimsActs(doc: Document): void {
  // A page a test parsed has no window: what's counted goes on the document.
  const page = (doc.defaultView ?? doc) as {
    icimsSubmits?: number;
    icimsResumePosts?: number;
  };
  page.icimsSubmits = 0;
  page.icimsResumePosts = 0;
  // The page's inline handlers call these, which act here through the listeners below: a script
  // of the page's own sets them, where its handlers find them.
  const stand = doc.createElement('script');
  stand.textContent = `window.pageDirtyFlag = false; ${[
    'SourceChange',
    'icimsChangeParent',
    'showGroup',
    'hideGroup',
    'icims_setFileFieldValue',
    'icimsDisableSaveAndSubmitButtons',
  ]
    .map((name) => `window.${name} = function () {};`)
    .join(' ')}`;
  (doc.head ?? doc.body).append(stand);
  /** How many options a list from the server shows at a time. */
  const PAGE = 25;
  const STATES = [
    'Alabama',
    'Alaska',
    'Arizona',
    'Arkansas',
    'California',
    'Colorado',
    'Connecticut',
    'Delaware',
    'Florida',
    'Georgia',
    'Hawaii',
    'Idaho',
    'Illinois',
    'Indiana',
    'Iowa',
    'Kansas',
    'Kentucky',
    'Louisiana',
    'Maine',
    'Maryland',
    'Massachusetts',
    'Michigan',
    'Minnesota',
    'Mississippi',
    'Missouri',
    'Montana',
    'Nebraska',
    'Nevada',
    'New Hampshire',
    'New Jersey',
    'New Mexico',
    'New York',
    'Oregon',
    'Texas',
    'Utah',
    'Vermont',
    'Virginia',
    'Washington',
    'Wisconsin',
    'Wyoming',
  ];
  const LISTS: Record<string, string[]> = {
    'lists.country': [
      'Argentina',
      'Australia',
      'Austria',
      'Belgium',
      'Brazil',
      'Canada',
      'Chile',
      'China',
      'Colombia',
      'Denmark',
      'Finland',
      'France',
      'Germany',
      'India',
      'Ireland',
      'Israel',
      'Italy',
      'Japan',
      'Mexico',
      'Netherlands',
      'New Zealand',
      'Norway',
      'Poland',
      'Portugal',
      'Singapore',
      'Spain',
      'Sweden',
      'Switzerland',
      'United Kingdom',
      'United States',
    ],
    'lists.school': [
      'Arizona State University',
      'Colorado School of Mines',
      'Colorado State University',
      'Metropolitan State University of Denver',
      'University of Colorado Boulder',
      'University of Colorado Denver',
      'University of Denver',
      'Other - Universities',
      'Other - US Schools',
    ],
    'lists.school.degree': [
      'High School Diploma',
      "Associate's",
      "Bachelor's",
      "Master's",
      'Doctorate',
      'Other',
    ],
    'lists.school.major': [
      'Computer Engineering',
      'Computer Science',
      'Electrical Engineering',
      'Mathematics',
      'Mechanical Engineering',
      'Physics',
      'Robotics',
    ],
  };
  const PLACEHOLDER = '— Make a Selection —';
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const esc = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const app = doc.body;
  // Its stylesheet hides what it marks so.
  const style = doc.createElement('style');
  style.textContent = '.dropdown-invisible, .dropdown-hide, .iCIMS_NoDisplay { display: none; }';
  doc.head?.append(style);

  interface Widget {
    select: HTMLSelectElement;
    anchor: HTMLElement;
    box: HTMLElement;
    search: HTMLInputElement;
    list: HTMLElement;
    timer: number;
    shown: { value: string; label: string }[];
  }
  const widgets = new Map<HTMLElement, Widget>();
  const fromServer = (select: HTMLSelectElement) =>
    select.getAttribute('icimsdropdown-ajax') === '1';
  /** The state a country's list is for, as its parent link names it, by the country picked. */
  const parentOf = (select: HTMLSelectElement): HTMLSelectElement | null => {
    const link = select.getAttribute('data-ddd-parent-link');
    if (!link) return null;
    const prefix = select.id.slice(0, select.id.indexOf('PersonProfileFields.'));
    return doc.getElementById(`${prefix}${link}`) as HTMLSelectElement | null;
  };
  const chosenOf = (select: HTMLSelectElement) => {
    const option = select.selectedOptions[0];
    return option && option.value !== '' && option.value !== '-999' ? option.text : '';
  };
  /** The options a list has for what's searched: from the server, by its list, or its own. */
  const optionsFor = (select: HTMLSelectElement, query: string) => {
    const words = plain(query);
    const all = fromServer(select)
      ? (() => {
          const parent = parentOf(select);
          const labels = parent
            ? chosenOf(parent) === 'United States'
              ? STATES
              : []
            : (LISTS[select.getAttribute('list') ?? ''] ?? []);
          return labels.map((label, at) => ({ value: String(20000 + at), label }));
        })()
      : [...select.options]
          .filter((option) => option.value !== '')
          .map((option) => ({ value: option.value, label: option.text }));
    return all.filter((each) => !words || plain(each.label).includes(words));
  };
  /** What the link shows: the option picked, or that none is. */
  const face = (widget: Widget) => {
    const { select, anchor } = widget;
    const label = select.getAttribute('data-label') ?? '';
    const chosen = chosenOf(select);
    const parent = parentOf(select);
    const empty = parent && !chosenOf(parent) ? 'Please select a country' : PLACEHOLDER;
    const text = anchor.querySelector('.dropdown-text') as HTMLElement;
    text.innerHTML = chosen
      ? esc(chosen)
      : `<span class="dropdown-placeholder">${esc(empty)}</span>`;
    anchor.setAttribute('aria-label', `${label} ${chosen || empty}`);
  };
  const render = (widget: Widget, query: string) => {
    const { select, list } = widget;
    widget.shown = optionsFor(select, query).slice(0, fromServer(select) ? PAGE : undefined);
    const id = select.id;
    const rows = widget.shown.map(
      (each, at) =>
        `<li class="dropdown-result result-selectable" role="option" id="result-selectable_${esc(id)}_${at}" dropdown-index="${at}" title="${esc(each.label)}" aria-label="${esc(each.label)}">${esc(each.label)}</li>`,
    );
    list.innerHTML =
      rows.length > 0
        ? `<li class="dropdown-result result-selectable" role="option" id="result-selectable_${esc(id)}_-1" dropdown-index="-1" title="${PLACEHOLDER}" aria-label="${PLACEHOLDER}"><span class="dropdown-placeholder">${PLACEHOLDER}</span></li>${rows.join('')}`
        : `<li class="dropdown-result result-group result-selectable" role="option" dropdown-index="0" id="result-group_${esc(id)}_0" aria-label="No Results">No Results</li>`;
  };
  const show = (element: HTMLElement, open: boolean) => {
    element.classList.toggle('dropdown-invisible', !open);
    element.style.display = open ? '' : 'none';
  };
  const close = (widget: Widget) => {
    clearTimeout(widget.timer);
    widget.anchor.setAttribute('aria-expanded', 'false');
    widget.anchor.classList.remove('focus');
    widget.box.setAttribute('aria-expanded', 'false');
    show(widget.box, false);
    show(widget.search, false);
    widget.search.setAttribute('aria-hidden', 'true');
  };
  /** Opens a list: a list from the server shows its first page a moment later. */
  const open = (widget: Widget) => {
    for (const other of widgets.values()) if (other !== widget) close(other);
    widget.anchor.setAttribute('aria-expanded', 'true');
    widget.anchor.classList.add('focus');
    widget.box.setAttribute('aria-expanded', 'true');
    show(widget.box, true);
    widget.search.value = '';
    if (widget.select.getAttribute('icimsdropdown-search') === '1') {
      show(widget.search, true);
      widget.search.removeAttribute('aria-hidden');
      widget.search.focus();
    }
    widget.list.innerHTML = '';
    if (!fromServer(widget.select)) return render(widget, '');
    widget.timer = setTimeout(() => render(widget, ''), 150) as unknown as number;
  };
  /** Keeps an option picked, as the widget does, and runs what the page does on a change. */
  const pick = (widget: Widget, index: number) => {
    const { select } = widget;
    const chosen = widget.shown[index];
    if (fromServer(select)) {
      select.innerHTML = chosen
        ? `<option value="${esc(chosen.value)}" selected="selected">${esc(chosen.label)}</option>`
        : '<option value="" legacy="true"></option>';
    } else {
      select.value = chosen?.value ?? '';
    }
    face(widget);
    close(widget);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    // A country's state starts over, empty.
    const child = select.getAttribute('data-ddd-child-link');
    if (child) {
      const prefix = select.id.slice(0, select.id.indexOf('PersonProfileFields.'));
      const state = doc.getElementById(`${prefix}${child}`) as HTMLSelectElement | null;
      const stateWidget = [...widgets.values()].find((each) => each.select === state);
      if (state && stateWidget) {
        state.innerHTML = chosenOf(select)
          ? '<option value="" legacy="true"></option>'
          : '<option value="-999" selected="selected">Please select a country</option>';
        face(stateWidget);
      }
    }
  };
  /** Makes a list that's marked so iCIMS's dropdown, beside it. */
  const build = (select: HTMLSelectElement) => {
    if ([...widgets.values()].some((each) => each.select === select)) return;
    const id = select.id;
    select.classList.add('dropdown-hide');
    const anchor = doc.createElement('a');
    anchor.id = `${id}_icimsDropdown`;
    anchor.className = 'dropdown-select';
    anchor.setAttribute('aria-expanded', 'false');
    anchor.setAttribute('tabindex', '0');
    anchor.setAttribute('role', 'combobox');
    // What's required is the link, not the list it hides.
    if (select.getAttribute('aria-required') === 'true') {
      anchor.setAttribute('aria-required', 'true');
      select.removeAttribute('aria-required');
    }
    anchor.innerHTML = `<span id="${esc(id)}_fakeSelected_icimsDropdown" class="dropdown-text"></span><div class="dropdown-arrow-container"><i class="dropdown-arrow"></i></div>`;
    const box = doc.createElement('div');
    box.id = `${id}_icimsDropdown_ctnr`;
    box.className = 'dropdown-container dropdown-invisible';
    box.setAttribute('aria-owns', `${id}_dropdown-results`);
    box.setAttribute('aria-expanded', 'false');
    box.style.display = 'none';
    box.innerHTML = `<input type="text" class="dropdown-search dropdown-invisible" autocomplete="off" placeholder="— Type to Search —" title="— Type to Search —" aria-label="— Type to Search —" aria-hidden="true" style="display: none"><div aria-live="polite"><ul id="${esc(id)}_dropdown-results" class="dropdown-results" role="listbox"></ul><div class="dropdown-loading hide"></div></div>`;
    select.after(anchor, box);
    const widget: Widget = {
      select,
      anchor,
      box,
      search: box.querySelector('input') as HTMLInputElement,
      list: box.querySelector('ul') as HTMLElement,
      timer: 0,
      shown: [],
    };
    widgets.set(anchor, widget);
    face(widget);
    // Searching looks up what's typed half a second after a key comes up, once it changed.
    let searched = '';
    widget.search.addEventListener('keyup', () => {
      if (widget.search.value === searched) return;
      searched = widget.search.value;
      clearTimeout(widget.timer);
      widget.timer = setTimeout(() => render(widget, searched), 500) as unknown as number;
    });
    widget.list.addEventListener('click', (event) => {
      const row = (event.target as Element).closest('.result-selectable');
      const index = Number(row?.getAttribute('dropdown-index'));
      if (!row || row.classList.contains('result-group')) return;
      if (index === -1) {
        widget.shown = [];
        pick(widget, -1);
      } else pick(widget, index);
    });
  };
  const buildAll = (root: ParentNode) => {
    for (const select of root.querySelectorAll<HTMLSelectElement>(
      'select[icimsdropdown-enabled="1"]',
    )) {
      build(select);
    }
  };

  // The mouse going down on a list's link opens it, and anywhere else closes what's open.
  app.addEventListener('mousedown', (event) => {
    const anchor = (event.target as Element).closest('a.dropdown-select') as HTMLElement | null;
    const widget = anchor ? widgets.get(anchor) : undefined;
    if (widget) {
      if (widget.anchor.getAttribute('aria-expanded') === 'true') close(widget);
      else open(widget);
      return;
    }
    const inside = (event.target as Element).closest('.dropdown-container');
    for (const each of widgets.values()) if (each.box !== inside) close(each);
  });
  app.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' && event.key !== 'Tab') return;
    for (const each of widgets.values()) close(each);
  });

  // Add More adds a block for another job or school after this one, as iCIMS fetches it.
  const DATE = (prefix: string, field: string, label: string) => {
    const id = `${prefix}_PersonProfileFields.${field}`;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
      .map((month, at) => `<option value="${String(at + 1).padStart(2, '0')}">${month}</option>`)
      .join('');
    const days = Array.from(
      { length: 31 },
      (_, at) => `<option value="${at + 1}">${at + 1}</option>`,
    ).join('');
    return `<div role="group" aria-labelledby="label_${id}" class="iCIMS_TableRow iCIMS_FieldRow_Inline"><div class=" iCIMS_InfoField iCIMS_InfoField_Candidate iCIMS_CollectionField iCIMS_TableCell"><label id="label_${id}"><span class="iCIMS_LabelText" name="labelText">${label}</span></label>&nbsp;<label id="label_${id}_desc"><span class="iCIMS_LabelText" name="labelText">(Month / Day / Year)</span></label></div><div class="iCIMS_InfoData iCIMS_InfoData_Candidate iCIMS_CollectionField iCIMS_TableCell"><div class="iCIMS_Forms_Global  iCIMS_Forms_DateOnlyField iCIMS_Forms_Qnull  iCIMS_Table"><div class="iCIMS_TableRow"><div class="iCIMS_DateField-Month iCIMS_TableCell"><label id="label_${id}_Month" class="iCIMS_508_Label" for="${id}_Month">Month</label><select id="${id}_Month" name="${id}_Month" aria-labelledby="label_${id} label_${id}_Month" class="iCIMS_Forms_Global iCIMS_Forms_MonthInput iCIMS_Forms_DropDown form-control"><option value="0"></option>${months}</select></div><div class="iCIMS_DateField-Day iCIMS_TableCell"><label id="label_${id}_Date" class="iCIMS_508_Label" for="${id}_Date">Day</label><select id="${id}_Date" name="${id}_Date" aria-labelledby="label_${id} label_${id}_Date" class="iCIMS_Forms_Global iCIMS_Forms_DayInput iCIMS_Forms_DropDown form-control"><option value="0"></option>${days}</select></div><div class="iCIMS_DateField-Year iCIMS_TableCell"><label id="label_${id}_Year" class="iCIMS_508_Label" for="${id}_Year">Year</label><input type="text" size="6" maxlength="4" id="${id}_Year" name="${id}_Year" aria-labelledby="label_${id} label_${id}_Year" class="iCIMS_Forms_Global iCIMS_Forms_YearInput form-control"></div></div></div></div></div>`;
  };
  const TEXT = (id: string, label: string, long = false) =>
    `<div class="iCIMS_TableRow iCIMS_FieldRow_Inline"><div class=" iCIMS_InfoField iCIMS_InfoField_Candidate iCIMS_CollectionField iCIMS_TableCell"><label id="label_${id}" for="${id}"><span class="iCIMS_LabelText" name="labelText">${label}</span></label></div><div class="iCIMS_InfoData iCIMS_InfoData_Candidate iCIMS_CollectionField iCIMS_TableCell">${long ? `<textarea id="${id}" name="${id}" class="iCIMS_Forms_Global customFieldContainer iCIMS_Forms_TextBox iCIMS_Forms_Qnull form-control" cols="40" rows="10"></textarea>` : `<input type="text" id="${id}" name="${id}" class="iCIMS_Forms_Global customFieldContainer iCIMS_Forms_TextField iCIMS_Forms_Qnull form-control" maxlength="128">`}</div></div>`;
  const LIST = (id: string, label: string, list: string, search: boolean) =>
    `<div class="iCIMS_TableRow iCIMS_FieldRow_Inline"><div class=" iCIMS_InfoField iCIMS_InfoField_Candidate iCIMS_CollectionField iCIMS_TableCell"><label id="label_${id}" for="${id}"><span class="iCIMS_LabelText" name="labelText">${label}</span></label></div><div class="iCIMS_InfoData iCIMS_InfoData_Candidate iCIMS_CollectionField iCIMS_TableCell"><select id="${id}" name="${id}" data-label="${label}" class=" iCIMS_Forms_Global customFieldContainer iCIMS_Forms_ListEditorField iCIMS_Forms_Qnull form-control" list="${list}" icimsdropdown-enabled="1" icimsdropdown-ajax="1" icimsdropdown-search="${search ? 1 : 0}" icimsdropdown-selected=""><option value="" legacy="true"></option></select></div></div>`;
  const BLOCKS: Record<string, { legend: string; fields: (prefix: string) => string }> = {
    rcf3211: {
      legend: 'Professional Experience',
      fields: (prefix) =>
        [
          TEXT(`${prefix}_PersonProfileFields.rcf3212`, 'Employer'),
          TEXT(`${prefix}_PersonProfileFields.rcf3213`, 'Title'),
          DATE(prefix, 'rcf3214', 'Start Date'),
          DATE(prefix, 'rcf3215', 'End Date'),
          TEXT(`${prefix}_PersonProfileFields.rcf3219`, 'Description', true),
        ].join(''),
    },
    'CandProfileFields.Education': {
      legend: 'College Education',
      fields: (prefix) =>
        [
          LIST(`${prefix}_CandProfileFields.School`, 'School', 'lists.school', true),
          TEXT(`${prefix}_CandProfileFields.Minor`, 'If your school was not listed, enter it here'),
          LIST(`${prefix}_CandProfileFields.Degree`, 'Degree', 'lists.school.degree', false),
          LIST(`${prefix}_CandProfileFields.Major`, 'Major', 'lists.school.major', true),
        ].join(''),
    },
  };
  const addMore = (link: HTMLElement) => {
    const [, collection = '', , next = ''] =
      /showGroup\('([^']+)',\s*'(-\d+)',\s*'(-\d+)'/.exec(link.getAttribute('onclick') ?? '') ?? [];
    const block = BLOCKS[collection];
    const container = link.closest('.iCIMS_CollectionContainer');
    if (!block || !container) return;
    const n = Number(next.slice(1));
    const html = `<div tabindex="-1" class="iCIMS_CollectionContainer ${esc(collection)}-${n}-Container"><fieldset class="iCIMS_CollectionGroup"><legend><span tabindex="-1" class="iCIMS_LabelText" name="labelText" id="${esc(collection)}_${next}_label">${block.legend} (${n})</span></legend><input tabindex="-1" type="hidden" name="portalLabel${esc(collection)}-${n}" value="${block.legend} (${n})"><div class="pull-right ${esc(collection)}-${n}-RemoveButton"><a class="iCIMS_Anchor" href="javascript:void(0)" role="button" aria-label="Delete ${block.legend} (${n})" onclick="pageDirtyFlag=true; hideGroup('${esc(collection)}', '${next}', '-${n - 1}')"><span class="glyphicons glyphicons-remove"></span></a></div>${block.fields(next)}</fieldset><div class="iCIMS_CollectionButtonsRow"><div class="iCIMS_CollectionButtons ${esc(collection)}-${n}-Button iCIMS_TableRow"><div></div><div class="iCIMS_InfoData iCIMS_TableCell"><a role="button" class="iCIMS_Anchor" href="javascript:void(0)" onclick="pageDirtyFlag=true; showGroup('${esc(collection)}', '${next}', '-${n + 1}', ${n + 1}, 'recruit')" id="${esc(collection)}Button_${next}">Add More (${block.legend})</a></div></div></div></div>`;
    container.insertAdjacentHTML('afterend', html);
    const row = link.closest('.iCIMS_CollectionButtons') as HTMLElement | null;
    if (row) {
      row.classList.add('iCIMS_NoDisplay');
      row.style.display = 'none';
    }
    const added = container.nextElementSibling;
    if (added) buildAll(added);
    const status = doc.getElementById('portalAriaLiveStatusDiv');
    if (status) status.textContent = `${block.legend} was added.`;
  };

  app.addEventListener('click', (event) => {
    const link = (event.target as Element).closest('a[onclick*="showGroup"]') as HTMLElement | null;
    if (link) {
      event.preventDefault();
      addMore(link);
    }
  });
  // Choosing a resume sends the form, to read the resume into it, which would load the page anew.
  app.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.type === 'file' && /submit\(/.test(input.getAttribute('onchange') ?? '')) {
      page.icimsResumePosts = (page.icimsResumePosts ?? 0) + 1;
    }
  });
  // The form's own sending, as Enter in a box or its buttons do: counted, and never sent.
  for (const form of doc.querySelectorAll('form')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      page.icimsSubmits = (page.icimsSubmits ?? 0) + 1;
    });
  }

  buildAll(doc);
}

/** iCIMS's own code, as its application's pages run it. */
export const icimsCode = () => `<script>(${icimsActs.toString()})(document);</script>`;
