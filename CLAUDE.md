# Working on Factwright

## Starting the desktop app while someone uses the computer

The app must never take over the screen of whoever is using the computer while you work.

- **The e2e tests run quietly.** `openApp()` in `apps/desktop/e2e/app.ts` starts the app with `FACTWRIGHT_QUIET=on`. Its window stays hidden and never takes the keyboard, it has no Dock icon, and it shows no notifications. Tests still drive the page, which runs as usual, and a test that needs a notification listens for the app's `quiet-notification` event.
- **Any other launch uses the same setting:** `FACTWRIGHT_QUIET=on`, or the e2e helper `openApp()`. Don't run `pnpm start` or `pnpm dev` just to look at a screen. Use `pnpm --filter @factwright/desktop screens` in the browser pane instead. It shows the screens with sample data and opens no app window.
- **Run fewer launches.** While you work, run only the e2e file for what you changed, such as `pnpm --filter @factwright/desktop e2e onboarding`, or one test with `--grep`. Run the whole suite once at the end, or leave it to CI. Don't run the whole suite again after each small change.
- **On a branch from before quiet mode,** the app's window still shows on every launch. Merge main into the branch first, or run as little as you can.
