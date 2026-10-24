// SmartRecruiters' own code on its newer application form, "Easy apply", as the end-to-end runs and
// the tests act it out: the form is built of SmartRecruiters' own components, each of which keeps
// its elements in a shadow root it leaves open, and a page saved without its code has none of
// them. This draws each component's insides as public captures of the form show them, from
// September and October 2026, and behaves as its shipped code does, for a made-up company,
// Saltmarsh Robotics. No page was saved from a real application for this, as SmartRecruiters
// shows automated browsers a bot check.

/**
 * SmartRecruiters' components on its form, as they work, which the form's pages saved as fixtures
 * don't have: each one's insides, in a shadow root it leaves open, with its label's words inside,
 * or put in its slot by the page; its value told to the page's form, Angular's, only through its
 * own `spl-change` event, which `srModel` records here, by each field's name; a list that offers
 * places, titles, companies and schools as you type, from 3 or 2 letters, a title's, company's and
 * school's first row being what you typed, and that keeps only an option clicked on, inside the
 * option's own insides, putting back what it had otherwise once you leave it; a phone's country
 * code; a date's month and year, kept only once you press Enter or leave the box, as MM/YYYY or
 * YYYY-MM; radio buttons that are the page's own; a box to drop a file in; Add, which opens a part
 * for a job or school in place, with Save and Cancel; and Next, which brings in the screening
 * questions in the same tab, from `pages`, or not at all where it names none. Submit only counts
 * how often it's pressed, in `srSubmits`, as Next's presses are in `srNexts`. The options are made
 * up. It holds everything it needs, as the page runs it.
 */
