import { LIGHT } from '@factwright/ui/tokens';
import { browserName, canReachSync, clientFor, forgetAccount } from './account.ts';
import { registerScripts } from './application-sites.ts';
import { canReachComputer, canSendNow, destination, saveOnComputer } from './computer.ts';
import { ext, type Tab } from './ext.ts';
import { isSave } from './messages.ts';
import { forgetTab, onJobSiteMessage, stopWhereNotAllowed } from './on-job-sites.ts';
import { openPanel } from './panel-open.ts';
import { isWebPage, readTab } from './read-tab.ts';
import { type JobToSave, type SaveResult, saveJob } from './save.ts';
import { serverName } from './server.ts';
import { needsChecking, toSave } from './tab-job.ts';

/**
 * The extension's background: it saves jobs, for the popup, the page's right-click menu and the
 * keyboard shortcut, and opens the setup page on install. It saves through sync, or straight to
 * Factwright on this computer, as setup set it up. It holds nothing between saves: the sign-in,
 * the keys and the settings stay in the extension's own storage. On the job sites you allowed, it
 * registers the extension's script, and answers it and the extension's frame there
 * (src/on-job-sites.ts).
 */

const MENU = 'save-job';
const FILL = 'fill-form';
const TITLE = 'Factwright';

/** The right-click menu's items, made again whenever the background starts. */
function menus(): void {
  void ext.contextMenus.removeAll().then(() => {
    ext.contextMenus.create({
      id: MENU,
      title: 'Save job to Factwright',
      contexts: ['page', 'selection'],
    });
    ext.contextMenus.create({
      id: FILL,
      title: 'Fill this application with Factwright',
      contexts: ['page', 'editable'],
    });
  });
}

/**
 * Pages that look like an application form, by what Chrome sees on them itself: a file to upload
 * and an email address to give, a file to upload on an applicant system's site, each page of a
 * Workday application, by the step its progress bar marks, or a company's page that shows an
 * applicant system's application form in a frame, by the frame's address, as Chrome looks only at
 * frames of the page's own site. Chrome checks these rules, so the extension never reads a page to
 * light its button up.
 */
const FORM_PAGES: { pageUrl?: { hostSuffix: string }; css: string[] }[] = [
  { css: ['input[type="file"]', 'input[type="email"]'] },
  { css: ['input[type="file"]', 'input[autocomplete="email"]'] },
  { css: ['iframe[src*="greenhouse.io/embed/job_app"]'] },
  { css: ['iframe[src*="lever.co/"][src*="/apply"]'] },
  { css: ['iframe[src*="jobs.ashbyhq.com/"][src*="/application"]'] },
  ...[
    'greenhouse.io',
    'lever.co',
    'ashbyhq.com',
    'myworkdayjobs.com',
    'icims.com',
    'smartrecruiters.com',
    'workable.com',
    'jobvite.com',
  ].map((host) => ({ pageUrl: { hostSuffix: host }, css: ['input[type="file"]'] })),
  ...['myworkdayjobs.com', 'myworkdaysite.com'].map((host) => ({
    pageUrl: { hostSuffix: host },
    css: ['[data-automation-id="progressBarActiveStep"]'],
  })),
];

/** The toolbar button's icon with a dot in Factwright's accent, at each size it shows. */
async function litIcon(): Promise<Record<number, ImageData>> {
  const sizes = [16, 32];
  const icons: Record<number, ImageData> = {};
  for (const size of sizes) {
    const response = await fetch(ext.runtime.getURL(`icons/${size}.png`));
    const image = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(size, size);
    const draw = canvas.getContext('2d');
    if (!draw) continue;
    draw.drawImage(image, 0, 0, size, size);
    const radius = size * 0.22;
    draw.beginPath();
    draw.arc(size - radius, size - radius, radius, 0, Math.PI * 2);
    draw.fillStyle = LIGHT.need;
    draw.fill();
    icons[size] = draw.getImageData(0, 0, size, size);
  }
  return icons;
}

/** Lights the toolbar button up on pages that look like an application form, in Chrome. */
async function lightUpForms(): Promise<void> {
  const rules = ext.declarativeContent;
  if (!rules) return;
  const imageData = await litIcon();
  await rules.onPageChanged.removeRules();
  await rules.onPageChanged.addRules([
    {
      id: 'application-form',
      conditions: FORM_PAGES.map((page) => new rules.PageStateMatcher(page)),
      actions: [new rules.SetIcon({ imageData })],
    },
  ]);
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
  if (!to) return { ok: false, reason: 'signed-out', message: 'Set up the extension first.' };
  if (to.to === 'computer') return saveOnComputer(job);
  const { account } = to;
  if (!(await canReachSync(account.server))) {
    return {
      ok: false,
      reason: 'no-access',
      message: `The browser doesn’t let the extension reach ${serverName(account.server)}.`,
    };
  }
  const result = await saveJob(clientFor(account.server, account.token), account.keys, job, {
    device: `Factwright in ${browserName()}`,
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
  await ext.action.setTitle({ title: `${TITLE}: ${says}`, tabId });
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
    await checkFirst(tab, 'Ready to save it.');
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

/**
 * Registers the script for the job sites you allowed, as they are now, and stops it on pages whose
 * site isn't one of them anymore.
 */
function jobSites(): void {
  void registerScripts()
    .then(stopWhereNotAllowed)
    .catch(() => {});
}

ext.runtime.onInstalled.addListener(({ reason }) => {
  menus();
  void lightUpForms().catch(() => {});
  // An update takes the scripts a browser registered away, as Firefox does: they're registered again.
  jobSites();
  if (reason === 'install') void openSetup();
});
ext.runtime.onStartup.addListener(() => {
  menus();
  jobSites();
});
// The sites change as you turn them on or off in setup or the panel, or the browser's settings
// take one away.
ext.permissions.onAdded.addListener(jobSites);
ext.permissions.onRemoved.addListener(jobSites);
ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'jobSites' in changes) jobSites();
});
ext.tabs.onRemoved.addListener(forgetTab);

ext.contextMenus.onClicked.addListener((click, tab) => {
  if (click.menuItemId === MENU && tab) void saveTab(tab);
  // The panel opens straight from the click, as each browser asks, and fills the tab in front.
  if (click.menuItemId === FILL && tab) void openPanel(tab);
});

ext.commands.onCommand.addListener((command, tab) => {
  if (command === 'fill-form') {
    if (tab) {
      void openPanel(tab);
    } else {
      // Firefox gives no tab: its sidebar opens beside the one in front.
      void ext.sidebarAction?.open();
    }
    return;
  }
  if (command !== 'save-job') return;
  if (tab) {
    void saveTab(tab);
    return;
  }
  void ext.tabs.query({ active: true, currentWindow: true }).then(([active]) => {
    if (active) void saveTab(active);
  });
});

// Only the extension's own pages can ask to save: no site can message it, and its script on the
// job sites you allowed only asks for what to show there.
ext.runtime.onMessage.addListener(onJobSiteMessage);
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Its own pages, never its frame on a page, which only shows the Fill button and menus there.
  const ours =
    sender.id === ext.runtime.id &&
    (sender.frameId ?? 0) === 0 &&
    !/^https?:/i.test(sender.tab?.url ?? '') &&
    (sender.url ?? '').startsWith(ext.runtime.getURL(''));
  if (!ours || !isSave(message)) return undefined;
  save(message.job).then(sendResponse, (error: unknown) =>
    sendResponse({ ok: false, reason: 'failed', message: String(error) } satisfies SaveResult),
  );
  return true;
});
