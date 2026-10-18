import 'virtual:theme.css';
import './ui.css';
import { FREE_SYNC_EMAIL, OWN_SERVER_GUIDE } from '@factwright/core';
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
  type SyncAccess,
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
  giveBack,
  loadAccount,
  returnAddress,
  saveAccount,
  signOut,
  syncFetch,
  windowSignIn,
} from './account.ts';
import { type Child, h, heading, show } from './dom.ts';
import { ext } from './ext.ts';
import {
  askServer,
  codePage,
  DEFAULT_SERVER,
  EXAMPLE,
  hostOf,
  isOwn,
  readServer,
  serverName,
  signInWay,
} from './server.ts';
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const button = (text: string, click: () => void, primary = false) =>
  h('button', { type: 'button', class: primary ? 'primary' : '', on: { click } }, text);

const actions = (...buttons: Child[]) => h('div', { class: 'actions' }, ...buttons);

const problem = (text: string) => h('p', { class: 'bad', role: 'alert' }, text);

/** A sync server by its address and what it is, such as "app.factwright.com, Factwright's sync". */
const named = (server: string) =>
  `${hostOf(server)}, ${isOwn(server) ? 'your own sync server' : 'Factwright’s sync'}`;

/** What to say when a request to a sync server fails. */
function reasonOf(error: unknown, server: string): string {
  if (error instanceof SyncError) {
    if (error.kind === 'offline') {
      return `Couldn’t reach ${serverName(server)}. Check the connection.`;
    }
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

/**
 * When the browser has taken away the extension's one site, the sync server it's signed in to:
 * asks for it back, then carries on. Or it signs out, to set it up with another.
 */
function askForAccess(account: Account, next: () => void): void {
  const { server } = account;
  show(
    app,
    heading(isOwn(server) ? 'Let it reach your sync server' : 'Let it reach Factwright’s sync'),
    h(
      'p',
      {},
      `Save to Factwright saves jobs through ${named(server)}, the one site it reaches. The browser has that turned off for it, so it can’t save jobs.`,
    ),
    actions(
      button(
        'Allow it',
        () => void allowSync(server).then((ok) => (ok ? next() : askForAccess(account, next))),
        true,
      ),
      button('Sign out', () => void signOut(account).then(() => signedOut())),
    ),
  );
}

// --- Signing in ---------------------------------------------------------------------------

/** The sync setup signs in to, as it's picked on the page: Factwright's, or your own server. */
interface Choice {
  own: boolean;
  /** Your own server's address, as you typed it. */
  address: string;
}

/**
 * Setup's first page, with the sync you chose last time, or with the choice that went wrong and
 * what went wrong with it.
 */
function signedOut(note?: string, choice?: Choice): void {
  void settings().then(({ server }) =>
    choose(choice ?? { own: isOwn(server), address: isOwn(server) ? server : '' }, note),
  );
}

/** One choice of sync, a card to click anywhere on: named by its title, described by its words. */
function option(id: string, title: string, about: string, checked: boolean) {
  const input = h('input', {
    type: 'radio',
    name: 'sync',
    id,
    checked,
    'aria-labelledby': `${id}-title`,
    'aria-describedby': `${id}-about`,
  });
  const label = h(
    'label',
    { class: 'pick' },
    input,
    h(
      'span',
      { class: 'words' },
      h('span', { id: `${id}-title`, class: 'title' }, title),
      h('span', { id: `${id}-about`, class: 'about' }, about),
    ),
  );
  return { input, label };
}

function choose(choice: Choice, note?: string): void {
  const factwrights = option(
    'factwright',
    'Factwright’s sync',
    hostOf(DEFAULT_SERVER),
    !choice.own,
  );
  const own = option(
    'own',
    'Your own server',
    'A sync server you run, at the address Factwright on your computer uses.',
    choice.own,
  );
  const address = h('input', {
    id: 'server',
    type: 'url',
    value: choice.address,
    placeholder: EXAMPLE,
    autocomplete: 'url',
    autocapitalize: 'off',
    spellcheck: 'false',
  });
  const ownFields = h(
    'div',
    { class: 'address', hidden: !choice.own },
    h('label', { for: 'server' }, 'Your server’s address'),
    address,
    h(
      'p',
      { class: 'small muted' },
      'Use only a server you run or trust: it holds your locked job hunt. The browser asks once to let Save to Factwright reach it.',
    ),
  );
  const picked = () => {
    ownFields.hidden = !own.input.checked;
    if (own.input.checked) address.focus();
  };
  factwrights.input.addEventListener('change', picked);
  own.input.addEventListener('change', picked);
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Sign in to sync');
  const go = (event: Event) => {
    event.preventDefault();
    // Read and asked for on the click itself, as browsers want (see allowSync).
    const read = own.input.checked
      ? readServer(address.value)
      : ({ ok: true, server: DEFAULT_SERVER } as const);
    if (!read.ok) {
      choose({ own: true, address: address.value }, read.problem);
      document.getElementById('server')?.focus();
      return;
    }
    // While the browser asks, what went wrong before is gone, and the button waits.
    app.querySelector('[role="alert"]')?.remove();
    submit.disabled = true;
    void signIn(read.server, { own: own.input.checked, address: address.value });
  };
  show(
    app,
    heading('Set up Save to Factwright'),
    h(
      'p',
      {},
      'Save to Factwright saves the job you’re looking at, with its posting as you see it, to your Factwright job hunt. It’s locked on this computer with your job hunt’s own key before it’s sent, so only your devices can read it.',
    ),
    h(
      'form',
      // Its own checks, not the browser's, which would turn away an address without https://.
      { novalidate: true, on: { submit: go } },
      h(
        'fieldset',
        { class: 'choices' },
        h('legend', {}, 'Which sync does Factwright on your computer use?'),
        h('div', { class: 'choice' }, factwrights.label),
        h('div', { class: 'choice' }, own.label, ownFields),
      ),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, 'Sign in to sync, with the account Factwright on your computer uses.'),
        h('li', {}, 'Approve linking it, in Factwright on your computer.'),
      ),
      note && problem(note),
      actions(submit),
    ),
  );
}

