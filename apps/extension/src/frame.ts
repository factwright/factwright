import 'virtual:theme.css';
import './frame.css';
import { h, show } from './dom.ts';
import { ext } from './ext.ts';
import { BUTTON_CARD, MENU_ROWS } from './frame-size.ts';
import type { FilledHere, FromFrame, MenuAnswer, SaveOffer } from './job-site-messages.ts';

/**
 * The extension's own frame on the job sites you allowed, which its script there puts on the page
 * (src/content.ts): the Fill button, or a field's menu, by what its address says after its #. The
 * page can't read what it shows, so a menu's answers stay out of the page until you pick one. It
 * takes only your own clicks and keys, never a page's, and asks the background for everything.
 */

const app = document.getElementById('app') as HTMLElement;
const [mode = '', token = ''] = location.hash.slice(1).split(':');

const ask = (message: FromFrame): Promise<unknown> =>
  ext.runtime.sendMessage(message).catch(() => null);

const logo = () => h('img', { src: 'icons/32.png', alt: '', width: 16, height: 16 });

/** The Fill button: it fills the form as clicking Fill does, and says how it went where it fills it here. */
function fillButton(): void {
  let says = '';
  let busy = false;
  const render = () => {
    // The script makes the frame big enough for what it says, for a while, then a button again.
    if (says && innerWidth >= BUTTON_CARD.width - 8) {
      show(app, h('div', { class: 'said', role: 'status' }, logo(), h('p', {}, says)));
      return;
    }
    show(
      app,
      h(
        'div',
        { class: 'pill' },
        h(
          'button',
          {
            type: 'button',
            class: 'fill',
            disabled: busy,
            title: 'Fill this application with Factwright',
            on: { click },
          },
          logo(),
          busy ? 'Filling…' : 'Fill',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'hide',
            'aria-label': 'Hide Factwright’s Fill button on this page',
            title: 'Hide on this page',
            on: {
              click: (event) => {
                if (event.isTrusted) void ask({ type: 'job-site', do: 'hide-button' });
              },
            },
          },
          '×',
        ),
      ),
    );
  };
  const click = (event: Event) => {
    if (!event.isTrusted || busy) return;
    busy = true;
    render();
    void ask({ type: 'job-site', do: 'fill' }).then((said) => {
      busy = false;
      const done = said as FilledHere | null;
      says = done && done.did !== 'panel' ? done.says : '';
      render();
    });
  };
  addEventListener('resize', render);
  render();
}

/** What a menu shows, as the background says. */
interface Shows {
  question: string;
  answers: MenuAnswer[];
  save: SaveOffer | null;
}

/** A field's menu: Factwright's answers to pick from, and the offer to keep a new one you gave. */
async function menu(): Promise<void> {
  const shows = (await ask({ type: 'job-site', do: 'shows', token })) as Shows | null;
  if (!shows) return;
  const dismiss = (refocus: boolean) =>
    void ask({ type: 'job-site', do: 'dismiss', token, refocus });
  const rows = shows.answers.slice(0, MENU_ROWS).map((answer, at) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          type: 'button',
          class: 'answer',
          title: answer.text,
          on: {
            click: (event) => {
              if (event.isTrusted) void ask({ type: 'job-site', do: 'pick', token, at });
            },
          },
        },
        h('span', { class: 'text' }, answer.text),
        h('span', { class: 'from' }, answer.from),
      ),
    ),
  );
  const save = shows.save;
  const saving =
    save &&
    h(
      'div',
      { class: 'save' },
      h('p', { class: 'title' }, 'Save to Factwright?'),
      h('p', { title: `${save.question}: ${save.text}` }, `${save.question}: ${save.text}`),
      h(
        'p',
        { class: 'note' },
        save.private
          ? 'Kept on this computer only. Claude never sees it.'
          : 'Profile keeps it, to fill next time.',
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            on: {
              click: (event) => {
                if (!event.isTrusted) return;
                void ask({ type: 'job-site', do: 'save', token }).then((said) => {
                  const ok = (said as { ok?: boolean } | null)?.ok === true;
                  saving?.replaceChildren(
                    h(
                      'p',
                      { class: ok ? 'done' : 'note', role: 'status' },
                      ok ? 'Saved to Factwright.' : 'Factwright couldn’t save it. Try again later.',
                    ),
                  );
                  if (ok && rows.length === 0) setTimeout(() => dismiss(false), 1200);
                });
              },
            },
          },
          'Save',
        ),
        h(
          'button',
          {
            type: 'button',
            on: {
              click: (event) => {
                if (event.isTrusted) dismiss(false);
              },
            },
          },
          'Not now',
        ),
      ),
    );
  show(
    app,
    h(
      'div',
      { class: 'menu' },
      h('div', { class: 'head' }, logo(), 'Factwright'),
      rows.length > 0 &&
        h('ul', { 'aria-label': `Answers for ${shows.question || 'this field'}` }, ...rows),
      saving,
    ),
  );
  const buttons = () => [...app.querySelectorAll('button')];
  // Up and down go from one answer to the next, and Escape back to the field, as a list does.
  addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1;
    all[Math.max(0, Math.min(all.length - 1, next))]?.focus();
  });
  // The script puts the cursor here from the field with the down arrow.
  addEventListener('focus', () => {
    if (!app.contains(document.activeElement)) buttons()[0]?.focus();
  });
}

if (mode === 'button') fillButton();
else if (mode === 'menu') void menu();
