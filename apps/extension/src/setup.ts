import 'virtual:theme.css';
import './ui.css';
import {
  type AccountKeys,
  API,
  accountKeys,
  type Bytes,
  checkEmoji,
  LinkAsk,
  linkId,
  openLink,
  openWithRecoveryKey,
  readLinkCode,
  readRecoveryKey,
  type SyncClient,
  SyncError,
} from '@factwright/sync';
import {
  type Account,
  browserName,
  clientFor,
  deviceSignIn,
  forgetAccount,
  loadAccount,
  saveAccount,
  signOut,
  syncFetch,
} from './account.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext } from './ext.ts';
import { hostPattern } from './manifest.ts';
import { SYNC_ORIGIN } from './server.ts';
import { changeSettings, settings } from './settings.ts';

/**
 * The setup page, in a tab of its own so it stays open while you approve things elsewhere: it
 * signs Save to Factwright in to sync, links it with your job hunt from Factwright on your
 * computer, and then holds its settings and its account.
 */

const app = document.getElementById('app') as HTMLElement;

/** How often a request to link checks where it stands, and waits after losing the connection. */
const STEP_MS = 1500;
const OFFLINE_MS = 5000;
/** How long before saying what to do if Factwright on the computer shows nothing. */
const SLOW_MS = 30_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const button = (text: string, click: () => void, primary = false) =>
  h('button', { type: 'button', class: primary ? 'primary' : '', on: { click } }, text);

const actions = (...buttons: Child[]) => h('div', { class: 'actions' }, ...buttons);

const problem = (text: string) => h('p', { class: 'bad', role: 'alert' }, text);

/** What to say when a request to sync fails. */
function reasonOf(error: unknown): string {
  if (error instanceof SyncError) {
    if (error.kind === 'offline') return 'Couldn’t reach Factwright’s sync. Check the connection.';
    if (error.kind === 'slow-down') return 'Too many tries at once. Wait a minute, then try again.';
    return error.message;
  }
  return String(error);
}

// --- Signing in ---------------------------------------------------------------------------

function signedOut(note?: string): void {
  show(
    app,
    heading('Set up Save to Factwright'),
    h(
      'p',
      {},
      'Save to Factwright saves the job you’re looking at, with its posting as you see it, to your Factwright job hunt. It’s locked on this computer with your job hunt’s own key before it’s sent, so only your devices can read it.',
    ),
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'Sign in to sync, with the account Factwright on your computer uses.'),
      h('li', {}, 'Approve linking it, in Factwright on your computer.'),
    ),
    note && problem(note),
    actions(button('Sign in to sync', () => void signIn(), true)),
  );
}

async function signIn(): Promise<void> {
  // Firefox asks for the extension's one site the first time. It must be asked on the click.
  const allowed = await ext.permissions
    .request({ origins: [hostPattern(SYNC_ORIGIN)] })
    .catch(() => false);
  if (!allowed) {
    signedOut(
      `Save to Factwright needs to reach ${new URL(SYNC_ORIGIN).host}, Factwright’s sync, to save jobs.`,
    );
    return;
  }
  const flow = deviceSignIn();
  let pending: Awaited<ReturnType<typeof flow.start>>;
  try {
    pending = await flow.start();
  } catch (error) {
    signedOut(reasonOf(error));
    return;
  }
  const page = () => {
    // Only Factwright's own sync site, never an address the server could name elsewhere.
    if (new URL(pending.url).origin === SYNC_ORIGIN) void ext.tabs.create({ url: pending.url });
  };
  show(
    app,
    heading('Sign in to sync'),
    h('p', {}, 'In the tab that opened, sign in, then check it shows this code:'),
    h('p', { class: 'code' }, pending.code),
    h('p', { class: 'muted' }, 'Waiting for you to allow it…'),
    actions(
      button('Open the sign-in page again', page),
      button('Cancel', () => flow.cancel()),
    ),
  );
  page();
  const result = await flow.finish();
  if (!result.ok) {
    signedOut(result.reason === 'canceled' ? undefined : result.message);
    return;
  }
  try {
    const info = await clientFor(result.token).account();
    const account: Account = {
      user: info.user.id,
      email: info.user.email,
      token: result.token,
      keys: null,
    };
    await saveAccount(account);
    void link(account);
  } catch (error) {
    signedOut(reasonOf(error));
  }
}

// --- Linking ------------------------------------------------------------------------------

/** Keeps the account's keys, once they're the account's own. */
async function keep(account: Account, client: SyncClient, accountKey: Bytes): Promise<boolean> {
  const keys: AccountKeys = await accountKeys(accountKey);
  const saved = await client.keys();
  if (saved && saved.keyId !== keys.id) return false;
  await saveAccount({ ...account, keys });
  linked({ ...account, keys });
  return true;
}

