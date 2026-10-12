import { fileURLToPath } from 'node:url';
import { DARK, LIGHT } from '@factwright/ui/tokens';
import { app, BrowserWindow, nativeTheme } from 'electron';

/** The height of the window's top bar, which the title bar buttons sit in. */
const TOP_BAR_HEIGHT = 52;

/**
 * The app's icon, drawn by scripts/icon.ts. Installers will build it into the app, so it's only
 * needed while developing, for the Dock, the taskbar and the window.
 */
export const DEV_ICON = fileURLToPath(new URL('../../build/icon.png', import.meta.url));

/** Opens the app's window, locked down, in the colors of the system's light or dark setting. */
export function createMainWindow(url: string): BrowserWindow {
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
    },
  });

  const followTheme = () => {
    window.setBackgroundColor(palette().bg);
    if (!mac) window.setTitleBarOverlay(titleBarOverlay());
  };
  nativeTheme.on('updated', followTheme);
  window.on('closed', () => nativeTheme.off('updated', followTheme));
  window.once('ready-to-show', () => window.show());

  void window.loadURL(url);
  return window;
}

function palette() {
  return nativeTheme.shouldUseDarkColors ? DARK : LIGHT;
}

function titleBarOverlay() {
  const colors = palette();
  return { color: colors.bar, symbolColor: colors.text, height: TOP_BAR_HEIGHT };
}
