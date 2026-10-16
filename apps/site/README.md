# Website

factwright.com: one page that explains Factwright and shows how it works, its download pages, a page for its browser extension, its privacy policy and terms, and a "not found" page. It's static: the page reads fine without its script, which only adds the motion.

It's built on the design system in [`@factwright/ui`](../../packages/ui): its colors and fonts come from the same tokens as the app, in light and dark, so the drawings of the app's screens match the app itself.

| Part | What it does |
|---|---|
| `index.html` | The page: what Factwright is, how it works in five steps, the fact bank, the Run buttons, the templates, whose Claude does the work, its open-source code and who makes it, and questions |
| `download.html`, `download/` | The download pages. `/download/mac` and `/download/windows` start that computer's download and say how to install it, with a link in case it doesn't start. `/download` goes on to the one for the visitor's computer, or shows both on a phone or Linux |
| `extension.html` | The page for Save to Factwright, the browser extension, at `/extension`: what it does, how it treats what it reads, and setting it up, with a button for each store. Every page's footer links to it, and so do the home page, the download pages, and the app's Add job and Sync dialogs |
| `privacy.html`, `terms.html` | The privacy policy and the terms of service, at `/privacy` and `/terms`. Every page's footer links to both, and so does signing in to sync, in the app and the web view |
| `404.html` | The page for an address that doesn't exist |
| `src/main.ts` | The motion: the app drawing plays a run in Claude's panel, a claim gets confirmed, the score bars fill, and each resume line opens the fact behind it |
| `src/stores.ts` | The extension's listing in each browser's store, and whether the store has approved it yet, which the build writes into its page's buttons. A store that hasn't shows as coming soon, with no link. Until one has, the site's other mentions of the extension say it's coming soon too, from words in a `data-soon` span, which the build drops once a store is live |
| `src/styles` | The site's layout and type, and the drawings of the app, in a few files that `index.css` imports in order |
| `scripts/theme.ts` | The design system's theme as CSS, plus the colors Claude Code shows in Claude's panel |
| `scripts/images.ts` | Draws the template previews, printed from the made-up resume the app's own template picker uses, and the cards link previews show, for the home page and the extension's page |
| `scripts/stats.ts` | Prints how many people download Factwright and use sync, in counts only (see [Download counts and stats](#download-counts-and-stats)) |
| `public` | The template previews, the link preview cards, `robots.txt`, the sitemap, and headers for files the Worker doesn't serve. The icons are the web view's, from [`apps/web/public`](../web/public) |
| `worker` | The Worker that serves the pages: it sends www.factwright.com and plain http to https://factwright.com, and adds the security headers. It fills the download pages in with the newest version, read from the update feeds on downloads.factwright.com, and counts each download on its way to the installer |

## Running it
```bash
pnpm --filter @factwright/site dev
```

It opens at http://localhost:5173 and reloads as you change it. The download pages show the version only through the Worker, once a release is out, and without it their download links do nothing. To see it the way Cloudflare serves it, with the Worker and its headers, run `pnpm --filter @factwright/site serve`: it builds the site and serves it at http://localhost:8788. `--local-upstream` keeps the local address; without it, Wrangler hands the Worker factwright.com, which it sends to https.

After changing a resume template, a link preview card or the extension page's drawing, draw the pictures again, on a Mac so the cards get the system font. It needs Playwright's Chromium, once: `pnpm --filter @factwright/site exec playwright install chromium`.

```bash
pnpm --filter @factwright/site images
```

## Security
The pages run only the site's own scripts and styles, connect nowhere (the Worker reads the update feeds, not the page), can't be shown inside another site, and keep to https. The site has its own address, apart from the web view at app.factwright.com, so nothing on it shares the address where the web view keeps its keys.

## Search
Every page has a title. Every page but the "not found" page, which asks search engines to skip it, also has a description and a canonical address, and the home page and the extension's page have the cards that link previews show. `public/robots.txt` lets search engines in, and `public/sitemap.xml` lists the pages worth finding.

The home page also tells search engines what Factwright is, in a block of JSON-LD in its `<head>`: free, for macOS and Windows, from Neatifai LLC. It's data, not a script, so the security policy above doesn't apply to it and stays as it is.

The drawings of the app show made-up jobs, so each one carries `data-nosnippet`, which asks Google and Bing to leave those companies out of the snippets they show. When you redraw one, keep it, and add any new made-up company or person to `MADE_UP` in `test/pages.test.ts`. The tests check that each drawing carries it, and that no made-up name sits outside a marked part of the page, not even in the title or a description.

## Download counts and stats
The download pages' links go to `/download/get/mac` and `/download/get/windows`. The Worker counts each download there, then sends the browser on to the newest installer on downloads.factwright.com. A count is the computer and the version, in Cloudflare's Workers Analytics Engine, which notes when, as it does for every count, and keeps each one for 3 months in the `factwright_downloads` dataset. Nothing about who downloaded is kept: no IP address, browser or ID. The privacy policy says so, so a change to what's counted needs a change to it too.

Only a person's browser following a link counts: a navigation of the whole tab, as every current browser marks one, or Chrome's Save link as. A page's script, a frame, a prefetch, a download picking up where it left off, and anything that doesn't say how it asked, such as a download tool, a browser from before 2023 or a link preview a chat service fetches on its servers, isn't counted. A preview a phone makes itself, as Apple's Messages can, may count. `robots.txt` and `rel="nofollow"` keep search engines off the links. The counts are a guide, not an exact tally: reloading a download page starts its download again, as does "Didn't start?" after a download began, and each counts, and anyone who wants to can add counts on purpose. Downloads from GitHub Releases, and updates, which the app gets from downloads.factwright.com itself, aren't counted. A local preview's counts never reach Cloudflare.

The sync server keeps its own totals: once a day, its daily job counts its accounts, the ones made the day before and in the last week and month, the ones used in the last week and month, and the sign-ins that haven't ended, in the app and in browsers, and keeps only those totals, in the `factwright_sync` dataset ([`apps/server/src/sync-totals.ts`](../server/src/sync-totals.ts)).

`pnpm --filter @factwright/site stats` reads both datasets and prints the downloads of the last 90 days, by computer and version, with the last 14 UTC days that had any, and the newest sync totals, with the new accounts of the last 14 days. It reads counts only, so it can't show a name, an email or anything else about a person. The app itself reports nothing, so someone who never turns on sync shows up only as a download.

It needs a Cloudflare API token that can read analytics and nothing else. In the Cloudflare dashboard, under **My Profile → API Tokens → Create Token → Create Custom Token**, give it one permission, **Account · Account Analytics · Read**, for the account factwright.com runs in. It can't reach the accounts database, or change anything. Keep it in your password manager, never in a file here. The command reads it from `FACTWRIGHT_STATS_TOKEN`, not `CLOUDFLARE_API_TOKEN`, so it never stands in for Wrangler's own sign-in, and the account's ID from `CLOUDFLARE_ACCOUNT_ID`: the long code after `dash.cloudflare.com/` in the dashboard's address. To give the token to the one command, without it showing, landing in your shell's history, or staying for the commands after:

```bash
read -rs TOKEN && FACTWRIGHT_STATS_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID=<the account's ID> pnpm --filter @factwright/site stats; unset TOKEN
```

With 1Password's command-line tool, `FACTWRIGHT_STATS_TOKEN="$(op read 'op://<vault>/<item>/credential')"` in place of `read` does the same.

## Deploying
It runs on Cloudflare Workers, in the same account as factwright.com. Only the pages go through the Worker: built files and template previews skip it, so a busy day on the site barely touches the daily Worker requests the account's sync server shares.

1. Sign in to that Cloudflare account, with only what a deploy needs: `pnpm --filter @factwright/site exec wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write zone:read`.
2. `pnpm --filter @factwright/site run deploy` builds the site and deploys the `factwright-site` Worker. It needs `run`, as `pnpm deploy` on its own is a different pnpm command. Its first deploy set up factwright.com and www.factwright.com on their own.
3. `pnpm --filter @factwright/site exec wrangler logout`.
