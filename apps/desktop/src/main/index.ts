import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, session } from 'electron';
import { registerIpc } from './ipc.ts';
import { contentSecurityPolicy } from './policy.ts';
import { APP_ORIGIN, registerAppScheme, serveApp } from './protocol.ts';
import { applyDevPolicy, denyPermissions, hardenContents } from './security.ts';
import { createMainWindow } from './window.ts';

// Set by `pnpm dev`: the screens come from Vite's dev server instead of the built files.
const devUrl = process.env.FACTWRIGHT_DEV_URL;
const startUrl = devUrl ?? `${APP_ORIGIN}/index.html`;

if (app.requestSingleInstanceLock()) {
  start();
} else {
  // Factwright is already open, and that copy brings its window forward.
  app.quit();
}

function start(): void {
  registerAppScheme();
  app.on('web-contents-created', (_event, contents) => hardenContents(contents));

  app.whenReady().then(() => {
    const policy = contentSecurityPolicy(devUrl);
    if (devUrl) applyDevPolicy(session.defaultSession, policy);
    else serveApp(fileURLToPath(new URL('../renderer', import.meta.url)), policy);
    denyPermissions(session.defaultSession);
    registerIpc((url) => url.startsWith(devUrl ?? `${APP_ORIGIN}/`));

    let window = createMainWindow(startUrl);
    app.on('second-instance', () => {
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) window = createMainWindow(startUrl);
    });
  });

  app.on('window-all-closed', () => {
    // Mac apps stay open with no windows, until the user quits.
    if (process.platform !== 'darwin') app.quit();
  });
}
