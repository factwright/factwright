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
  allowSync,
  browserName,
  canReachSync,
  clientFor,
  deviceSignIn,
  endSession,
  forgetAccount,
  loadAccount,
  saveAccount,
  signOut,
  syncFetch,
} from './account.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext } from './ext.ts';
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
/** How many times it tries again with the connection lost, once the keys are on their way. */
const OFFLINE_TRIES = 12;
/** How long before saying what to do if Factwright on the computer shows nothing. */
const SLOW_MS = 30_000;

/** Factwright's sync, the one site the extension reaches, as the person would know it. */
const SYNC_HOST = new URL(SYNC_ORIGIN).host;

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

/**
 * Whether a request failed because the extension's sign-in has ended, as when it's signed out
 * from Factwright's devices list. Then it's forgotten here, and setup starts over.
 */
async function signInEnded(error: unknown): Promise<boolean> {
  if (!(error instanceof SyncError && error.kind === 'signed-out')) return false;
  await forgetAccount();
  signedOut('That sign-in ended. Sign in again.');
  return true;
}

/** Tries a request again while the connection is lost, for a minute, before giving up. */
async function whileOffline<T>(work: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await work();
    } catch (error) {
      const offline = error instanceof SyncError && error.kind === 'offline';
      if (!offline || tries >= OFFLINE_TRIES) throw error;
      await pause(OFFLINE_MS);
    }
  }
}

