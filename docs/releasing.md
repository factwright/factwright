# Releasing

How a version of Factwright reaches people: installers built and signed by GitHub, put on
`downloads.factwright.com`, and picked up by the copies already installed.

## How it fits together
- **Installers.** [electron-builder](https://www.electron.build) packages the desktop app
  ([`apps/desktop/electron-builder.config.mjs`](../apps/desktop/electron-builder.config.mjs)).
  - On a Mac, one disk image that runs on Apple silicon and Intel, plus the same app as a zip,
    which is what updates download.
  - On Windows, one installer, which installs for the user without asking for an administrator.
  - The installed app keeps the name Factwright, so it opens the same data folder as before.
- **Locked down.** Electron's fuses turn off what an installed app never needs: Node's options
  from the environment, Node's debugger from the command line, and loading code from anywhere but
  the app's own checked archive. A Mac app can't start as plain Node either. A Windows one can, as
  node-pty stops a terminal there through a helper started that way.
- **Only the app.** The archive holds the built app, its package file and node-pty, without
  source maps: never the folder's sources, tests or settings. `check-package` checks it.
- **Signed.**
  - The Mac app is signed with Neatifai's Developer ID, then notarized and stapled by Apple, so
    Gatekeeper opens it.
  - The Windows installer is signed through Neatifai's Azure Artifact Signing account
    (`asa-neatifaisigning`), so SmartScreen knows who made it.
- **Published.** The installers go to the R2 bucket `factwright-downloads`, which serves
  `downloads.factwright.com`.
  - Each version's files keep their version in the name, and never change.
  - `Factwright.dmg` and `Factwright-Setup.exe` are always the newest. The website links to them.
  - `latest-mac.yml` and `latest.yml` say which version is newest, with each file's checksum.
    They're uploaded last, so nothing finds a version before its files are there.
- **Updates.** An installed copy looks at those feeds 30 seconds after it starts, then every four
  hours ([`apps/desktop/src/main/updates.ts`](../apps/desktop/src/main/updates.ts)).
  - It downloads a new version in the background, and checks it against the feed's checksum.
    On a Mac, the system then checks the developer's signature; on Windows, the updater checks
    the publisher's name.
  - The sidebar then shows **Update ready**, with the version's notes under What's new. On a
    Mac, that's once the system has checked the update and can install it.
  - Restart now installs it. Otherwise it installs the next time the user quits. While Claude is
    working, the card leaves out Restart now, as restarting would stop the run, and it asks first
    if the user is writing a fact or a note they haven't saved.
  - A problem is noted in `updates.log` in the app's data folder, and the next look tries again.
  - Only copies built by the release workflow look for updates. Each look sends the same ID for
    everyone, rather than one for each install.

## Setting it up, once
The release workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) reads
these from the repository's settings. Secrets are set with `gh secret set NAME`, which asks for
the value; nobody else ever sees them.

| Secret | What it is | From |
|---|---|---|
| `CSC_LINK` | The Developer ID Application certificate from Apple's G2 authority, as a base64 `.p12` | Certificates, Identifiers & Profiles → + → Developer ID Application → G2 Sub-CA, with a request from Keychain Access → Certificate Assistant; then exported from Keychain Access |
| `CSC_KEY_PASSWORD` | The password the `.p12` was exported with | — |
| `APPLE_API_KEY_P8` | The App Store Connect API key for notarizing: the `.p8` file's contents | App Store Connect → Users and Access → Integrations → Team Keys, with Developer access |
| `APPLE_API_KEY_ID` | That key's ID | The same page |
| `APPLE_API_ISSUER` | The team's issuer ID | The same page, above the keys |
| `AZURE_TENANT_ID` | Neatifai's Entra tenant | The app registration's overview |
| `AZURE_CLIENT_ID` | The app registration `factwright-release-signing` | The same |
| `AZURE_CLIENT_SECRET` | That registration's client secret: its value, not its ID | Certificates & secrets, 24 months |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | An R2 token with Object Read & Write on `factwright-downloads` only | Cloudflare → R2 → Manage API tokens |

