# Saved job pages

Real public postings, saved on 2026-11-04 as Factwright's main process fetched them (its own user agent, gzip or deflate, never Brotli), so the tests read them in the sites' place and never reach a live site. `pages.json` lists them by the address the app asks for, with the status a site answers where it sent no page (a closed posting's 404 or 410, a site that turns apps away with 403), or `tooBig` for an answer bigger than the app reads (a big employer's whole board on Ashby).

Each page is as it came, but for what the app's reader drops anyway: other scripts than JobPosting data and Workday's, styles and pictures are emptied, and tokens and nonces are blanked.

| File | Site | What the app reads |
|---|---|---|
| greenhouse-posting.json | Greenhouse's job API (GitLab) | the posting, with its title and employer |
| lever-posting.json | Lever's postings API (Spotify) | the posting |
| ashby-posting.html | Ashby's posting page (OpenAI) | its JobPosting data, when the board's feed is too big |
| workday-posting.html | Workday (NVIDIA) | its JobPosting data |
| workday-closed.html | Workday (Clark) | that it has closed |
| smartrecruiters-posting.html | SmartRecruiters (AECOM) | the page's text |
| icims-posting.html | iCIMS (Aptive), `?in_iframe=1` | its JobPosting data |
| amazon-posting.html | amazon.jobs | the page's text |
| apple-posting.html | jobs.apple.com | almost nothing: it shows the posting only in a browser |
| taleo-posting.html | Taleo (UnitedHealth Group) | the posting from the page's own data, not its menus |
| dayforce-posting.html | Dayforce | nothing: it shows the posting only in a browser |
