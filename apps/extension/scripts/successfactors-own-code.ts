// SAP SuccessFactors' own code on its career site's application page, as the end-to-end runs and
// the tests act it out: a page saved without it has lists that never open, calendars with no
// insides, and rows that never come. This follows the public captures of its responsive
// application page from 2024 to October 2026, and the source of its juic components, for a made-up
// company, Copperline Utilities. No page was saved from a real application for this.

/**
 * SuccessFactors' own code on its application page, as it works: its paginated picklists, a box
 * that opens its list, once clicked, in a popup of its own at the page's end, the box naming it by
 * its ID, which shows a page of options at a time (a few here, a hundred there) and filters them
 * as you type, keeps only an option clicked on, puts back what it had once you leave it otherwise,
 * and leaves its popup in the page once it's closed; a country's list that empties and fills its
 * state's list anew; its own radio buttons, spans with that role; UI5's calendars, each keeping
 * its box inside its insides, a shadow root it leaves open, which keep a date typed as MM/DD/YYYY
 * once you leave the box, and send the form on Enter, as UI5's boxes do; Add, which adds a row for
 * another job or school in place, and Remove; and the form's own sending, Apply's and Save's,
 * which only count how often they happen, in `sfSubmits`, `sfApplies` and `sfSaves`. The options
 * are made up. It holds everything it needs, as the page runs it.
 */
