// Takes the README's pictures of the app, each framed as a Mac window, in light and dark: the
// jobs while Claude asks a question, the fact bank, and the journey. They come from the screens
// preview's made-up job hunt, so no one's real data is in them. Take them again after a change
// they show, on a Mac so the app gets the system font: `pnpm --filter @factwright/desktop
// screenshots`. It needs Playwright's Chromium, once: `pnpm exec playwright install chromium`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';

/** Where the README finds the pictures. */
const OUT = new URL('../../../docs/images/', import.meta.url);

/** The app's version, which the sidebar shows at the bottom. */
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** One picture: its name, the window's size in points, and how to get the app there. */
interface Shot {
  name: string;
  width: number;
  height: number;
  /** The screens preview's address after its host, with the sample answers it asks for. */
  path: string;
  show: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  {
    name: 'jobs',
    width: 1280,
    height: 960,
    path: '/?profile=done&run=asks',
    show: async (page) => {
      await page.getByRole('button', { name: /^Northwind Labs/ }).click();
      await page.getByRole('button', { name: /^Interview prep/ }).click();
      await page.getByText('Needs your answer').first().waitFor();
    },
  },
  {
    name: 'fact-bank',
    width: 1280,
    height: 820,
    path: '/?profile=done',
    show: async (page) => {
      await page.getByRole('button', { name: /^Fact bank/ }).click();
      await page.getByRole('button', { name: /^Tidewater Analytics/ }).click();
    },
  },
  {
    name: 'journey',
    width: 1280,
    height: 820,
    path: '/?profile=done',
    show: async (page) => {
      // A job open behind the dialog, as there usually is.
      await page.getByRole('button', { name: /^Northwind Labs/ }).click();
      await page.getByRole('button', { name: 'Your journey' }).click();
      await page.getByText('Flow chart', { exact: true }).click();
    },
  },
];

/** Room around the window for its shadow, in points. */
const MARGIN = { top: 24, side: 40, bottom: 56 };

/** Each picture's pixels per point, sharp on a Retina screen. */
const SCALE = 2;

/**
 * A screenshot in a Mac window: rounded corners, the window buttons where the app asks macOS to
 * put them, an edge, and a shadow on a clear background, so it suits a light or a dark page.
 */
function windowHtml(shot: Shot, png: Buffer, dark: boolean): string {
  const edge = dark
    ? '0 0 0 1px rgb(0 0 0 / 0.7), 0 24px 56px -12px rgb(0 0 0 / 0.6)'
    : '0 0 0 0.5px rgb(0 0 0 / 0.22), 0 24px 56px -12px rgb(0 0 0 / 0.3)';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: transparent; }
body { width: fit-content; padding: ${MARGIN.top}px ${MARGIN.side}px ${MARGIN.bottom}px; }
.window {
  position: relative; width: ${shot.width}px; height: ${shot.height}px; overflow: hidden;
  border-radius: 12px; box-shadow: ${edge}, 0 8px 20px -8px rgb(0 0 0 / 0.2);
}
.window img { display: block; width: 100%; height: 100%; }
.window::after {
  position: absolute; inset: 0; border-radius: inherit; content: "";
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / ${dark ? 0.1 : 0});
}
.buttons { position: absolute; top: 19px; left: 18px; display: flex; gap: 8px; }
.buttons i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.22); }
.buttons i:nth-child(1) { background: #ff5f57; }
.buttons i:nth-child(2) { background: #febc2e; }
.buttons i:nth-child(3) { background: #28c840; }
</style></head><body><div class="window">
<img src="data:image/png;base64,${png.toString('base64')}" alt="">
<span class="buttons"><i></i><i></i><i></i></span>
</div></body></html>`;
}

/** Takes one picture in one theme, and saves it as WebP, which keeps the shadow's clear edges. */
async function take(browser: Browser, base: string, shot: Shot, dark: boolean): Promise<void> {
  const colorScheme = dark ? 'dark' : 'light';
  const app = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: SCALE,
    colorScheme,
  });
  const address = new URL(shot.path, base);
  address.searchParams.set('version', version);
  await app.goto(address.href);
  await shot.show(app);
  // Long enough for the panels to finish moving and the terminal to draw.
  await app.waitForTimeout(800);
  const png = await app.screenshot();
  await app.close();

  const frame = await browser.newPage({ deviceScaleFactor: SCALE, colorScheme });
  await frame.setContent(windowHtml(shot, png, dark));
  const framed = await frame.locator('body').screenshot({ omitBackground: true });
  // Chromium writes WebP from a canvas. The script runs in the page, so it's written out as text.
  await frame.setContent(`<img src="data:image/png;base64,${framed.toString('base64')}">`);
  const webp = await frame.evaluate<string>(`(async () => {
    const image = document.querySelector('img');
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.9);
  })()`);
  await frame.close();

  const file = `${shot.name}-${colorScheme}.webp`;
  writeFileSync(new URL(file, OUT), Buffer.from(webp.split(',')[1] ?? '', 'base64'));
  console.log(`docs/images/${file}`);
}

mkdirSync(OUT, { recursive: true });
// The screens preview: the app's window in a plain browser, answered by its sample answers.
const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.renderer.config.ts', import.meta.url)),
  root: fileURLToPath(new URL('../src/renderer', import.meta.url)),
  server: { port: 0, strictPort: false },
  logLevel: 'warn',
});
await server.listen();
const browser = await chromium.launch();
try {
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('The screens preview didn’t start.');
  for (const shot of SHOTS) {
    for (const dark of [false, true]) await take(browser, base, shot, dark);
  }
} finally {
  await browser.close();
  await server.close();
}