/** The other ways to link: a link code from Factwright on the computer, or the recovery key. */
function otherWays(account: Account, client: SyncClient, onDone: () => void): HTMLElement {
  const codeField = h('input', {
    id: 'code',
    type: 'text',
    autocomplete: 'off',
    spellcheck: false,
  });
  const keyField = h('input', {
    id: 'recovery',
    type: 'password',
    autocomplete: 'current-password',
    spellcheck: false,
  });
  const said = h('p', { role: 'status' });
  const tell = (text: string) => {
    said.textContent = text;
    said.className = 'bad';
  };
  const withCode = async () => {
    const code = readLinkCode(codeField.value);
    if (!code) return tell('That isn’t a link code. It’s 32 letters and numbers.');
    try {
      const data = await client.takeLink(await linkId(code));
      const key = data && (await openLink(data, code));
      if (!key) return tell('That code didn’t work. It lasts 10 minutes: make a new one.');
      if (await keep(account, client, key)) onDone();
      else tell('That code is for a different account.');
    } catch (error) {
      tell(reasonOf(error));
    }
  };
  const withKey = async () => {
    const recovery = readRecoveryKey(keyField.value);
    if (!recovery) return tell('That isn’t a recovery key. It’s 32 letters and numbers.');
    try {
      const saved = await client.keys();
      const key = saved && (await openWithRecoveryKey(saved.recovery, recovery));
      if (!key)
        return tell('That recovery key doesn’t open this account. Check it, and try again.');
      if (await keep(account, client, key)) onDone();
      else tell('That key is for a different account.');
    } catch (error) {
      tell(reasonOf(error));
    }
  };
  return h(
    'details',
    {},
    h('summary', {}, 'Use a link code or your recovery key instead'),
    h(
      'p',
      { class: 'small muted' },
      'In Factwright on your computer, Sync settings can show a link code, which lasts 10 minutes. Your recovery key is the one you saved when you turned on sync.',
    ),
    h('label', { for: 'code' }, 'Link code'),
    codeField,
    actions(button('Link with the code', () => void withCode())),
    h('label', { for: 'recovery' }, `Recovery key for ${account.email}`),
    keyField,
    actions(button('Link with the recovery key', () => void withKey())),
    said,
  );
}

/**
 * Asks Factwright on the computer to link Save to Factwright: the person checks both show the same
 * emoji, and says so on each. Only then is the account's key handed over, sealed for this browser.
 */