/**
 * Signs in to a sync server, from a click: asks the browser to let the extension reach it, checks
 * that a server of your own answers as a Factwright sync server, then signs in: in the browser's
 * own window, where the server knows this copy of the extension, or else with a code, as with
 * `withCode`, but only with the server this copy was built for (signInWay). The server is kept as
 * your choice, and with the sign-in.
 */
async function signIn(server: string, choice: Choice, withCode = false): Promise<void> {
  // Asked on the click, as browsers want: Firefox asks for Factwright's sync the first time, and
  // both browsers ask for a server of your own, its address alone.
  if (!(await allowSync(server))) {
    signedOut(`Save to Factwright needs to reach ${named(server)}, to save jobs.`, choice);
    return;
  }
  /** Signing in there failed or was canceled: the browser's permission for it goes back. */
  const failed = async (note?: string) => {
    await giveBack(server, (await loadAccount())?.server ?? null);
    signedOut(note, choice);
  };
  try {
    await signInThrough(server, choice, failed, withCode);
  } catch (error) {
    // Whatever goes wrong, such as the browser's storage failing, ends it the same way.
    await failed(reasonOf(error, server));
  }
}

/**
 * Signs in through a server the browser lets the extension reach, and links it once it's in. When
 * it can't, `failed` says why.
 */
