import { LIGHT } from '@factwright/ui/tokens';
import { browserName, canReachSync, clientFor, forgetAccount } from './account.ts';
import { canReachComputer, canSendNow, destination, saveOnComputer } from './computer.ts';
import { ext, type Tab } from './ext.ts';
import { isSave } from './messages.ts';
import { isWebPage, readTab } from './read-tab.ts';
import { type JobToSave, type SaveResult, saveJob } from './save.ts';
import { serverName } from './server.ts';
import { needsChecking, toSave } from './tab-job.ts';

/**
 * The extension's background: it saves jobs, for the popup, the page's right-click menu and the
 * keyboard shortcut, and opens the setup page on install. It saves through sync, or straight to
 * Factwright on this computer, as setup set it up. It holds nothing between saves: the sign-in,
 * the keys and the settings stay in the extension's own storage.
 */

const MENU = 'save-job';
const TITLE = 'Save this job to Factwright';

/** The right-click menu's item, made again whenever the background starts. */
function menus(): void {
  void ext.contextMenus.removeAll().then(() =>
    ext.contextMenus.create({
      id: MENU,
      title: 'Save job to Factwright',
      contexts: ['page', 'selection'],
    }),
  );
}

/**
 * Opens the setup page, or brings it forward if it's open. The browser lists the extension's own
 * pages that are open, which `tabs.query` can't see in Chrome without the tabs permission.
 */
async function openSetup(): Promise<void> {
  const url = ext.runtime.getURL('setup.html');
  const contexts = ext.runtime.getContexts?.({ contextTypes: ['TAB'], documentUrls: [url] });
  const [open] = (await contexts?.catch(() => [])) ?? [];
  if (open && open.tabId >= 0) {
    await ext.tabs.update(open.tabId, { active: true });
    if (open.windowId >= 0) await ext.windows.update(open.windowId, { focused: true });
  } else {
    await ext.tabs.create({ url });
  }
}

/**
 * Saves a job where setup said: through sync with the extension's account, forgetting a sign-in
 * the server has ended, or to Factwright on this computer.
 */
async function save(job: JobToSave): Promise<SaveResult> {
  const to = await destination();
  if (!to) return { ok: false, reason: 'signed-out', message: 'Set up Save to Factwright first.' };
  if (to.to === 'computer') return saveOnComputer(job);
  const { account } = to;
  if (!(await canReachSync(account.server))) {
    return {
      ok: false,
      reason: 'no-access',
      message: `The browser doesn’t let Save to Factwright reach ${serverName(account.server)}.`,
    };
  }
  const result = await saveJob(clientFor(account.server, account.token), account.keys, job, {
    device: `Save to Factwright in ${browserName()}`,
    server: serverName(account.server),
  });
  if (!result.ok && result.reason === 'signed-out') await forgetAccount();
  return result;
}

/** Marks the toolbar button on a tab for a few seconds: ✓ when it saved, ! when it didn't. */
async function mark(tab: Tab, ok: boolean, says: string): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined) return;
  await ext.action.setBadgeBackgroundColor({ color: ok ? LIGHT.ok : LIGHT.bad, tabId });
  await ext.action.setBadgeText({ text: ok ? '✓' : '!', tabId });
  await ext.action.setTitle({ title: `Save to Factwright: ${says}`, tabId });
  setTimeout(() => {
    void ext.action.setBadgeText({ text: '', tabId });
    void ext.action.setTitle({ title: TITLE, tabId });
  }, 8000);
}

/** Opens the popup, to check a job before saving it, or, where the browser won't, says to. */
async function checkFirst(tab: Tab, why: string): Promise<void> {
  try {
    if (ext.action.openPopup) {
      await ext.action.openPopup();
      return;
    }
  } catch {
    // Firefox opens it only straight from a click.
  }
  await mark(tab, false, `${why} Click the Factwright button to check it, then save it.`);
}

/**
 * Saves the job on a tab without opening the popup, from the menu or the shortcut. It saves only
 * what looks like one job, and opens the popup for anything to check first, or in Firefox, which
 * opens it only straight from a click, marks the button.
 */
async function saveTab(tab: Tab): Promise<void> {
  if (!isWebPage(tab.url)) {
    await mark(tab, false, 'Open a job’s page, then save it.');
    return;
  }
  const to = await destination();
  if (!to) {
    await openSetup();
    return;
  }
  // Allowed native messaging since this background started, Chrome lets it send only once it
  // starts again, so the popup, which can, saves this job.
  if (to.to === 'computer' && !canSendNow() && (await canReachComputer())) {
    await checkFirst(tab, 'Save to Factwright is ready to save it.');
    return;
  }
  const { page, unread } = await readTab(tab);
  const job = toSave(page);
  const check = needsChecking(page, job, unread);
  if (check) {
    await checkFirst(tab, check);
    return;
  }
  const result = await save(job);
  if (!result.ok) {
    if (result.reason === 'signed-out' || result.reason === 'no-access') await openSetup();
    await mark(tab, false, result.message);
    return;
  }
  const name = [job.role, job.company].filter(Boolean).join(' at ');
  if ('later' in result) {
    const when = result.open ? 'in a moment' : 'the next time it opens';
    await mark(tab, true, `Saved ${name} for Factwright, which adds it ${when}.`);
  } else if (result.posting === 'failed') {
    await mark(tab, false, `Saved ${name}, but not its posting. Save it again to add it.`);
  } else if (result.already) {
    const added = result.posting === 'saved' ? ' Its posting was added.' : '';
    await mark(tab, true, `Already in your job hunt: ${name}.${added}`);
  } else {
    await mark(tab, true, `Saved ${name}${result.posting === 'none' ? ', by its link' : ''}.`);
  }
}

ext.runtime.onInstalled.addListener(({ reason }) => {
  menus();
  if (reason === 'install') void openSetup();
});
ext.runtime.onStartup.addListener(menus);

ext.contextMenus.onClicked.addListener((click, tab) => {
  if (click.menuItemId === MENU && tab) void saveTab(tab);
});

ext.commands.onCommand.addListener((command, tab) => {
  if (command !== 'save-job') return;
  if (tab) {
    void saveTab(tab);
    return;
  }
  void ext.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
    if (active) void saveTab(active);
  });
});

// Only the extension's own pages can ask: it has no content scripts, and no site can message it.
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const ours =
    sender.id === ext.runtime.id && (sender.url ?? '').startsWith(ext.runtime.getURL(''));
  if (!ours || !isSave(message)) return undefined;
  save(message.job).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, reason: 'failed', message: String(error) } satisfies SaveResult),
  );
  return true;
});
