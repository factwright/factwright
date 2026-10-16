import { LIGHT } from '@factwright/ui/tokens';
import { browserName, clientFor, forgetAccount, loadAccount } from './account.ts';
import { ext, type Tab } from './ext.ts';
import { isSave } from './messages.ts';
import { isWebPage, readTab } from './read-tab.ts';
import { type JobToSave, type SaveResult, saveJob } from './save.ts';
import { toSave } from './tab-job.ts';

/**
 * The extension's background: it saves jobs, for the popup, the page's right-click menu and the
 * keyboard shortcut, and opens the setup page on install. It holds nothing between saves: the
 * sign-in and the keys stay in the extension's own storage.
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

/** Opens the setup page, or brings it forward if it's open. */
async function openSetup(): Promise<void> {
  const url = ext.runtime.getURL('setup.html');
  const [open] = await ext.tabs.query({ url });
  if (open?.id !== undefined) await ext.tabs.update(open.id, { active: true });
  else await ext.tabs.create({ url });
}

/** Saves a job with the extension's account, forgetting a sign-in the server has ended. */
async function save(job: JobToSave): Promise<SaveResult> {
  const account = await loadAccount();
  if (!account?.keys) {
    return { ok: false, reason: 'signed-out', message: 'Set up Save to Factwright first.' };
  }
  const result = await saveJob(clientFor(account.token), account.keys, job, {
    device: `Save to Factwright in ${browserName()}`,
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
  }, 5000);
}

/** Saves the job on a tab without opening the popup, from the menu or the shortcut. */
async function saveTab(tab: Tab): Promise<void> {
  if (!isWebPage(tab.url)) {
    await mark(tab, false, 'Open a job’s page, then save it.');
    return;
  }
  if (!(await loadAccount())?.keys) {
    await openSetup();
    return;
  }
  const { page } = await readTab(tab);
  const result = await save(toSave(page));
  if (!result.ok && result.reason === 'signed-out') await openSetup();
  const name = [page.title, page.company].filter(Boolean).join(' at ') || page.url;
  await mark(
    tab,
    result.ok,
    result.ok
      ? result.already
        ? `Already in your job hunt: ${name}`
        : `Saved ${name}`
      : result.message,
  );
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
  if (sender.id !== ext.runtime.id || !isSave(message)) return undefined;
  void save(message.job).then(sendResponse);
  return true;
});
