// Draws the site's pictures in a headless Chromium: a preview of each resume template, printed
// from the made-up resume the app's own template picker uses, and the cards that link previews
// show, for the home page and the browser extension's page. Run it again after changing a
// template, a card or the extension page's drawing, on a Mac, so the cards get the system font:
// `pnpm --filter @factwright/site images`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FONT_FILES,
  type FontUrls,
  previewResume,
  renderHtml,
  TEMPLATES,
} from '@factwright/engine';
import { MARK, MARK_VIEWBOX, markSvg } from '@factwright/ui/brand';
import { themeCss } from '@factwright/ui/theme';
import { type Browser, chromium } from '@playwright/test';

const PUBLIC = new URL('../public/', import.meta.url);

/** How wide each template preview is, in pixels: sharp at the size the page shows it. */
const PREVIEW_WIDTH = 720;

/** The resume fonts as data: URLs, the way the app prints resumes, so previews match its PDFs. */
function resumeFonts(): FontUrls {
  return Object.fromEntries(
    FONT_FILES.map((file) => {
      const bytes = readFileSync(new URL(import.meta.resolve(`@factwright/engine/fonts/${file}`)));
      return [file, `data:font/woff2;base64,${bytes.toString('base64')}`];
    }),
  );
}

/** A file from pdf.js's build, which draws the printed pages. */
const pdfjs = (file: string) => fileURLToPath(import.meta.resolve(`pdfjs-dist/build/${file}`));

