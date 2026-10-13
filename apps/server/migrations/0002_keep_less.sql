-- Each session says how it signed in: "web" after GitHub or Google in a browser, or "device"
-- with a code someone approved. Only a web session can delete the account or approve a code.
-- The column, as Better Auth's own migration tool writes it (`pnpm schema`).
alter table "session" add column "via" text;

-- A session from before this can't show how it signed in, so it counts as a device's: it keeps
-- syncing, and a browser signs in again before it deletes the account or approves a code.
UPDATE "session" SET via = 'device';

-- What sign-in kept before it stopped: each session's IP address, GitHub's and Google's tokens,
-- and the link to a profile picture. The daily cleanup shortens each session's device to its name.
UPDATE "session" SET ipAddress = NULL;
UPDATE "account" SET accessToken = NULL, refreshToken = NULL, idToken = NULL,
  accessTokenExpiresAt = NULL, refreshTokenExpiresAt = NULL;
UPDATE "user" SET image = NULL;
