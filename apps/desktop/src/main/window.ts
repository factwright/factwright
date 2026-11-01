import { fileURLToPath } from 'node:url';
import { SYSTEM_THEME, type ThemeChoice, themeById, themeShown } from '@factwright/ui/themes';
import { app, BrowserWindow, nativeTheme } from 'electron';
import { SYNC_ARGUMENT, VERSION_ARGUMENT } from '../shared/api.ts';
import { QUIET } from './quiet.ts';

/** The height of the window's top bar, which the title bar buttons sit in. */
const TOP_BAR_HEIGHT = 52;

/**
 * The app's icon, drawn by scripts/icon.ts. Installers will build it into the app, so it's only
 * needed while developing, for the Dock, the taskbar and the window.
 */
export const DEV_ICON = fileURLToPath(new URL('../../build/icon.png', import.meta.url));

/** The theme the user chose, which the window's own colors follow. */
let theme: ThemeChoice = SYSTEM_THEME;
/** What each open window does to follow a change of theme. */
const followers = new Set<() => void>();

/**
 * Shows a theme. The system's own controls, and what Claude Code is told, go by whether it's light
 * or dark, as they would by the system's setting. Two themes can both be dark, so the window
 * hears of the change itself too.
 */
export function showTheme(choice: ThemeChoice): void {
  theme = choice;
  nativeTheme.themeSource = themeById(choice)?.mode ?? 'system';
  for (const follow of followers) follow();
}

/**
 * Opens the app's window, locked down, in the colors of the theme chosen. It's told whether this
 * copy has Factwright's own sync, to offer it.
 */
export function createMainWindow(url: string, factwrightSync: boolean): BrowserWindow {
  const mac = process.platform === 'darwin';
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Factwright',
    backgroundColor: palette().bg,
    ...(!app.isPackaged && !mac && { icon: DEV_ICON }),
    // The app draws its own top bar, with the system's buttons inside it.
    ...(mac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 19 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() }),
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The window shows the app's version, which only the main process knows, and offers
      // Factwright's own sync only in a copy that has it.
      additionalArguments: [
        `${VERSION_ARGUMENT}${app.getVersion()}`,
        ...(factwrightSync ? [SYNC_ARGUMENT] : []),
      ],
      // Hidden in quiet mode, the window keeps its timers and drawing going, as the tests need.
      backgroundThrottling: !QUIET,
    },
  });

  const followTheme = () => {
    window.setBackgroundColor(palette().bg);
    if (!mac) window.setTitleBarOverlay(titleBarOverlay());
  };
  nativeTheme.on('updated', followTheme);
  followers.add(followTheme);
  window.on('closed', () => {
    nativeTheme.off('updated', followTheme);
    followers.delete(followTheme);
  });
  // In quiet mode it never takes the keyboard from whoever is at the computer. On a Mac it stays
  // hidden. Elsewhere Chromium stops drawing a window that hasn't shown, and the tests read what
  // Claude's panel draws, so it shows without being brought forward.
  window.once('ready-to-show', () => {
    if (!QUIET) window.show();
    else if (!mac) window.showInactive();
  });

  void window.loadURL(url);
  return window;
}

function palette() {
  return themeShown(theme, nativeTheme.shouldUseDarkColors).colors;
}

function titleBarOverlay() {
  const colors = palette();
  return { color: colors.bar, symbolColor: colors.text, height: TOP_BAR_HEIGHT };
}
