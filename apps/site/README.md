# Website

factwright.com: one page that explains Factwright and shows how it works, its download pages, its privacy policy and terms, and a "not found" page. It's static: the page reads fine without its script, which only adds the motion.

It's built on the design system in [`@factwright/ui`](../../packages/ui): its colors and fonts come from the same tokens as the app, in light and dark, so the drawings of the app's screens match the app itself.

| Part | What it does |
|---|---|
| `index.html` | The page: what Factwright is, how it works in five steps, the fact bank, the Run buttons, the templates, whose Claude does the work, its open-source code and who makes it, and questions |
| `download.html`, `download/` | The download pages. `/download/mac` and `/download/windows` start that computer's download and say how to install it, with a link in case it doesn't start. `/download` goes on to the one for the visitor's computer, or shows both on a phone or Linux |
| `privacy.html`, `terms.html` | The privacy policy and the terms of service, at `/privacy` and `/terms`. Every page's footer links to both, and so does signing in to sync, in the app and the web view |
| `404.html` | The page for an address that doesn't exist |
| `src/main.ts` | The motion: the app drawing plays a run in Claude's panel, a claim gets confirmed, the score bars fill, and each resume line opens the fact behind it |
| `src/styles` | The site's layout and type, and the drawings of the app, in a few files that `index.css` imports in order |
| `scripts/theme.ts` | The design system's theme as CSS, plus the colors Claude Code shows in Claude's panel |
| `scripts/images.ts` | Draws the template previews, printed from the made-up resume the app's own template picker uses, and the card link previews show |
| `public` | The template previews, the link preview card, `robots.txt`, the sitemap, and headers for files the Worker doesn't serve. The icons are the web view's, from [`apps/web/public`](../web/public) |
| `worker` | The Worker that serves the pages: it sends www.factwright.com and plain http to https://factwright.com, and adds the security headers. It fills the download pages in with the newest version, read from the update feeds on downloads.factwright.com |

## Running it
```bash
pnpm --filter @factwright/site dev
```

It opens at http://localhost:5173 and reloads as you change it. The download pages show the version only through the Worker, once a release is out. To see it the way Cloudflare serves it, with the Worker and its headers, run `pnpm --filter @factwright/site serve`: it builds the site and serves it at http://localhost:8788. `--local-upstream` keeps the local address; without it, Wrangler hands the Worker factwright.com, which it sends to https.

After changing a resume template or the link preview card, draw the pictures again, on a Mac so the card gets the system font. It needs Playwright's Chromium, once: `pnpm --filter @factwright/site exec playwright install chromium`.

```bash
pnpm --filter @factwright/site images
```

## Security
The pages run only the site's own scripts and styles, connect nowhere (the Worker reads the update feeds, not the page), can't be shown inside another site, and keep to https. The site has its own address, apart from the web view at app.factwright.com, so nothing on it shares the address where the web view keeps its keys.

## Search
Every page has a title. Every page but the "not found" page, which asks search engines to skip it, also has a description and a canonical address, and the home page has the card that link previews show. `public/robots.txt` lets search engines in, and `public/sitemap.xml` lists the pages worth finding.

The home page also tells search engines what Factwright is, in a block of JSON-LD in its `<head>`: free, for macOS and Windows, from Neatifai LLC. It's data, not a script, so the security policy above doesn't apply to it and stays as it is.

The drawings of the app show made-up jobs, so each one carries `data-nosnippet`, which asks Google and Bing to leave those companies out of the snippets they show. When you redraw one, keep it, and add any new made-up company or person to `MADE_UP` in `test/pages.test.ts`. The tests check that each drawing carries it, and that no made-up name sits outside a marked part of the page, not even in the title or a description.

## Deploying
It runs on Cloudflare's free plan, in the same account as factwright.com. Only the pages go through the Worker: built files and template previews skip it, so a busy day on the site barely touches the daily Worker requests the account's sync server shares.

1. Sign in to that Cloudflare account, with only what a deploy needs: `pnpm --filter @factwright/site exec wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write zone:read`.
2. `pnpm --filter @factwright/site run deploy` builds the site and deploys the `factwright-site` Worker. It needs `run`, as `pnpm deploy` on its own is a different pnpm command. Its first deploy set up factwright.com and www.factwright.com on their own.
3. `pnpm --filter @factwright/site exec wrangler logout`.