| Variable | What it is |
|---|---|
| `AZURE_SIGNING_ENDPOINT` | The signing account's URI, such as `https://ncus.codesigning.azure.net/` |
| `AZURE_CERTIFICATE_PROFILE` | The Public Trust certificate profile, `neatifai`: the only one the Basic plan allows, so any Neatifai app signs with it |
| `AZURE_PUBLISHER_NAME` | The certificate's common name alone, exactly as it reads, such as `NEATIFAI LLC`: installed copies check every update against it, so a wrong one would stop their updates for good. The build stops if it's blank, and a release checks the app is signed by it |

The app registration needs the **Artifact Signing Certificate Profile Signer** role on
`asa-neatifaisigning`.

Only the Account Holder can make the Developer ID certificate. Make it on Apple's website, as the
table says, choosing G2 Sub-CA: a certificate from Apple's previous authority can't sign after
2027-02-01. To tell the two apart, open the certificate in Keychain Access: under Issuer Name, the
Organizational Unit reads `G2` for the current authority, and Apple Certification Authority for the
previous one.

The client secret expires after 24 months, the Developer ID certificate after five years, and the
Azure identity validation on 2029-01-12. Releases stop until each is renewed.

## Releasing a version
1. **Say what's new.** Write `apps/desktop/release-notes/<version>.md`: a few lines for users,
   which installed copies show under What's new. Move the changelog's Unreleased entries under a
   heading for the version.
2. **Set the version** in `apps/desktop/package.json`, and merge the change to `main`.
3. **Tag it** on `main`:
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
4. **The workflow does the rest.** First it checks:
   - the tag is on `main`
   - it names the app's version, and that version has its notes
   - it's newer than the version out now

   Then it builds, signs and notarizes on a Mac and on Windows. It checks:
   - the app's archive holds only the app
   - Gatekeeper and Windows accept the signatures, the app's own by Neatifai's name, and Apple's
     ticket is stapled to the Mac app
   - each built app starts with a stand-in Claude Code

   Only then does it upload, refusing to replace a version that's out already. A release that
   isn't signed is never published.
5. **Check it:** `https://downloads.factwright.com/latest-mac.yml` and `latest.yml` name the new
   version, and the two downloads open.

Running the workflow by hand on a branch builds and tests the installers without publishing them.
If signing is set up, they're signed, notarized and checked as a release's are: run it before a
release that changes how the installers are made, as that's the only run that tries signing and
notarizing. A pull request that changes the
workflow or the build settings runs it too, but never gets the signing keys, so its Mac build is
signed for that machine alone and its Windows build isn't signed. The installers come back as the
run's artifacts. A run by hand on a tag is a release.

## On this computer
After `pnpm --filter @factwright/desktop build`:
- `pnpm --filter @factwright/desktop dist:mac` builds the Mac app into `apps/desktop/dist`, signed
  for this computer alone. `dist:win` does the same on Windows, unsigned.
- `pnpm --filter @factwright/desktop check-package` checks the app's archive holds only the app.
- `pnpm --filter @factwright/desktop e2e:packaged` starts the built app with a stand-in Claude
  Code and checks it opens, reaches Claude Code with its own plugin, and reads the workspace.

These builds are for trying out only: macOS and Windows warn about apps that aren't signed, and
they have no update settings, so they never update themselves.

## If a release goes wrong
An installed copy only moves forward, so a bad version is fixed by releasing the next one. To stop
a bad version spreading first, put the previous version's files back where the newest go. Each
release keeps its update feeds under `feeds/<version>/`:

```bash
aws s3 cp s3://factwright-downloads/feeds/0.1.0/latest-mac.yml s3://factwright-downloads/latest-mac.yml --endpoint-url https://c4df27faf7b8fc65b74097415e723d3e.r2.cloudflarestorage.com --cache-control no-cache --content-type text/yaml
```

Do the same for `latest.yml`, and copy `Factwright-0.1.0.dmg` and `Factwright-Setup-0.1.0.exe`
over `Factwright.dmg` and `Factwright-Setup.exe` with `--cache-control no-cache`. Copies that
haven't updated yet stay where they are.

## The website
The site links to `Factwright.dmg` and `Factwright-Setup.exe`, which don't exist until the first
release. Publish 0.1.0 before the site goes online.