export function successFactorsActs(doc: Document): void {
  // A page a test parsed has no window: what's counted goes on the document.
  const page = (doc.defaultView ?? doc) as {
    sfSubmits?: number;
    sfApplies?: number;
    sfSaves?: number;
  };
  page.sfSubmits = 0;
  page.sfApplies = 0;
  page.sfSaves = 0;
  // The page's own handlers, inline, call juic, which acts here through the listeners below: a
  // script of the page's own sets it, where its handlers find it.
  const stand = doc.createElement('script');
  stand.textContent = 'window.juic = { fire: function () {} };';
  (doc.head ?? doc.body).append(stand);
  /** How many options a list shows at a time: SuccessFactors' show a hundred. */
  const PAGE = 8;
  const LISTS: Record<string, string[]> = {
    Country: [
      'Argentina',
      'Australia',
      'Austria',
      'Belgium',
      'Brazil',
      'Canada',
      'Denmark',
      'France',
      'Germany',
      'India',
      'Ireland',
      'Mexico',
      'Netherlands',
      'Spain',
      'United Kingdom',
      'United States',
      'United States Minor Outlying Islands',
      'Uruguay',
    ],
    'Type of Business': ['Energy', 'Financial Services', 'Software', 'Utilities', 'Other'],
    'How did you hear about this position?': [
      'Company Website',
      'Employee Referral',
      'Job Board',
      'LinkedIn',
      'Other',
    ],
    'Race/Ethnicity': [
      'American Indian or Alaska Native (not Hispanic or Latino)',
      'Asian (not Hispanic or Latino)',
      'Black or African American (not Hispanic or Latino)',
      'Hispanic or Latino',
      'White (not Hispanic or Latino)',
      'Two or More Races (not Hispanic or Latino)',
      'Decline to self-identify',
    ],
    'Veteran Status': [
      'I am not a protected veteran',
      'I identify as one or more of the classifications of protected veteran',
      'I do not wish to self-identify',
    ],
    Degree: [
      'High School Diploma',
      "Associate's Degree",
      "Bachelor's Degree",
      "Master's Degree",
      'Doctorate',
      'Other',
    ],
    Major: ['Business', 'Computer Science', 'Economics', 'Engineering', 'Mathematics', 'Other'],
  };
  const STATES: Record<string, string[]> = {
    'United States': [
      'Arizona',
      'California',
      'Colorado',
      'Illinois',
      'New York',
      'Texas',
      'Utah',
      'Washington',
      'Wyoming',
    ],
    Canada: ['Alberta', 'British Columbia', 'Ontario', 'Quebec'],
  };
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const esc = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const app = doc.body;

  // Its paginated picklists.
  const PICKLIST = 'input.rcmpaginatedselectinput';
  /** What each list kept last, as its box shows it. */
  const kept = new WeakMap<HTMLInputElement, string>();
  const keptIn = (box: HTMLInputElement) => kept.get(box) ?? box.getAttribute('value') ?? '';
  const boxOf = (label: string) =>
    doc.querySelector<HTMLInputElement>(`${PICKLIST}[aria-label="${label}"]`);
  const optionsOf = (box: HTMLInputElement) =>
    box.getAttribute('aria-label') === 'State/Province'
      ? (STATES[keptIn(boxOf('Country') ?? box)] ?? [])
      : (LISTS[box.getAttribute('aria-label') ?? ''] ?? []);
  /** The popup a box's list is in, made the first time it opens, at the page's end. */
  const listOf = (box: HTMLInputElement): HTMLElement => {
    const id = box.getAttribute('aria-owns') ?? '';
    const found = doc.getElementById(id);
    if (found) return found;
    const popup = doc.createElement('div');
    popup.className = 'sfoverlaycontainer';
    popup.style.position = 'absolute';
    popup.innerHTML = `<div class="globalMenu sf-combo-listselect"><ul id="${esc(id)}" class="sf-list-select fd-list" role="listbox"></ul></div>`;
    app.append(popup);
    return doc.getElementById(id) as HTMLElement;
  };
  const popupOf = (box: HTMLInputElement) =>
    listOf(box).closest('.sfoverlaycontainer') as HTMLElement;
  const say = (box: HTMLInputElement, words: string) => {
    const status = doc.getElementById(`${box.id.replace(/_input$/, '')}_autocompleteStatus`);
    if (status) status.textContent = words;
  };
  /** Opens a box's list, a page of the options that hold what's typed, as juic filters them. */
  const open = (box: HTMLInputElement, filter: string) => {
    if (box.disabled) return;
    const list = listOf(box);
    const items = list.id.replace(/_listSelect$/, '');
    const words = plain(filter);
    const shown = ['No Selection', ...optionsOf(box)]
      .filter((label) => !words || plain(label).includes(words))
      .slice(0, PAGE);
    list.innerHTML = shown
      .map(
        (label, at) =>
          `<li id="${esc(items)}item${at}" role="option" class="globalMenuItem"><a title="${esc(label)}">${esc(label)}</a></li>`,
      )
      .join('');
    popupOf(box).style.display = '';
    box.setAttribute('aria-expanded', 'true');
    say(
      box,
      shown.length > 0
        ? 'One or more results available. Press Up or Down Arrow Keys to navigate the selection list.'
        : 'There were no results',
    );
  };
  const close = (box: HTMLInputElement) => {
    if (box.getAttribute('aria-expanded') !== 'true') return;
    popupOf(box).style.display = 'none';
    box.setAttribute('aria-expanded', 'false');
    say(box, '');
  };
  const keep = (box: HTMLInputElement, value: string) => {
    box.value = value;
    box.title = value || (box.getAttribute('aria-label') ?? '');
    kept.set(box, value);
  };
  /** Keeps an option picked, as juic's setValue does, and tells the page it changed. */
  const pick = (box: HTMLInputElement, label: string) => {
    keep(box, label === 'No Selection' ? '' : label);
    close(box);
    box.dispatchEvent(new Event('change', { bubbles: true }));
    // A country's state starts over, with that country's states, or none.
    if (box.getAttribute('aria-label') === 'Country') {
      const state = boxOf('State/Province');
      if (state) {
        keep(state, '');
        state.disabled = box.value === '' || !STATES[box.value];
        if (state.disabled) state.removeAttribute('role');
        else state.setAttribute('role', 'combobox');
      }
    }
  };
  for (const box of doc.querySelectorAll<HTMLInputElement>(PICKLIST)) kept.set(box, box.value);

  // UI5's calendars, each with its box in its insides.
  const CALENDAR = 'ui5-date-picker-xweb-calendar-widget';
  const drawn = new WeakSet<Element>();
  /** Draws each calendar's insides, in a part of the page, as UI5 does. */
  const upgrade = (root: ParentNode) => {
    for (const host of root.querySelectorAll(CALENDAR)) {
      if (drawn.has(host)) continue;
      drawn.add(host);
      calendar(host);
    }
  };
  const WHOLE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  function calendar(host: Element): void {
    const name = host.getAttribute('accessible-name') ?? '';
    const placeholder = host.getAttribute('placeholder') ?? '';
    const outer = host.attachShadow({ mode: 'open' });
    outer.innerHTML = `<div class="ui5-date-picker-root"><ui5-datetime-input-xweb-calendar-widget data-sap-focus-ref="true" class="ui5-date-picker-input" part="input" ui5-datetime-input="" placeholder="${esc(placeholder)}" type="Text" value-state="None"></ui5-datetime-input-xweb-calendar-widget></div>`;
    const field = outer.querySelector('ui5-datetime-input-xweb-calendar-widget') as Element;
    const inner = field.attachShadow({ mode: 'open' });
    inner.innerHTML = `<div class="ui5-input-root ui5-input-focusable-element" part="root"><div class="ui5-input-content"><input id="inner" part="input" class="ui5-input-inner" type="text" inner-input="true" inner-input-with-icon="true" placeholder="${esc(placeholder)}" aria-haspopup="grid" aria-roledescription="Date Input" aria-label="${esc(name)}" aria-required="${host.hasAttribute('required')}" autocomplete="off" data-sap-focus-ref="true"><div class="ui5-input-icon-root" tabindex="-1"><slot name="icon"></slot></div></div></div>`;
    const box = inner.querySelector('input') as HTMLInputElement;
    box.value = host.getAttribute('value') ?? '';
    const keepDate = () => {
      const said = box.value.trim();
      if (said === (host.getAttribute('value') ?? '')) return;
      const valid = said === '' || WHOLE.test(said);
      host.setAttribute('value-state', valid ? 'None' : 'Negative');
      if (!valid) return;
      host.setAttribute('value', said);
      host.dispatchEvent(
        new CustomEvent('change', {
          bubbles: true,
          composed: true,
          detail: { value: said, valid },
        }),
      );
    };
    box.addEventListener('change', keepDate);
    box.addEventListener('focusout', keepDate);
    // UI5's boxes send their form on Enter.
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.keyCode === 13) {
        keepDate();
        (host.closest('form') as HTMLFormElement | null)?.requestSubmit();
      }
    });
  }

  // Rows for another job or school, as Add adds them.
  let ids = 400;
  /** The next IDs, as juic numbers its components in the order it makes them. */
  const idsFor = (count: number) => {
    ids += count;
    return ids;
  };
  const STAR = '<span class="requiredField" aria-hidden="true" role="presentation">*</span>';
  const textField = (label: string, name: string, required: boolean) => {
    const n = idsFor(4);
    return `<div class="col-md-4 col-xs-12 col-sm-4"><div class="RCMFormField rcmFormElement "><label id="${n + 2}:" for="${n}:_txtFld" class="rcmFormFieldLabel">${required ? STAR : ''}${label}</label><div class="fieldComponentInput" id="${n + 1}:_fieldComponentInput"><div id="${n}:" class="sfTextFieldCss fd-form-item fd-form-item--horizontal"><input data-testid="sfTextField" name="${name}" id="${n}:_txtFld" value="" class="fd-input " type="text" maxlength="4000" aria-required="${required}"></div><div tabindex="-1" aria-live="assertive" role="alert" id="${n + 3}:" class="rcmValidationMsgArea displayNone"></div></div></div></div>`;
  };
  const dateField = (label: string, required: boolean) => {
    const n = idsFor(4);
    return `<div class="col-md-4 col-xs-12 col-sm-4"><div class="RCMFormField rcmFormElement "><label id="${n + 2}:" for="${n}:_datepicker" class="rcmFormFieldLabel">${required ? STAR : ''}${label}</label><div class="fieldComponentInput" id="${n + 1}:_fieldComponentInput"><div id="${n}:_datepicker" class="datePicker"><div><${CALENDAR} data-testid="datePicker" title="${label}" accessible-name="${label}" value="" format-pattern="MM/dd/yyyy" placeholder="MM/DD/YYYY"${required ? ' required=""' : ''} value-state="None" ui5-date-picker=""></${CALENDAR}></div></div><div tabindex="-1" aria-live="assertive" role="alert" id="${n + 3}:" class="rcmValidationMsgArea displayNone"></div></div></div></div>`;
  };
  const pickField = (label: string, required: boolean) => {
    const n = idsFor(6);
    return `<div class="col-md-4 col-xs-12 col-sm-4"><div class="RCMFormField rcmFormElement "><label id="${n + 4}:" for="${n}:_input" class="rcmFormFieldLabel">${required ? STAR : ''}${label}</label><div class="fieldComponentInput" id="${n + 3}:_fieldComponentInput"><span id="${n + 2}:" class="sfCascadingPicklist"><div id="${n}:_selectContainer" class="paginatedPicklistContainer fd-input-group fd-input-group--control "><div class="sr-only"><div id="${n}:_autocompleteStatus" role="status" aria-atomic="true" aria-live="polite"></div></div><input aria-label="${label}" autocomplete="off" type="text" placeholder="No Selection" title="${label}" aria-owns="${n + 1}:_listSelect" role="combobox" aria-required="${required}" class="rcmpaginatedselectinput rcmpaginatedselectitem rcmpaginatedselect_accessible fd-input fd-input-group__input " aria-expanded="false" id="${n}:_input" size="20" value=""><button aria-label="${label}" tabindex="-1" class="rcmpaginatedselectbutton rcmpaginatedselectbutton_accessible rcmpaginatedselectitem fd-select__button fd-input-group__button fd-button fd-button--transparent" type="button" id="${n}:_selectButton" title="${label}"><span class="ui5"></span></button></div></span><div tabindex="-1" aria-live="assertive" role="alert" id="${n + 5}:" class="rcmValidationMsgArea displayNone"></div></div></div></div>`;
  };
  const row = (part: string, at: number) => {
    const n = idsFor(2);
    const fields = /education/i.test(part)
      ? [
          textField('School', 'VFLD1', true),
          pickField('Degree', true),
          pickField('Major', false),
          dateField('Start Date', false),
          dateField('End Date', false),
        ]
      : [
          textField('Company Name', 'VFLD1', true),
          textField('Title', 'VFLD3', true),
          dateField('Start Date', true),
          dateField('End Date', false),
          pickField('Type of Business', false),
        ];
    return `<div><span id="${n}:_rowNum" tabindex="-1" class="hiddenAriaContent rowNumTextAcc">Row number ${at}</span><div id="${n}:_sectionComponent" class="layoutWrapper row rcmSectionComponent rowBreak"><div class="leftColumn col-xs-12"><div class="row">${fields.join('')}<div id="${n}:_deleteIcon" class="col-xs-12" style="display: block"><div role="button" title="Delete Row" tabindex="0" class="iconHolder"><span role="presentation" class="delete_icon sapIcon"></span>Remove<span class="hiddenAriaContent" aria-label="${esc(part)}"></span></div></div></div></div></div></div>`;
  };
  /** Says how many rows a part has, and that it has none, as the page does. */
  const counted = (container: Element, part: string) => {
    const rows = [...container.children].filter((each) => each.querySelector('.rowNumTextAcc'));
    rows.forEach((each, at) => {
      const number = each.querySelector('.rowNumTextAcc');
      if (number) number.textContent = `Row number ${at + 1}`;
    });
    const none = container.querySelector<HTMLElement>('.noItemsInSection');
    if (none) none.style.display = rows.length > 0 ? 'none' : '';
    const said = container.querySelector('[id$=":_noItems"]');
    if (said) said.textContent = `${part} section with ${rows.length} rows`;
    return rows.length;
  };
  const partOf = (element: Element) => {
    const section = element.closest('.rcmFormSection');
    const title = section?.querySelector(
      '.rcmFormSectionTopBar > span:not([aria-hidden]):not(.hiddenAriaContent)',
    );
    return { section, part: title?.textContent?.trim() ?? '' };
  };

  app.addEventListener('click', (event) => {
    const target = event.target as Element;
    const option = target.closest('.sfoverlaycontainer [role="option"]');
    const box =
      (target.closest(PICKLIST) as HTMLInputElement | null) ??
      (target
        .closest('.rcmpaginatedselectbutton')
        ?.parentElement?.querySelector(PICKLIST) as HTMLInputElement | null);
    // A click anywhere else closes the lists that are open.
    for (const each of doc.querySelectorAll<HTMLInputElement>(PICKLIST)) {
      if (each !== box && !option) close(each);
    }
    if (option) {
      const list = option.closest('[role="listbox"]');
      const owner = [...doc.querySelectorAll<HTMLInputElement>(PICKLIST)].find(
        (each) => each.getAttribute('aria-owns') === list?.id,
      );
      if (owner) pick(owner, option.textContent?.trim() ?? '');
      return;
    }
    if (box) {
      if (box.getAttribute('aria-expanded') === 'true') close(box);
      else open(box, '');
      return;
    }
    // Its own radio buttons: the one clicked is picked, and the others in its group let go.
    const radio =
      target.closest('.radioCheck') ?? target.closest('[role="radio"]')?.closest('.radioCheck');
    if (radio) {
      const group = radio.closest('[role="radiogroup"]');
      for (const each of group?.querySelectorAll('.radioCheck') ?? []) {
        const on = each === radio;
        each.classList.toggle('radioOn', on);
        each.classList.toggle('radioOff', !on);
        each.querySelector('[role="radio"]')?.setAttribute('aria-checked', String(on));
        each.querySelector('[role="radio"]')?.setAttribute('tabindex', on ? '0' : '-1');
      }
      return;
    }
    const add = target.closest('.addRowButton');
    if (add) {
      const { section, part } = partOf(add);
      const container = section?.querySelector('[id$=":_bgElementContainer"]');
      if (!container) return;
      const rows = counted(container, part);
      const none = container.querySelector('.noItemsInSection');
      none?.insertAdjacentHTML('beforebegin', row(part, rows + 1));
      counted(container, part);
      upgrade(container);
      return;
    }
    const remove = target.closest('[title="Delete Row"]');
    if (remove) {
      const { section, part } = partOf(remove);
      const container = section?.querySelector('[id$=":_bgElementContainer"]');
      remove.closest('.rcmSectionComponent')?.parentElement?.remove();
      if (container) counted(container, part);
      return;
    }
    if (target.closest('[id$=":_submitBtn"]')) page.sfApplies = (page.sfApplies ?? 0) + 1;
    if (target.closest('[id$=":_saveBtn"]')) page.sfSaves = (page.sfSaves ?? 0) + 1;
  });
  // Typing in a list's box filters its options; Escape closes it, and it keeps Enter to itself.
  app.addEventListener('keyup', (event) => {
    const box = (event.target as Element).closest?.(PICKLIST) as HTMLInputElement | null;
    if (!box || ['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    open(box, box.value);
  });
  app.addEventListener('keydown', (event) => {
    const box = (event.target as Element).closest?.(PICKLIST) as HTMLInputElement | null;
    if (!box) return;
    if (event.key === 'Escape') close(box);
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  // Leaving a list's box with words it has no option for puts back what it kept.
  app.addEventListener('focusout', (event) => {
    const box = (event.target as Element).closest?.(PICKLIST) as HTMLInputElement | null;
    if (box && box.value !== keptIn(box)) box.value = keptIn(box);
  });
  // The form's own sending, as Enter in a box would: counted, and never sent.
  doc.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    page.sfSubmits = (page.sfSubmits ?? 0) + 1;
  });

  upgrade(doc);
}

/** SuccessFactors' own code, as its application page runs it. */
export const successFactorsCode = () =>
  `<script>(${successFactorsActs.toString()})(document);</script>`;
