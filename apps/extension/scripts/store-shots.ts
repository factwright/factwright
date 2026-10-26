// The stores' screenshots, into store/screenshots: `e2e` and `e2e:fill` draw theirs from what the
// extension shows along the way, when they're run with `-- --screenshots`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT } from '@factwright/ui/tokens';
import { type Browser, chromium } from '@playwright/test';

/** Whether the run is asked to draw the stores' screenshots. */
export const DRAWING = process.argv.includes('--screenshots');

/** Where the stores' screenshots go, when the run is asked to draw them. */
const SHOTS = DRAWING ? fileURLToPath(new URL('../store/screenshots', import.meta.url)) : null;

let framer: Browser | null = null;

/**
 * A store's screenshot: what the extension showed, framed at the 1280 by 800 both stores take, with
 * what it shows in words beside it.
 */
export async function frame(
  shot: Buffer,
  width: number,
  title: string,
  words: string,
  name: string,
): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  // Framed in a browser of its own at 1x, so the image is exactly 1280 by 800, with the extension's
  // pages, taken at 2x, sharp in it.
  framer ??= await chromium.launch({ channel: 'chromium', headless: true });
  const page = await framer.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;
    background:${LIGHT.sunken};color:${LIGHT.text};display:flex;align-items:center;justify-content:center;
    gap:64px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">
    <div style="max-width:400px"><h1 style="font-size:42px;line-height:1.15;margin:0 0 18px">${title}</h1>
    <p style="font-size:21px;line-height:1.45;margin:0;color:${LIGHT.muted}">${words}</p></div>
    <img alt="" style="width:${width}px;border-radius:14px;border:1px solid ${LIGHT.border};
    box-shadow:0 24px 60px rgba(20,20,40,.16)" src="data:image/png;base64,${shot.toString('base64')}">
    </body></html>`);
  await page.screenshot({ path: join(SHOTS, name) });
  await page.close();
}

/** Closes the browser that frames them, if one was opened. */
export async function closeFramer(): Promise<void> {
  await framer?.close();
  framer = null;
}
