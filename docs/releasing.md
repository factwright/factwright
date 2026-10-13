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
- **Locked down.** Electron's fuses turn off what an installed app never needs: starting as
  plain Node, Node's options from the environment, a debugger from the command line, and loading
  code from anywhere but the app's own checked archive.
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
  - It downloads a new version in the background, and checks it against the feed's checksum and
    the signature before installing.
  - The sidebar then shows **Update ready**, with the version's notes under What's new.
  - Restart now installs it. Otherwise it installs the next time the user quits. While Claude is
    working, the card leaves out Restart now, as restarting would stop the run.

## Setting it up, once
The release workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) reads
these from the repository's settings. Secrets are set with `gh secret set NAME`, which asks for
the value; nobody else ever sees them.

| Secret | What it is | From |
|---|---|---|
| `CSC_LINK` | The Developer ID Application certificate, as a base64 `.p12` | Xcode → Settings → Accounts → Manage Certificates, then exported from Keychain Access |
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
| `AZURE_CERTIFICATE_PROFILE` | The Public Trust certificate profile, `factwright` |
| `AZURE_PUBLISHER_NAME` | The certificate's subject name, exactly as it reads, which installed copies check updates against |

The app registration needs the **Artifact Signing Certificate Profile Signer** role on
`asa-neatifaisigning`. The client secret expires after 24 months, and the Azure identity
validation on 2029-01-12. Releases stop until each is renewed.

## Releasing a version
1. **Say what's new.** Write `apps/desktop/release-notes/<version>.md`: a few lines for users,
   which installed copies show under What's new. Move the changelog's Unreleased entries under a
   heading for the version.
2. **Set the version** in `apps/desktop/package.json`, and merge the change to `main`.
3. **Tag it** on `main`:
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
4. **The workflow does the rest:** it checks the tag matches the version and has notes, then
   builds, signs and notarizes on a Mac and on Windows. It checks Gatekeeper and Windows accept
   the signatures, and starts each installed app with a stand-in Claude Code. Only then does it
   upload. A release that isn't signed is never published.
5. **Check it:** `https://downloads.factwright.com/latest-mac.yml` and `latest.yml` name the new
   version, and the two downloads open.

Running the workflow by hand, or a pull request that changes it or the build settings, builds and
tests the installers without publishing them. They're unsigned if signing isn't set up. They come
back as the run's artifacts, to try.

## On this computer
After `pnpm --filter @factwright/desktop build`:
- `pnpm --filter @factwright/desktop dist:mac` builds the Mac app into `apps/desktop/dist`, signed
  for this computer alone. `dist:win` does the same on Windows, unsigned.
- `pnpm --filter @factwright/desktop e2e:packaged` starts the built app with a stand-in Claude
  Code and checks it opens, reaches Claude Code through its own plugin, and reads the workspace.

These builds are for trying out only: macOS and Windows warn about apps that aren't signed, and
they never update themselves.

## If a release goes wrong
An installed copy only moves forward, so a bad version is fixed by releasing the next one. To stop
a bad version spreading first, upload the previous version's `latest-mac.yml` and `latest.yml`
again: copies that haven't updated yet stay where they are.