async function link(account: Account): Promise<void> {
  const client = clientFor(account.token);
  let stopped = false;
  /** The request to link, once it's made, which stopping calls off. */
  let asked: LinkAsk | null = null;
  const stop = () => {
    stopped = true;
    if (asked) void asked.cancel().catch(() => {});
  };
  const ended = (text: string) => {
    stop();
    show(
      app,
      heading('Link it with your job hunt'),
      problem(text),
      actions(button('Ask again', () => void link(account), true)),
      otherWays(account, client, stop),
    );
  };

  let saved: Awaited<ReturnType<SyncClient['keys']>>;
  try {
    saved = await client.keys();
  } catch (error) {
    if (error instanceof SyncError && error.kind === 'signed-out') {
      await forgetAccount();
      signedOut('That sign-in ended. Sign in again.');
      return;
    }
    ended(reasonOf(error));
    return;
  }
  if (!saved) {
    show(
      app,
      heading('Turn on sync first'),
      h(
        'p',
        {},
        'Sync isn’t on for this account yet. Turn it on in Factwright on your computer, then come back here.',
      ),
      actions(button('Check again', () => void link(account), true)),
    );
    return;
  }

  let ask: LinkAsk;
  try {
    ask = await LinkAsk.start(client);
    asked = ask;
  } catch (error) {
    if (error instanceof SyncError && error.code === 'stale') {
      await forgetAccount();
      signedOut('It’s been a while since you signed in, so sign in again to link it.');
      return;
    }
    ended(reasonOf(error));
    return;
  }
  // Calls the request off if the tab closes before it's done.
  const callOff = () =>
    void syncFetch(new URL(`${API.requests}/${ask.id}`, SYNC_ORIGIN), {
      method: 'DELETE',
      keepalive: true,
      headers: { authorization: `Bearer ${account.token}` },
    }).catch(() => {});
  window.addEventListener('pagehide', callOff);

  let confirmed = false;
  const startedAt = Date.now();
  const waiting = (slow: boolean) =>
    show(
      app,
      heading('Link it with your job hunt'),
      h(
        'p',
        {},
        `Open Factwright on your computer. It asks whether to link Save to Factwright in ${browserName()}. Keep this tab open until it’s linked.`,
      ),
      h('p', { class: 'muted' }, 'Waiting for Factwright…'),
      slow &&
        h(
          'p',
          { class: 'note' },
          'Nothing yet? Make sure Factwright is open and up to date, and signed in to the same account.',
        ),
      otherWays(account, client, stop),
    );
  const checking = (check: number[], approver: string) => {
    const emoji = checkEmoji(check);
    show(
      app,
      heading('Check the emoji'),
      h('p', {}, `Check that ${approver} shows these emoji, in this order:`),
      h(
        'p',
        { class: 'emoji', role: 'list' },
        ...emoji.map((each) =>
          h('span', { role: 'listitem', 'aria-label': each.name }, each.emoji),
        ),
      ),
      h('p', { class: 'small muted' }, emoji.map((each) => each.name).join(', ')),
      confirmed
        ? h('p', { class: 'muted' }, 'Now approve it in Factwright on your computer.')
        : actions(
            button(
              'They match',
              () => {
                confirmed = true;
                ask.confirm();
                checking(check, approver);
              },
              true,
            ),
            button('They don’t match', () => {
              window.removeEventListener('pagehide', callOff);
              ended('Nothing was linked. If you didn’t start this, you can ignore it.');
            }),
          ),
    );
  };

  waiting(false);
  let shown: 'waiting' | 'slow' | 'check' | null = 'waiting';
  while (!stopped) {
    let step: Awaited<ReturnType<LinkAsk['step']>>;
    try {
      step = await ask.step();
    } catch (error) {
      if (error instanceof SyncError && error.kind === 'offline') {
        await pause(OFFLINE_MS);
        continue;
      }
      window.removeEventListener('pagehide', callOff);
      ended(reasonOf(error));
      return;
    }
    if (stopped) return;
    if (step.state === 'waiting') {
      const slow = Date.now() - startedAt > SLOW_MS;
      const now = slow ? 'slow' : 'waiting';
      if (shown !== now) waiting(slow);
      shown = now;
    } else if (step.state === 'check') {
      if (shown !== 'check') checking(step.check, step.approver);
      shown = 'check';
      if (confirmed && step.approved) {
        window.removeEventListener('pagehide', callOff);
        // Picked up, so it's never called off: Factwright on the computer sees it linked.
        asked = null;
        const key = await ask.finish().catch(() => null);
        if (!key || !(await keep(account, client, key))) {
          ended('That didn’t work, so nothing was linked. Ask again.');
        }
        return;
      }
    } else {
      window.removeEventListener('pagehide', callOff);
      // Only a request that went wrong is still there to call off.
      if (step.state !== 'failed') asked = null;
      ended(
        step.state === 'denied'
          ? 'Factwright on your computer turned this down, so nothing was linked.'
          : step.state === 'gone'
            ? 'That request ran out before it was approved. Ask again, or use a code.'
            : 'Something changed the request on its way between your devices, so nothing was linked. Ask again.',
      );
      return;
    }
    await pause(STEP_MS);
  }
}

// --- Linked: how to use it, its settings and its account -----------------------------------

async function linked(account: Account): Promise<void> {
  const { linkedInText } = await settings();
  const linkedIn = h('input', { id: 'linkedin', type: 'checkbox', checked: linkedInText });
  linkedIn.addEventListener('change', () => {
    void changeSettings({ linkedInText: linkedIn.checked });
  });
  show(
    app,
    heading('You’re set'),
    h('p', {}, `Save to Factwright saves jobs to the job hunt of ${account.email}.`),
    h('h2', {}, 'Saving a job'),
    h(
      'ul',
      { class: 'steps' },
      h(
        'li',
        {},
        'On a job’s page, click the Factwright button in the toolbar, check the title and company, and save it. Pin the button so it’s always there.',
      ),
      h(
        'li',
        {},
        'Or press Alt+Shift+S (Option+Shift+S on a Mac), or right-click the page and choose Save job to Factwright, to save it without opening anything.',
      ),
      h(
        'li',
        {},
        'On a page it can’t read well, select the posting’s text first, and that’s what’s saved.',
      ),
      h(
        'li',
        {},
        'It shows in Factwright on your computer as a New job once it syncs, with its link and its posting.',
      ),
    ),
    h('h2', {}, 'LinkedIn'),
    h(
      'label',
      { class: 'check', for: 'linkedin' },
      linkedIn,
      'Save a LinkedIn job’s posting too, as you see it',
    ),
    h(
      'p',
      { class: 'small muted' },
      'Factwright’s own tools never read LinkedIn. With this on, Save to Factwright reads the LinkedIn job you’re looking at when you save it, as copying it yourself would. LinkedIn’s terms forbid software that copies from it, so turn this off to save LinkedIn jobs by their link and title alone.',
    ),
    h('h2', {}, 'Account'),
    h('p', {}, account.email),
    actions(
      button('Sign out of Save to Factwright', () => {
        void signOut(account).then(() => signedOut());
      }),
    ),
  );
}

async function start(): Promise<void> {
  const account = await loadAccount();
  if (!account) signedOut();
  else if (!account.keys) void link(account);
  else void linked(account);
}

void start();