async function signInThrough(
  server: string,
  choice: Choice,
  failed: (note?: string) => Promise<void>,
  withCode: boolean,
): Promise<void> {
  if (isOwn(server)) {
    show(
      app,
      heading('Set up Save to Factwright'),
      h('p', { class: 'muted', role: 'status' }, `Checking ${hostOf(server)}…`),
    );
  }
  // Factwright's sync is asked too, for whether it signs this copy in through the window.
  const asked = await askServer(server, syncFetch);
  if (isOwn(server) && asked.check !== 'ok') {
    await failed(
      asked.check === 'unreachable'
        ? `${hostOf(server)} didn’t answer. Check its address and the connection, then try again.`
        : `${hostOf(server)} doesn’t answer as a Factwright sync server. Check its address: it’s the one Factwright on your computer uses.`,
    );
    return;
  }
  await changeSettings({ server });
  const way = signInWay(server, asked, returnAddress(), ext.runtime.id, withCode);
  if ('problem' in way) {
    await failed(way.problem);
    return;
  }
  if (way.by === 'code') {
    await signInWithCode(server, failed);
    return;
  }
  show(
    app,
    heading('Sign in to sync'),
    h(
      'p',
      {},
      `In the window that opened, at ${hostOf(server)}, sign in if it asks, then allow Save to Factwright.`,
    ),
    h(
      'p',
      { class: 'muted', role: 'status' },
      'Waiting for you to allow it… To cancel, close that window.',
    ),
  );
  const result = await windowSignIn(server, way.redirect);
  if (result.ok) await signedIn(server, result.token);
  else if (result.reason === 'canceled') await failed();
  else if (result.reason === 'denied') {
    await failed('You chose Don’t allow, so Save to Factwright didn’t sign in.');
  } else {
    // Nothing signed in, so a server of your own's permission goes back now, as when signing in
    // fails any other way. Trying again asks for it again, on that click.
    await giveBack(server, (await loadAccount())?.server ?? null);
    windowFailed(server, choice, failed, result.message);
  }
}

/**
 * What a sign-in window that stopped short says: try again, or, with the server this copy was
 * built for, sign in with a code instead, for a browser whose window can't do it, as in a private
 * window. A server of your own signs in through the window alone (signInWay).
 */
function windowFailed(
  server: string,
  choice: Choice,
  failed: (note?: string) => Promise<void>,
  message: string,
): void {
  const reason =
    message === 'Authorization page could not be loaded.'
      ? `A page in the sign-in window didn’t load, so it closed. Check the connection, then try again.`
      : message;
  const again = button(
    'Try again',
    () => {
      again.disabled = true;
      void signIn(server, choice);
    },
    true,
  );
  const code = button('Sign in with a code instead', () => {
    code.disabled = true;
    void signIn(server, choice, true);
  });
  const own = isOwn(server);
  show(
    app,
    heading('Sign in to sync'),
    problem(reason),
    !own &&
      h(
        'p',
        { class: 'small muted' },
        `Or sign in with a code: this tab shows one, and ${hostOf(server)} opens in a tab of its own, where you allow it.`,
      ),
    actions(
      again,
      !own && code,
      button('Cancel', () => void failed()),
    ),
  );
}

/**
 * Signs in with a code, which the person allows in a tab at the server: only with the server this
 * copy was built for (signInWay), where the window can't sign it in, or when the person asks for
 * it.
 */
async function signInWithCode(
  server: string,
  failed: (note?: string) => Promise<void>,
): Promise<void> {
  const flow = deviceSignIn(server);
  const pending = await flow.start();
  const opens = codePage(pending.url, server);
  if (!opens.ok) {
    flow.cancel();
    await failed(opens.problem);
    return;
  }
  const page = () => void ext.tabs.create({ url: opens.url });
  show(
    app,
    heading('Sign in to sync'),
    h(
      'p',
      {},
      `In the tab that opened, at ${hostOf(server)}, sign in, then check it shows this code:`,
    ),
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
    await failed(result.reason === 'canceled' ? undefined : result.message);
    return;
  }
  await signedIn(server, result.token);
}

/**
 * Keeps a new sign-in, for the account it's for, then links it. A sign-in it can't keep is ended
 * on the server, so it isn't left on the account's devices with no one to use it.
 */