/** When the browser has taken away the extension's one site: asks for it back, then carries on. */
function askForAccess(next: () => void): void {
  show(
    app,
    heading('Let it reach Factwright’s sync'),
    h(
      'p',
      {},
      `Save to Factwright saves jobs through ${SYNC_HOST}, Factwright’s sync, the one site it reaches. The browser has that turned off for it, so it can’t save jobs.`,
    ),
    actions(
      button(
        'Allow it',
        () => void allowSync().then((ok) => (ok ? next() : askForAccess(next))),
        true,
      ),
    ),
  );
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
  // Asked on the click, as browsers want: Firefox asks for the extension's one site the first time.
  if (!(await allowSync())) {
    signedOut(`Save to Factwright needs to reach ${SYNC_HOST}, Factwright’s sync, to save jobs.`);
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

/**
 * Keeps the account's keys, once they're the account's own: false when they're another
 * account's. With the keys on their way, a lost connection is waited out.
 */
async function keep(account: Account, client: SyncClient, accountKey: Bytes): Promise<boolean> {
  const keys: AccountKeys = await accountKeys(accountKey);
  const saved = await whileOffline(() => client.keys());
  if (saved && saved.keyId !== keys.id) return false;
  await saveAccount({ ...account, keys });
  void linked({ ...account, keys });
  return true;
}

/**
 * The other ways to link: a link code from Factwright on the computer, or the recovery key. Neither
 * needs a new sign-in. `onDone` runs once one has linked it, or the sign-in has ended.
 */
function otherWays(account: Account, client: SyncClient, onDone: () => void): HTMLElement {
  const codeField = h('input', {
    id: 'code',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const keyField = h('input', {
    id: 'recovery',
    type: 'password',
    autocomplete: 'current-password',
    spellcheck: 'false',
  });
  const said = h('p', { role: 'status' });
  const tell = (text: string) => {
    said.textContent = text;
    said.className = 'bad';
  };
  const failed = async (error: unknown) => {
    if (await signInEnded(error)) onDone();
    else tell(reasonOf(error));
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
      await failed(error);
    }
  };
  const withKey = async () => {
    const recovery = readRecoveryKey(keyField.value);
    if (!recovery) return tell('That isn’t a recovery key. It’s 32 letters and numbers.');
    try {
      const saved = await client.keys();
      const key = saved && (await openWithRecoveryKey(saved.recovery, recovery));
      if (!key) {
        return tell('That recovery key doesn’t open this account. Check it, and try again.');
      }
      if (await keep(account, client, key)) onDone();
      else tell('That key is for a different account.');
    } catch (error) {
      await failed(error);
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
 * A sign-in too old to ask Factwright on the computer with, which the server allows only soon after
 * signing in: sign in again, or link with a link code or the recovery key, which still work.
 */
function signInAgain(account: Account, others: HTMLElement): void {
  show(
    app,
    heading('Sign in again to link it'),
    h(
      'p',
      {},
      'It’s been a while since Save to Factwright signed in, so sign in again to ask Factwright on your computer to link it. Or link it with a link code or your recovery key.',
    ),
    actions(
      button(
        'Sign in again',
        () => {
          // The new sign-in asks the browser on this click. The old one is ended on the server.
          void signIn();
          void endSession(account);
        },
        true,
      ),
    ),
    others,
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
  // Made once, so what's typed in it stays while the page changes around it.
  const others = otherWays(account, client, stop);
  const ended = (text: string) => {
    stop();
    show(
      app,
      heading('Link it with your job hunt'),
      problem(text),
      actions(button('Ask again', () => void link(account), true)),
      others,
    );
  };
  const failed = async (error: unknown) => {
    if (await signInEnded(error)) stop();
    else ended(reasonOf(error));
  };

  let saved: Awaited<ReturnType<SyncClient['keys']>>;
  try {
    saved = await client.keys();
  } catch (error) {
    await failed(error);
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
    if (error instanceof SyncError && error.code === 'stale') signInAgain(account, others);
    else await failed(error);
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
  const slowNote = h(
    'p',
    { class: 'note', hidden: true },
    'Nothing yet? Make sure Factwright is open and up to date, and signed in to the same account.',
  );
  const waiting = () =>
    show(
      app,
      heading('Link it with your job hunt'),
      h(
        'p',
        {},
        `Open Factwright on your computer. It asks whether to link Save to Factwright in ${browserName()}. Keep this tab open until it’s linked.`,
      ),
      h('p', { class: 'muted' }, 'Waiting for Factwright…'),
      slowNote,
      others,
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

  waiting();
  let shown: 'waiting' | 'check' = 'waiting';
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
      await failed(error);
      return;
    }
    if (stopped) return;
    if (step.state === 'waiting') {
      if (shown !== 'waiting') waiting();
      shown = 'waiting';
      slowNote.hidden = Date.now() - startedAt <= SLOW_MS;
    } else if (step.state === 'check') {
      if (shown !== 'check') checking(step.check, step.approver);
      shown = 'check';
      if (confirmed && step.approved) {
        window.removeEventListener('pagehide', callOff);
        // Picked up, so it's never called off: Factwright on the computer sees it linked.
        asked = null;
        try {
          const key = await whileOffline(() => ask.finish());
          if (!key || !(await keep(account, client, key))) {
            ended('That didn’t work, so nothing was linked. Ask again.');
          }
        } catch (error) {
          await failed(error);
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
        'On a job’s page, click the Factwright button in the toolbar, check the title, company and posting, and save it. Pin the button so it’s always there.',
      ),
      h(
        'li',
        {},
        'Or press Alt+Shift+S (Option+Shift+S on a Mac), or right-click the page and choose Save job to Factwright, to save it without opening anything. Anything to check first, such as a company it can’t tell, opens the popup instead.',
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
    h('h2', {}, 'What it reads, and when'),
    h(
      'p',
      { class: 'small muted' },
      'It reads a page only when you click its button, its menu item or its shortcut, and sends nothing until you save. What it saves is locked with your job hunt’s key, which it keeps in this browser where it can’t be copied out.',
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
      'Factwright’s own tools never read LinkedIn. With this on, Save to Factwright reads the LinkedIn job you’re looking at when you click to save it, as copying it yourself would. LinkedIn’s terms forbid software that copies from it, so turn this off to save LinkedIn jobs by their link and title alone.',
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
  if (!account) {
    signedOut();
    return;
  }
  if (!(await canReachSync())) {
    askForAccess(() => void start());
    return;
  }
  if (!account.keys) void link(account);
  else void linked(account);
}

void start();
