import { ext, type Tab } from './ext.ts';

/**
 * Opens the panel beside the page, where filling a form is checked: Chrome's side panel, or
 * Firefox's sidebar. Each browser opens it only straight from a click, a menu item or a shortcut,
 * so it's called before anything else is waited on. The panel fills the tab in front.
 */
export function openPanel(tab: Tab): Promise<void> {
  if (ext.sidePanel) {
    return ext.sidePanel.open(
      tab.windowId !== undefined ? { windowId: tab.windowId } : { tabId: tab.id ?? -1 },
    );
  }
  return ext.sidebarAction ? ext.sidebarAction.open() : Promise.resolve();
}