async function signedIn(server: string, token: string): Promise<void> {
  let account: Account;
  try {
    const info = await clientFor(server, token).account();
    account = { server, user: info.user.id, email: info.user.email, token, keys: null };
    await saveAccount(account);
  } catch (error) {
    await endSession({ server, token });
    throw error;
  }
  void link(account);
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
    else if (subscriptionNeeded(error)) {
      onDone();
      needsSubscription(account);
    } else tell(reasonOf(error, account.server));
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

/** Whether the server turned a request down because the account needs a subscription to sync. */
const subscriptionNeeded = (error: unknown) =>
  error instanceof SyncError && error.kind === 'subscription-needed';

/**
 * Where sync is sold, as on Factwright's server, an account without it can't link a browser: it
 * subscribes in Factwright on the computer first, or runs a server of its own, which is free.
 */
function needsSubscription(account: Account): void {
  const own = isOwn(account.server);
  show(
    app,
    heading('Sync needs a subscription'),
    h(
      'p',
      {},
      `${own ? `Sync through ${hostOf(account.server)}` : 'Factwright’s sync'} needs a subscription, and this account doesn’t have one now. Subscribe in Factwright on your computer, from Sync, then come back here.`,
    ),
    !own &&
      h(
        'p',
        {},
        'Rather run your own sync server? It’s free. ',
        h('a', { href: OWN_SERVER_GUIDE, target: '_blank', rel: 'noopener' }, 'How to set one up'),
        '. Then sign out here, and set Save to Factwright up with it.',
      ),
    !own &&
      h(
        'p',
        { class: 'small muted' },
        'Money’s tight? Email ',
        h('a', { href: `mailto:${FREE_SYNC_EMAIL}` }, FREE_SYNC_EMAIL),
        ' and I’ll turn on sync for free. No questions asked.',
      ),
    h(
      'p',
      { class: 'small muted' },
      `This is ${account.email}, on ${serverName(account.server)}. If Factwright on your computer syncs with another account or server, sign out and set it up with that one.`,
    ),
    actions(
      button('Check again', () => void link(account), true),
      button('Sign out', () => void signOut(account).then(() => signedOut())),
    ),
  );
}

/**
 * A sign-in too old to ask Factwright on the computer with, which the server allows only soon after
 * signing in: sign in again, or link with a link code or the recovery key, which still work.
 */
function signInAgain(account: Account, others: HTMLElement): void {
  const again = button(
    'Sign in again',
    () => {
      // The new sign-in asks the browser on this click, once. The old one is ended on the server.
      again.disabled = true;
      const own = isOwn(account.server);
      void signIn(account.server, { own, address: own ? account.server : '' });
      void endSession(account);
    },
    true,
  );
  show(
    app,
    heading('Sign in again to link it'),
    h(
      'p',
      {},
      'It’s been a while since Save to Factwright signed in, so sign in again to ask Factwright on your computer to link it. Or link it with a link code or your recovery key.',
    ),
    actions(again),
    others,
  );
}

/**
 * Asks Factwright on the computer to link Save to Factwright: the person checks both show the same
 * emoji, and says so on each. Only then is the account's key handed over, sealed for this browser.
 */
async function link(account: Account): Promise<void> {
  const client = clientFor(account.server, account.token);
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
    else if (subscriptionNeeded(error)) {
      stop();
      needsSubscription(account);
    } else ended(reasonOf(error, account.server));
  };

  let saved: Awaited<ReturnType<SyncClient['keys']>>;
  // Where sync is sold, how the account has it. A server that doesn't sell sync says nothing.
  let access: SyncAccess | undefined;
  try {
    [saved, access] = await Promise.all([
      client.keys(),
      client.account().then((info) => info.access),
    ]);
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
      h(
        'p',
        { class: 'small muted' },
        `This is ${account.email}, on ${serverName(account.server)}. If Factwright on your computer syncs with another account or server, sign out and set it up with that one.`,
      ),
      actions(
        button('Check again', () => void link(account), true),
        button('Sign out', () => void signOut(account).then(() => signedOut())),
      ),
    );
    return;
  }
  if (access && !access.allowed) {
    needsSubscription(account);
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
    void syncFetch(new URL(`${API.requests}/${ask.id}`, account.server), {
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
        'Or press Alt+Shift+S (Option+Shift+S on a Mac), or right-click the page and choose Save job to Factwright, to save it without opening anything. Anything to check first, such as a company it can’t tell, opens the popup instead, or in Firefox, which lets only a click open it, marks the button with “!” for you to click.',
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
    h(
      'p',
      { class: 'small muted' },
      isOwn(account.server)
        ? `Saves through your own sync server, ${hostOf(account.server)}. To use another, sign out, then set it up again.`
        : `Saves through Factwright’s sync, ${hostOf(account.server)}.`,
    ),
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
  if (!(await canReachSync(account.server))) {
    askForAccess(account, () => void start());
    return;
  }
  if (!account.keys) void link(account);
  else void linked(account);
}

void start();