export function smartRecruitersActs(doc: Document, pages: string): void {
  // A page a test parsed has no window: what's counted and kept goes on the document.
  const page = (doc.defaultView ?? doc) as {
    srModel?: Record<string, unknown>;
    srSubmits?: number;
    srNexts?: number;
  };
  page.srModel = {};
  page.srSubmits = 0;
  page.srNexts = 0;
  const LOCATIONS: [string, string][] = [
    ['US_CO_CITY_denver', 'Denver, CO, US'],
    ['US_TX_CITY_denver-city', 'Denver City, TX, US'],
    ['US_CO_CITY_boulder', 'Boulder, CO, US'],
    ['US_IL_CITY_springfield', 'Springfield, IL, US'],
    ['CA_ON_CITY_toronto', 'Toronto, Ontario, Canada'],
    ['US_OH_CITY_toronto', 'Toronto, OH, US'],
  ];
  const SUGGESTED: Record<string, string[]> = {
    titles: ['Software Engineer', 'Senior Product Manager', 'Product Manager', 'Data Analyst'],
    companies: ['Tidewater Labs', 'Fernway Partners'],
    institutions: ['CU Boulder', 'Colorado State University', 'University of Denver'],
  };
  const COUNTRIES: [string, string, string][] = [
    ['CA', 'Canada', '+1'],
    ['MX', 'Mexico', '+52'],
    ['GB', 'United Kingdom', '+44'],
    ['US', 'United States', '+1'],
    ['UM', 'United States Minor Outlying Islands', '+1'],
  ];
  const plain = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const esc = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const draw = (host: Element, markup: string): ShadowRoot => {
    const root = host.attachShadow({ mode: 'open', delegatesFocus: true });
    root.innerHTML = markup;
    upgrade(root);
    return root;
  };
  const insideOf = (root: ShadowRoot | null, selector: string) =>
    root?.querySelector(selector) as HTMLElement;
  /** Tells the page's form a component's value, as SmartRecruiters' components do. */
  const changed = (host: Element, value: unknown) => {
    (host as { value?: unknown }).value = value;
    host.dispatchEvent(
      new CustomEvent('spl-change', { bubbles: true, composed: true, detail: { value } }),
    );
  };
  /** The element around one, across the edge of a component's insides. */
  const upOf = (element: Element): Element | null =>
    element.parentElement ?? ((element.getRootNode() as ShadowRoot).host || null);
  /** The name the page's form keeps a component's value by. */
  const nameOf = (host: Element) => {
    for (let at: Element | null = host; at; at = upOf(at)) {
      const name =
        at.getAttribute('formcontrolname') ??
        at.getAttribute('name') ??
        at.getAttribute('data-test');
      if (name) return name;
    }
    return host.id;
  };
  // Angular hears its components inside the page's body, which a test may put another page in.
  const app = doc.body;
  app.addEventListener('spl-change', (event) => {
    const [host] = event.composedPath() as Element[];
    if (host && page.srModel) page.srModel[nameOf(host)] = (event as CustomEvent).detail?.value;
  });

  /** The elements a component holds that match, of its own, not inside them. */
  const childrenOf = (host: Element, selector: string) =>
    [...host.children].filter((child) => child.matches(selector));
  /** Whether the page put a component's label's words in it, as a question's are. */
  const slotsLabel = (host: Element) => childrenOf(host, '[slot="label-content"]').length > 0;

  /** A field's label, its words its own or put in its slot by the page, as a question's are. */
  const labelOf = (host: Element, id: string) => {
    const words = slotsLabel(host)
      ? '<slot name="label-content"></slot>'
      : esc(host.getAttribute('label') ?? '');
    const mark = host.hasAttribute('required')
      ? '<span class="c-spl-form-field-required-mark" aria-hidden="true">*</span>'
      : '';
    return `<label slot="label" class=" c-spl-form-field-label " for="${esc(id)}" id="${esc(id)}-label"><spl-typography-label variant="md"><span class="c-spl-form-field-label-wrapper"><span class="c-spl-form-field-label-required-group">${words}${mark}</span></span></spl-typography-label></label>`;
  };

  const RENDER: Record<string, (host: Element) => void> = {
    'SPL-WRAPPER': (host) =>
      draw(host, '<spl-context-provider><slot></slot></spl-context-provider>'),
    'SPL-CONTEXT-PROVIDER': (host) => draw(host, '<slot></slot>'),
    'SPL-FORM': (host) => draw(host, '<form><slot></slot></form>'),
    'SPL-INTERNAL-FORM-FIELD': (host) =>
      draw(
        host,
        '<div class="c-spl-form-field"><slot name="label"></slot><slot name="description"></slot><slot class="c-spl-form-field-slot"></slot><spl-typography-body variant="sm" class="c-spl-form-field-error"><slot name="error-msg"></slot></spl-typography-body></div>',
      ),
    'SPL-TYPOGRAPHY-LABEL': (host) =>
      draw(host, '<span class="c-spl-typography-label"><slot></slot></span>'),
    'SPL-TYPOGRAPHY-BODY': (host) =>
      draw(host, '<span class="c-spl-typography-body"><slot></slot></span>'),
    'SPL-TYPOGRAPHY-TITLE': (host) =>
      draw(host, '<h3 class="c-spl-typography-title"><slot></slot></h3>'),
    // Its text, and again as a tooltip, which shows only when it's cut short.
    'SPL-TRUNCATE': (host) =>
      draw(
        host,
        `<span class="c-spl-truncate"><slot></slot></span><div role="tooltip" hidden>${esc(host.getAttribute('title') ?? '')}</div>`,
      ),
    'SPL-LINK-BUTTON': (host) =>
      draw(host, '<button class="c-spl-link-button" type="button"><slot></slot></button>'),
    'SPL-BUTTON': (host) =>
      draw(
        host,
        `<button class=" c-spl-button-wrapper c-spl-button c-spl-button--${esc(host.getAttribute('type') ?? 'primary')} " type="button" aria-expanded="false"><div class="c-spl-button__content"><slot name="prefixIcon"></slot><slot></slot><slot name="suffixIcon"></slot></div></button>`,
      ),
    'SPL-INPUT': (host) => {
      const id = host.id;
      const aria = host.getAttribute('splarialabel');
      const role = host.getAttribute('ariarole');
      const required = host.hasAttribute('required');
      const attributes = [
        `class=" c-spl-input " id="${esc(id)}" type="${esc(host.getAttribute('type') ?? 'text')}"`,
        `placeholder="${esc(host.getAttribute('placeholder') ?? '')}"`,
        `autocomplete="${esc(host.getAttribute('autocomplete') ?? 'off')}"`,
        `aria-invalid="false" aria-required="${required}"`,
        aria ? `aria-label="${esc(aria)}"` : '',
        host.getAttribute('maxlength')
          ? `maxlength="${esc(host.getAttribute('maxlength') ?? '')}"`
          : '',
        role
          ? `role="${esc(role)}" aria-controls="${esc(host.getAttribute('ariacontrols') ?? '')}" aria-autocomplete="${esc(host.getAttribute('ariaautocomplete') ?? 'list')}" aria-haspopup="listbox" aria-expanded="false"`
          : '',
      ].join(' ');
      const root = draw(
        host,
        `<spl-internal-form-field>${aria ? '' : labelOf(host, id)}<div class="c-spl-input-grid"><div class="c-spl-input-wrapper"><input ${attributes}></div></div></spl-internal-form-field>`,
      );
      const box = insideOf(root, 'input') as HTMLInputElement;
      const tell = () => changed(host, box.value);
      box.addEventListener('input', tell);
      box.addEventListener('change', tell);
    },
    'SPL-TEXTAREA': (host) => {
      const id = host.id;
      const root = draw(
        host,
        `<spl-internal-form-field>${labelOf(host, id)}<div class="c-spl-textarea-wrapper"><textarea class=" c-spl-textarea " id="${esc(id)}" rows="${esc(host.getAttribute('rows') ?? '4')}" placeholder="" aria-required="${host.hasAttribute('required')}"${host.getAttribute('maxlength') ? ` maxlength="${esc(host.getAttribute('maxlength') ?? '')}"` : ''}></textarea></div></spl-internal-form-field>`,
      );
      const box = insideOf(root, 'textarea') as HTMLTextAreaElement;
      const tell = () => changed(host, box.value);
      box.addEventListener('input', tell);
      box.addEventListener('change', tell);
    },
    'SPL-CHECKBOX': (host) => {
      const id = host.id;
      const root = draw(
        host,
        `<spl-internal-form-field class=" c-spl-checkbox__form-field " variant="horizontal">${labelOf(host, id)}<div class=" c-spl-checkbox-wrapper c-spl-checkbox "><input class="c-spl-checkbox__input" type="checkbox" autocomplete="off" id="${esc(id)}" aria-invalid="false" aria-required="${host.hasAttribute('required')}" aria-labelledby="${esc(id)}-label"></div></spl-internal-form-field>`,
      );
      const box = insideOf(root, 'input') as HTMLInputElement;
      box.addEventListener('change', () => changed(host, box.checked));
    },
    'SPL-RADIO-GROUP': (host) => {
      const id = host.id;
      draw(
        host,
        `<spl-internal-form-field variant="vertical">${labelOf(host, id)}<fieldset role="radiogroup" class=" c-spl-radio-group c-spl-radio-group--vertical " aria-labelledby="${esc(id)}-label" aria-required="${host.hasAttribute('required')}"><slot></slot></fieldset></spl-internal-form-field>`,
      );
    },
    // The radio button is the component itself, with no input: a click picks it.
    'SPL-RADIO': (host) => {
      const id = host.id;
      draw(
        host,
        `<spl-internal-form-field preventerrormsgrender="" class="c-spl-radio-wrapper" variant="horizontal"><label slot="label" class=" c-spl-form-field-label " for="${esc(id)}" id="${esc(id)}-label">${esc(host.getAttribute('label') ?? '')}</label><div class=" c-spl-radio "><div class="c-spl-radio__ring"></div></div></spl-internal-form-field>`,
      );
      host.addEventListener('click', () => {
        const group = host.parentElement;
        for (const each of group ? childrenOf(group, 'spl-radio') : []) {
          each.setAttribute('aria-checked', String(each === host));
          each.toggleAttribute('checked', each === host);
        }
        if (group) changed(group, host.getAttribute('value'));
      });
    },
    'SPL-DROPZONE': (host) => {
      dropzones += 1;
      const n = dropzones;
      const root = draw(
        host,
        `<div class=" c-spl-dropzone-wrapper c-spl-dropzone " tabindex="0"><slot name="icon"></slot><label for="spl-dropzone-file-input-${n}"><span class="c-spl-dropzone-label c-spl-dropzone-label-browse">Choose a file</span><span class="c-spl-dropzone-label">or drop it here</span></label><input type="file" id="spl-dropzone-file-input-${n}" accept=".doc, .docx, .pdf, .rtf, .txt" aria-describedby="spl-dropzone-restriction-label-${n}"><span class="c-spl-dropzone-label c-spl-dropzone-label-restriction" id="spl-dropzone-restriction-label-${n}">10MB size limit</span></div><ul class="c-spl-file-list"></ul>`,
      );
      const box = insideOf(root, 'input') as HTMLInputElement;
      box.addEventListener('change', () => {
        const list = insideOf(root, 'ul');
        list.replaceChildren();
        for (const file of box.files ?? []) {
          const item = doc.createElement('li');
          item.className = 'c-spl-file-list-item';
          item.innerHTML = `<span class="c-spl-file-list-item-name">${esc(file.name)}</span>`;
          list.append(item);
        }
        changed(
          host,
          [...(box.files ?? [])].map((file) => file.name),
        );
      });
    },
    'SPL-DROPDOWN': (host) =>
      draw(
        host,
        '<div class=" c-spl-dropdown c-spl-dropdown--close "><span class="c-spl-dropdown-trigger"><slot name="trigger"></slot></span><div class="c-spl-dropdown-menu-wrapper"><div class="c-spl-dropdown-menu" aria-hidden="true"><slot name="search"></slot><slot name="menu" class="c-spl-dropdown-menu-slot"></slot></div></div></div>',
      ),
    // An option: its words, put in its own option's slot, which only a click on that picks.
    'SPL-SELECT-OPTION': (host) => {
      const label = host.getAttribute('label') ?? (host.textContent ?? '').trim();
      draw(
        host,
        `<spl-dropdown-item><slot><spl-truncate multiline title="${esc(label)}">${esc(label)}</spl-truncate></slot></spl-dropdown-item>`,
      );
    },
    'SPL-DROPDOWN-ITEM': (host) => {
      const root = draw(
        host,
        '<div class="c-spl-dropdown-item" role="option" aria-disabled="false" aria-selected="false" tabindex="-1"><slot name="prefix" class="c-spl-dropdown-item__prefix"></slot><spl-typography-body variant="b2" class="c-spl-dropdown-item__content"><slot></slot></spl-typography-body><slot name="suffix" class="c-spl-dropdown-item__suffix"></slot></div>',
      );
      const item = insideOf(root, '[role="option"]');
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => {
        const option = (host.getRootNode() as ShadowRoot).host;
        option?.dispatchEvent(
          new CustomEvent('spl-option-select', {
            bubbles: true,
            composed: true,
            detail: { value: option.getAttribute('value') },
          }),
        );
      });
    },
    'SPL-AUTOCOMPLETE': (host) => autocomplete(host),
    'SPL-SELECT': (host) => select(host),
    'SPL-DROPDOWN-SEARCH': (host) =>
      draw(
        host,
        `<input autocomplete="off" class="c-spl-dropdown-search__input" type="text" placeholder="${esc(host.getAttribute('placeholder') ?? '')}" aria-label="${esc(host.getAttribute('arialabel') ?? '')}" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list">`,
      ),
    'SPL-PHONE-FIELD': (host) => phone(host),
    'SPL-DATE-FIELD': (host) => {
      const id = host.id;
      draw(
        host,
        `<div><spl-internal-form-field>${labelOf(host, id)}<spl-date-picker aria-labelledby="${esc(id)}-label" type="month-year" placeholder="${esc(host.getAttribute('placeholder') ?? 'Pick a date')}" data-label="${esc(host.getAttribute('label') ?? '')}"${host.hasAttribute('required') ? ' required=""' : ''}></spl-date-picker></spl-internal-form-field></div>`,
      );
    },
    'SPL-DATE-PICKER': (host) => datePicker(host),
    'SR-SCREENING-QUESTIONS-FORM': (host) => {
      const questions = host.querySelector('template')?.innerHTML ?? '';
      draw(
        host,
        `<spl-wrapper theme="bluesteel"><spl-form id="question-form-1">${questions}</spl-form></spl-wrapper>`,
      );
    },
  };
  let dropzones = 0;
  const done = new WeakSet<Element>();
  /** Draws the insides of each component in a part of the page, and of each inside those. */
  function upgrade(root: ParentNode): void {
    for (const each of root.querySelectorAll('*')) {
      const render = RENDER[each.tagName];
      if (render && !done.has(each)) {
        done.add(each);
        render(each);
      }
      if (each.shadowRoot) upgrade(each.shadowRoot);
    }
  }

  /** Opens or closes a component's list, as its dropdown shows it. */
  const showList = (dropdown: Element | null, open: boolean) => {
    const root = dropdown?.shadowRoot;
    root
      ?.querySelector('.c-spl-dropdown')
      ?.setAttribute('class', ` c-spl-dropdown c-spl-dropdown--${open ? 'open' : 'close'} `);
    root?.querySelector('.c-spl-dropdown-menu')?.setAttribute('aria-hidden', String(!open));
  };

  /**
   * A list that offers its options as you type, or all of them at once, as a screening question's
   * select does: the options it found, each one's own insides drawn; a pick only by a click on an
   * option, and what it had put back once you leave it without one.
   */
  function autocomplete(host: Element): void {
    const id = host.id;
    const least = Number(host.getAttribute('minquerylength') ?? '0');
    const custom = host.hasAttribute('allowcustomvalues');
    const root = draw(
      host,
      `<div><spl-internal-form-field><div class="c-spl-autocomplete-status" role="status" aria-live="polite" aria-atomic="true"></div><spl-dropdown class="c-spl-autocomplete-dropdown" menustretch="" preventfocusonshow=""><div slot="trigger" class="c-spl-autocomplete-trigger"><spl-input type="text" value="" autocomplete="off" label="${esc(host.getAttribute('label') ?? '')}" id="${esc(id)}" ariacontrols="menu-${esc(id)}" ariaautocomplete="${custom ? 'both' : 'list'}" ariarole="combobox"${host.hasAttribute('required') ? ' required=""' : ''}>${slotsLabel(host) ? '<slot name="label-content" slot="label-content"></slot>' : ''}</spl-input></div><div slot="menu" id="menu-${esc(id)}" role="listbox"></div></spl-dropdown></spl-internal-form-field></div>`,
    );
    const field = insideOf(root, 'spl-input');
    const box = insideOf(field.shadowRoot, 'input') as HTMLInputElement;
    const menu = insideOf(root, '[slot="menu"]');
    const dropdown = insideOf(root, 'spl-dropdown');
    let committed = '';
    let timer = 0;
    const optionsFor = (query: string): [string, string][] => {
      const source = host.getAttribute('source') ?? '';
      if (source === 'locations') {
        const city = plain(query.split(',')[0] ?? '');
        return [
          ...LOCATIONS.filter(([, label]) => city && plain(label).startsWith(city)),
          ['goToManualLocationMode', ''],
        ];
      }
      if (source) {
        const words = plain(query);
        const found = (SUGGESTED[source] ?? []).filter((each) => plain(each).includes(words));
        const exact = found.some((each) => plain(each) === words);
        return [
          ...(custom && query.trim() && !exact
            ? [['#spl-custom-option', query.trim()] as [string, string]]
            : []),
          ...found.map((each): [string, string] => [each, each]),
        ];
      }
      const all = childrenOf(host, 'spl-select-option').map((each): [string, string] => [
        each.getAttribute('value') ?? '',
        each.getAttribute('label') ?? '',
      ]);
      return all.filter(([, label]) => plain(label).includes(plain(query)));
    };
    const close = () => {
      menu.replaceChildren();
      showList(dropdown, false);
      box.setAttribute('aria-expanded', 'false');
    };
    const open = (query: string) => {
      menu.replaceChildren();
      for (const [value, label] of optionsFor(query)) {
        const option = doc.createElement('spl-select-option');
        option.setAttribute('value', value);
        if (value === 'goToManualLocationMode') {
          option.innerHTML =
            '<spl-link-button>Cannot find your city? Click here to fill in manually</spl-link-button>';
        } else {
          option.setAttribute('label', label);
          option.innerHTML = `<div class="c-spl-autocomplete-default-option"><spl-typography-body variant="b2"><spl-truncate multiline title="${esc(label)}">${esc(label)}</spl-truncate></spl-typography-body></div>`;
        }
        menu.append(option);
      }
      upgrade(menu);
      showList(dropdown, true);
      box.setAttribute('aria-expanded', 'true');
    };
    // What's typed only looks up its options, once it's long enough, a moment later.
    field.addEventListener('spl-change', (event) => {
      event.stopPropagation();
      clearTimeout(timer);
      const query = box.value;
      if (query.length < least) return close();
      timer = setTimeout(() => open(query), 200) as unknown as number;
    });
    box.addEventListener('click', () => {
      if (least === 0) open('');
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && least === 0) open(box.value);
      if (event.key === 'Escape') close();
    });
    menu.addEventListener('spl-option-select', (event) => {
      const value = (event as CustomEvent).detail?.value as string;
      const option = [...menu.children].find((each) => each.getAttribute('value') === value);
      if (!option || value === 'goToManualLocationMode') return;
      const label = option.getAttribute('label') ?? '';
      committed = label;
      box.value = label;
      close();
      const location = LOCATIONS.find(([key]) => key === value);
      changed(
        host,
        location ? { id: value, text: label } : value === '#spl-custom-option' ? label : value,
      );
    });
    // Leaving it with nothing picked puts back what it had, and closes its list.
    box.addEventListener('blur', () => {
      setTimeout(() => {
        if (box.value !== committed) box.value = committed;
        close();
      }, 0);
    });
  }

  /** The phone's country code: a button that opens its list of countries, its options the page's. */
  function select(host: Element): void {
    const id = host.id;
    const root = draw(
      host,
      `<spl-internal-form-field><spl-dropdown class="c-spl-select"><button class="c-spl-select-field" slot="trigger" id="${esc(id)}" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-menu" aria-autocomplete="none" aria-label="${esc(host.getAttribute('splarialabel') ?? '')}" aria-required="false" type="button"><div class="c-spl-select-content"><slot name="triggerPrefix"></slot></div></button><div slot="menu" id="${esc(id)}-menu" role="listbox"><slot></slot></div><slot name="search" slot="search"></slot></spl-dropdown></spl-internal-form-field>`,
    );
    const button = insideOf(root, 'button');
    const dropdown = insideOf(root, 'spl-dropdown');
    const setOpen = (open: boolean) => {
      button.setAttribute('aria-expanded', String(open));
      showList(dropdown, open);
    };
    button.addEventListener('click', () =>
      setOpen(button.getAttribute('aria-expanded') !== 'true'),
    );
    host.addEventListener('spl-option-select', (event) => {
      const value = (event as CustomEvent).detail?.value as string;
      const country = COUNTRIES.find(([code]) => code === value);
      if (!country) return;
      const caption = host.querySelector(
        '[slot="triggerPrefix"] .c-spl-phone-field-selected-value',
      );
      if (caption) caption.textContent = country[2];
      setOpen(false);
      changed(host, value);
    });
  }

  /**
   * A phone number: its country code, picked from a list, beside the number, typed, which the
   * page's form keeps as one value.
   */
  function phone(host: Element): void {
    const id = host.id;
    let country = (() => {
      try {
        return (JSON.parse(host.getAttribute('value') ?? '{}') as { country?: string }).country;
      } catch {
        return undefined;
      }
    })();
    const code = COUNTRIES.find(([each]) => each === country)?.[2] ?? '';
    const options = COUNTRIES.map(
      ([value, name, dial]) =>
        `<spl-select-option class="c-spl-phone-field-select-option" value="${value}" label="${esc(name)}"><div class="c-spl-phone-field-select-option-container"><span class="c-spl-phone-field-select-option-container-country">${esc(name)}</span><span class="c-spl-phone-field-select-option-container-code">${dial}</span></div></spl-select-option>`,
    ).join('');
    const root = draw(
      host,
      `<div><div class="c-spl-phone-field"><spl-internal-form-field>${labelOf(host, id)}<div class="c-spl-phone-field-content" role="group" aria-labelledby="${esc(id)}-label"><spl-select class="c-spl-phone-field-select" id="${esc(id)}-code" value="${esc(country ?? '')}" splarialabel="Country code"><spl-dropdown-search slot="search" placeholder="Search by country/region or code" arialabel="Search by country/region or code"></spl-dropdown-search>${options}<div slot="triggerPrefix" class="c-spl-phone-field-selected"><div class="c-spl-phone-field-selected-wrapper"><spl-typography-body variant="md" class=" c-spl-phone-field-selected-value ">${code}</spl-typography-body></div></div></spl-select><spl-input class="c-spl-phone-field-input" autocomplete="off" preventerrormsgrender="" id="${esc(id)}" type="tel" placeholder="" splarialabel="Phone number"${host.hasAttribute('required') ? ' required=""' : ''}></spl-input></div></spl-internal-form-field></div></div>`,
    );
    const number = insideOf(root, 'spl-input');
    const tell = () => {
      const dial = COUNTRIES.find(([each]) => each === country)?.[2] ?? '';
      const typed = (insideOf(number.shadowRoot, 'input') as HTMLInputElement).value;
      changed(host, {
        country,
        value: typed,
        internationalFormat: typed ? `${dial} ${typed}` : '',
      });
    };
    insideOf(root, 'spl-select').addEventListener('spl-change', (event) => {
      event.stopPropagation();
      country = String((event as CustomEvent).detail?.value ?? '');
      tell();
    });
    number.addEventListener('spl-change', (event) => {
      event.stopPropagation();
      tell();
    });
  }

  /**
   * A month and a year, typed as MM/YYYY, or YYYY-MM: kept only once you press Enter, by its key
   * code, or leave the box, then written as MM/YYYY. A calendar opens with Space, which this
   * doesn't draw.
   */
  function datePicker(host: Element): void {
    const root = draw(
      host,
      `<div class="c-spl-date-picker-wrapper"><div class="flatpickr-wrapper"><div class="c-spl-date-picker"><div class="c-spl-date-picker-input-wrapper" data-test="spl-date-picker-interactive-input-wrapper"><div class="c-spl-input-wrapper"><input aria-haspopup="grid" class="c-spl-input c-spl-date-picker-input flatpickr-input" placeholder="${esc(host.getAttribute('placeholder') ?? '')}" aria-label="${esc(host.getAttribute('data-label') ?? '')}" aria-required="${host.hasAttribute('required')}" aria-roledescription="Date Input" aria-description="Press Space to open the date picker" type="text"></div></div></div></div></div>`,
    );
    const box = insideOf(root, 'input') as HTMLInputElement;
    const field = (host.getRootNode() as ShadowRoot).host;
    let kept = '';
    const keep = () => {
      const said = box.value.trim();
      if (said === kept) return;
      const typed = /^(\d{1,2})\/(\d{4})$/.exec(said);
      const iso = /^(\d{4})-(\d{2})$/.exec(said);
      const [month, year] = typed
        ? [Number(typed[1]), typed[2]]
        : iso
          ? [Number(iso[2]), iso[1]]
          : [0, ''];
      if (!year || month < 1 || month > 12) {
        box.setAttribute('aria-invalid', 'true');
        return;
      }
      kept = `${String(month).padStart(2, '0')}/${year}`;
      box.value = kept;
      box.setAttribute('aria-invalid', 'false');
      if (field) changed(field, `${year}-${String(month).padStart(2, '0')}-01`);
    };
    box.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).keyCode === 13) keep();
    });
    box.addEventListener('blur', keep);
  }

  /** A part for another job or school, as Add opens it, in place, with Save and Cancel. */
  const editor = (kind: 'experience' | 'education', n: number) => {
    const fields =
      kind === 'experience'
        ? `<oc-job-title-autocomplete><spl-autocomplete data-test="job-title-autocomplete" id="exp-title-${n}" label="Title" required="" minquerylength="2" allowcustomvalues="" source="titles"></spl-autocomplete></oc-job-title-autocomplete>
<oc-company-autocomplete><spl-autocomplete data-test="company-autocomplete" id="exp-company-${n}" label="Company" minquerylength="2" allowcustomvalues="" source="companies"></spl-autocomplete></oc-company-autocomplete>
<oc-location-autocomplete-wrapper data-test="experience-form-location"><oc-location-autocomplete><spl-autocomplete data-test="location-autocomplete" id="exp-location-${n}" label="Office location" minquerylength="3" source="locations"></spl-autocomplete></oc-location-autocomplete></oc-location-autocomplete-wrapper>
<oc-textarea formcontrolname="description" data-test="experience-description"><spl-textarea id="exp-desc-${n}" label="Description" rows="4"></spl-textarea></oc-textarea>
<oc-datepicker data-test="experience-date-from" formcontrolname="startDate"><spl-date-field type="month-year" id="exp-from-${n}" label="From" required="" placeholder="Pick a date"></spl-date-field></oc-datepicker>
<oc-datepicker data-test="experience-date-to" formcontrolname="endDate"><spl-date-field type="month-year" id="exp-to-${n}" label="To" required="" placeholder="Pick a date"></spl-date-field></oc-datepicker>
<oc-checkbox formcontrolname="current" data-test="experience-current"><spl-checkbox id="" name="" value="false"><div slot="label-content" data-test=""><span data-test="checkbox-label">I currently work here</span></div></spl-checkbox></oc-checkbox>`
        : `<oc-institution-autocomplete><spl-autocomplete data-test="institution-autocomplete" id="edu-institution-${n}" label="Institution" required="" minquerylength="2" allowcustomvalues="" source="institutions"></spl-autocomplete></oc-institution-autocomplete>
<oc-input formcontrolname="major" data-test="education-major"><spl-input type="text" id="edu-major-${n}" label="Major"></spl-input></oc-input>
<oc-input formcontrolname="degree" data-test="education-degree"><spl-input type="text" id="edu-degree-${n}" label="Degree"></spl-input></oc-input>
<oc-location-autocomplete-wrapper data-test="education-form-location"><oc-location-autocomplete><spl-autocomplete data-test="location-autocomplete" id="edu-location-${n}" label="School location" minquerylength="3" source="locations"></spl-autocomplete></oc-location-autocomplete></oc-location-autocomplete-wrapper>
<oc-datepicker data-test="education-date-from" formcontrolname="startDate"><spl-date-field type="month-year" id="edu-from-${n}" label="From" placeholder="Pick a date"></spl-date-field></oc-datepicker>
<oc-datepicker data-test="education-date-to" formcontrolname="endDate"><spl-date-field type="month-year" id="edu-to-${n}" label="To" placeholder="Pick a date"></spl-date-field></oc-datepicker>
<oc-checkbox formcontrolname="current" data-test="education-current"><spl-checkbox id="" name="" value="false"><div slot="label-content" data-test=""><span data-test="checkbox-label">I currently attend</span></div></spl-checkbox></oc-checkbox>`;
    return `<oc-${kind}-entry data-test="experience-entry"><div data-test="${kind}-entry" class="entry entry--last"><div class="spl-flex flex-row"><div class="flex-grow"><oc-${kind}-edit-form><div data-test="${kind}-edit-form" class="${kind}-edit-form spl-flex flex-row"><div class="edit-form-panel flex-grow"><p class="spl-text-sm">Fields marked with * are required.</p>
${fields}
<div class="spl-flex flex-row spl-justify-end"><oc-button type="secondary" data-test="${kind}-cancel"><spl-button aria-label="Cancel adding ${kind} entry" type="secondary"><span>Cancel</span></spl-button></oc-button><oc-button type="primary" data-test="${kind}-save"><spl-button aria-label="Save ${kind} entry" type="primary"><span>Save</span></spl-button></oc-button></div></div></div></oc-${kind}-edit-form></div></div></div></oc-${kind}-entry>`;
  };
  let entries = 0;
  /** A component's value, as its insides show it now. */
  const heldBy = (host: Element | null) => (host as { value?: unknown } | null)?.value;
  /** Saves a part for a job or school, as Save does once its fields are right, or says what's missing. */
  const save = (kind: 'experience' | 'education', entry: Element) => {
    const form = entry.querySelector(`[data-test="${kind}-edit-form"]`);
    if (!form) return;
    const title = heldBy(
      form.querySelector(
        '[data-test="job-title-autocomplete"], [data-test="institution-autocomplete"]',
      ),
    );
    const company = heldBy(form.querySelector('[data-test="company-autocomplete"]'));
    const from = heldBy(form.querySelector(`[data-test="${kind}-date-from"] spl-date-field`));
    const to = heldBy(form.querySelector(`[data-test="${kind}-date-to"] spl-date-field`));
    const current = heldBy(form.querySelector('spl-checkbox')) === true;
    if (!title || (kind === 'experience' && (!from || (!to && !current)))) {
      form.setAttribute('data-invalid', 'true');
      return;
    }
    const years = `${String(from ?? '').slice(0, 4)} - ${current ? 'Present' : String(to ?? '').slice(0, 4)}`;
    form.closest(`oc-${kind}-edit-form`)?.replaceWith(
      Object.assign(doc.createElement('div'), {
        innerHTML: `<div data-test="${kind}-entry-is-edit-enabled" class="spl-flex flex-row"><div class="entry-details flex-grow"><p data-test="${kind}-entry-title"> ${esc(String(title))} <span data-test="${kind}-entry-date">${years}</span></p><p data-test="${kind}-entry-company"> ${esc(String(company ?? ''))} </p></div><div class="spl-flex spl-flex-row spl-gap-1"><spl-button type="tertiary" data-test="${kind}-entry-edit" aria-label="Edit ${kind} ${esc(String(title))}"><span>Edit</span></spl-button></div></div>`,
      }),
    );
  };

  // The page's own buttons, as Angular hears a click on each: Add, Save, Cancel, Next and Submit.
  app.addEventListener('click', (event) => {
    const button = (event.composedPath() as Element[]).find(
      (each) => each instanceof Element && each.tagName === 'OC-BUTTON',
    );
    const test = button?.getAttribute('data-test') ?? '';
    const kind = /^(experience|education)/.exec(test)?.[1] as
      | 'experience'
      | 'education'
      | undefined;
    if (test === 'add-experience' || test === 'add-education') {
      const section = button?.closest('[data-test="experience"], [data-test="education"]');
      const list = section?.querySelector('[data-test="entries"]');
      if (!list) return;
      entries += 1;
      list.insertAdjacentHTML(
        'beforeend',
        editor(test === 'add-experience' ? 'experience' : 'education', entries),
      );
      button?.setAttribute('aria-expanded', 'true');
      upgrade(list);
    } else if (kind && test.endsWith('-save')) {
      const entry = button?.closest(`oc-${kind}-entry`);
      if (entry) save(kind, entry);
    } else if (kind && test.endsWith('-cancel')) {
      button?.closest(`oc-${kind}-entry`)?.remove();
    } else if (test === 'footer-submit') {
      page.srSubmits = (page.srSubmits ?? 0) + 1;
    } else if (test === 'footer-next') {
      page.srNexts = (page.srNexts ?? 0) + 1;
      if (!pages) return;
      // Angular brings in the screening questions in place, at their own address.
      void fetch(`${pages}smartrecruiters-screening.html`)
        .then((response) => response.text())
        .then((html) => {
          const next = new DOMParser().parseFromString(html, 'text/html');
          const main = next.querySelector('main');
          const here = doc.querySelector('main');
          if (!main || !here) return;
          here.replaceWith(doc.importNode(main, true));
          doc.title = next.title;
          history.pushState(
            {},
            '',
            `${location.pathname.replace(/\/$/, '')}/screening${location.search}`,
          );
          upgrade(doc);
        });
    }
  });

  upgrade(doc);
}

/** SmartRecruiters' own code, as its form's page runs it, the screening questions from `pages`. */
export const smartRecruitersCode = (pages: string) =>
  `<script>(${smartRecruitersActs.toString()})(document, ${JSON.stringify(pages)});</script>`;