/** Prints each template to PDF, then draws its first page with pdf.js, as the app's picker does. */
async function templatePreviews(browser: Browser): Promise<void> {
  const fonts = resumeFonts();
  const page = await browser.newPage();
  // A made-up address, so pdf.js can load as a module. Nothing here reaches the network.
  await page.route('**/*', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Draw</title>',
      });
    }
    if (pathname === '/pdf.mjs' || pathname === '/pdf.worker.mjs') {
      const file = pathname === '/pdf.mjs' ? 'pdf.min.mjs' : 'pdf.worker.min.mjs';
      return route.fulfill({ contentType: 'text/javascript', path: pdfjs(file) });
    }
    return route.abort();
  });
  const printer = await browser.newPage();
  for (const template of TEMPLATES) {
    await printer.setContent(renderHtml(previewResume(), template, fonts));
    await printer.evaluate(() => document.fonts.ready);
    const pdf = await printer.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.goto('https://draw.invalid/');
    const image = await page.evaluate(
      async ({ data, width }) => {
        const url = '/pdf.mjs';
        const { getDocument, GlobalWorkerOptions } = await import(url);
        GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const pdf = await getDocument({ data: bytes }).promise;
        const first = await pdf.getPage(1);
        const viewport = first.getViewport({
          scale: width / first.getViewport({ scale: 1 }).width,
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await first.render({ canvas, viewport, intent: 'print' }).promise;
        return canvas.toDataURL('image/webp', 0.86);
      },
      { data: pdf.toString('base64'), width: PREVIEW_WIDTH },
    );
    const file = new URL(`templates/${template.id}.webp`, PUBLIC);
    writeFileSync(file, Buffer.from(image.replace(/^data:image\/webp;base64,/, ''), 'base64'));
    console.log(`templates/${template.id}.webp`);
  }
}

/** The site's stylesheets, in the order their index imports them. */
function siteStyles(): string {
  const styles = new URL('../src/styles/', import.meta.url);
  return readFileSync(new URL('index.css', styles), 'utf8').replace(
    /@import "\.\/([\w-]+\.css)";/g,
    (_, file: string) => readFileSync(new URL(file, styles), 'utf8'),
  );
}

/** What every card shares: the site's look, the card's size and background, and the brand. */
function cardStyles(): string {
  return `${themeCss()}
${siteStyles()}
html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
.og {
  position: relative; display: grid; grid-template-columns: 1fr 448px; gap: 56px; align-items: center;
  width: 1200px; height: 630px; padding: 0 72px; overflow: hidden; background: var(--fw-bg); isolation: isolate;
}
.og::before {
  position: absolute; inset: 0; z-index: -1; content: "";
  background-image: radial-gradient(var(--grid-dot) 1.2px, transparent 1.6px); background-size: 24px 24px;
  mask-image: radial-gradient(ellipse 80% 90% at 20% 30%, #000 20%, transparent 80%);
}
.og::after {
  position: absolute; inset: 10% -10% 10% 45%; z-index: -1; content: ""; border-radius: 50%;
  background: radial-gradient(closest-side, var(--glow), transparent); filter: blur(30px);
}
.og .brand { gap: 14px; font-size: 30px; }
.og .brand .logo { width: 42px; height: 42px; }
.og h1 {
  margin: 44px 0 0; font-family: var(--font-display); font-size: 70px; font-weight: 700;
  line-height: 1.02; letter-spacing: -0.045em;
}
.og h1 .soft { color: var(--fw-muted); }
.og-sub { margin-top: 26px; color: var(--fw-muted); font-size: 27px; }`;
}

/** Factwright's mark and name, as the cards show them. */
const cardBrand = () =>
  `<p class="brand"><svg class="logo" viewBox="${MARK_VIEWBOX}">${markSvg(MARK, 'currentColor')}</svg>Factwright</p>`;

/** The card a link to the site shows in chats and feeds: the headline, and a confirmed fact. */
function cardHtml(): string {
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>
${cardStyles()}
.og-line {
  padding: 18px 22px; border: 1px solid color-mix(in srgb, var(--fw-accent) 35%, transparent);
  border-radius: 16px; background: var(--fw-accent-soft); font-size: 20px; line-height: 1.45;
}
.og-line mark { background: none; color: var(--fw-accent-text); font-weight: 700; }
.og-link { width: 2px; height: 26px; margin-left: 56px; background: color-mix(in srgb, var(--fw-accent) 45%, transparent); }
.og .claim { margin: 0 0 0 24px; padding: 22px 24px; }
.og .claim-path { font-size: 13px; }
.og .claim-title { font-size: 21px; }
.og .tag { font-size: 13px; }
.og .claim-facts { font-size: 15px; }
.og .stamp { height: 30px; font-size: 14px; }
</style></head><body>
<div class="og">
  <div>
    ${cardBrand()}
    <h1>Tailored to the job.<br><span class="soft">True to the facts.</span></h1>
    <p class="og-sub">Your job hunt, run by your own Claude.</p>
  </div>
  <div>
    <p class="og-line">Led the repeat booking program from research to launch, lifting repeat bookings by <mark>~31%</mark>.</p>
    <div class="og-link"></div>
    <div class="card claim">
      <p class="claim-path">facts/northwind-stays.md</p>
      <p class="claim-title">Repeat booking program</p>
      <div class="tags"><span class="tag">shipped</span><span class="tag">led-and-built</span><span class="tag">high</span></div>
      <dl class="claim-facts"><dt>Numbers</dt><dd>Repeat bookings up ~31% in a year</dd><dt>Source</dt><dd>Jordan, Oct 12</dd></dl>
      <span class="stamp"><svg class="icon" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Confirmed</span>
    </div>
  </div>
</div>
</body></html>`;
}

/** The extension page's drawing of its popup, and the icons it uses, as the page has them. */
function extensionDrawing(): { sprite: string; drawing: string } {
  const page = readFileSync(new URL('../extension.html', import.meta.url), 'utf8');
  const sprite = /<svg class="sprite"[\s\S]*?<\/svg>/.exec(page)?.[0];
  const drawing = /<div class="ext-browser"[\s\S]*?<\/div>(?=\s*<\/figure>)/.exec(page)?.[0];
  if (!sprite || !drawing) throw new Error('extension.html has no drawing of the popup to draw.');
  return { sprite, drawing };
}

/** The card a link to the extension's page shows: its name, and its popup on a job's page. */
function extensionCardHtml(): string {
  const { sprite, drawing } = extensionDrawing();
  return `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>
${cardStyles()}
.og-ext { grid-template-columns: 1fr 520px; gap: 48px; padding: 0 64px 0 72px; }
.og-ext h1 { font-size: 76px; }
</style></head><body>
${sprite}
<div class="og og-ext">
  <div>
    ${cardBrand()}
    <h1>For Chrome and Firefox</h1>
    <p class="og-sub">Save the job you’re looking at, with its posting, to your job hunt.</p>
  </div>
  ${drawing}
</div>
</body></html>`;
}

/** Draws a card that link previews show, into the public folder. */
async function drawCard(browser: Browser, html: string, file: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  writeFileSync(new URL(file, PUBLIC), await page.screenshot({ type: 'png' }));
  console.log(file);
}

const browser = await chromium.launch();
try {
  await templatePreviews(browser);
  await drawCard(browser, cardHtml(), 'social.png');
  await drawCard(browser, extensionCardHtml(), 'social-extension.png');
} finally {
  await browser.close();
}
