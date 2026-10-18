# Releasing

How a version of Factwright reaches people: installers built and signed by GitHub, put on
`downloads.factwright.com`, picked up by the copies already installed, and listed on the
repository's Releases page.

## How it fits together
- **Installers.** [electron-builder](https://www.electron.build) packages the desktop app
  ([`apps/desktop/electron-builder.config.mjs`](../apps/desktop/electron-builder.config.mjs)).
  - On a Mac, one disk image that runs on Apple silicon and Intel, plus the same app as a zip,
    which is what updates download.
  - On Windows, one installer, which installs for the user without asking for an administrator.
  - The installed app keeps the name Factwright, so it opens the same data folder as before.
  - Each opens on a window in Factwright's colors. The disk image's background is
    `build/background.png`, around where `build/disk-image.json` puts its icons. On Windows,
    `build/installer.nsh` redraws electron-builder's install banner with a header picture for
    each display scaling, which `pnpm dist:win` draws first. Both pictures come from
    `scripts/installer-art.ts`, and updates install silently, without a window.
- **Locked down.** Electron's fuses turn off what an installed app never needs: Node's options
  from the environment, Node's debugger from the command line, and loading code from anywhere but
  the app's own checked archive. A Mac app can't start as plain Node either. A Windows one can, as
  node-pty stops a terminal there through a helper started that way.
- **Only the app.** The archive holds the built app, its package file and node-pty, without
  source maps: never the folder's sources, tests or settings. `check-package` checks it.
- **The helper.** Save to Factwright saves to the app on the same computer through
  `factwright-save`, a small program the browsers start, which `pnpm dist:mac` and `dist:win`
  build from `apps/desktop/helper` first. The installers put it in
  `Factwright.app/Contents/Resources/helper` on a Mac, one file for Apple silicon and Intel, and
  beside `Factwright.exe` on Windows. It's signed with the app, so the Gatekeeper and Windows signature
  checks below cover it. `check-package` checks it's there, on a Mac for both kinds, and each
  built app's tests check it answers with the app's version. The app registers it with the
  browsers as it starts on Windows, and on a Mac when the user sets each browser up in its Save to
  Factwright window; uninstalling on Windows takes that away again.
- **Signed.**
  - The Mac app is signed with Neatifai's Developer ID, then notarized and stapled by Apple, so
    Gatekeeper opens it.
  - The Windows installer is signed through Neatifai's Azure Artifact Signing account
    (`asa-neatifaisigning`), so SmartScreen knows who made it.
- **Published.** The installers go to the R2 bucket `factwright-downloads`, which serves
  `downloads.factwright.com`.
  - Each version's files keep their version in the name, and never change. Each goes up with its
    sha256, so a publish that stopped partway can be finished: running it again leaves the files
    that are up as they are, and puts up the rest.
  - `Factwright.dmg` and `Factwright-Setup.exe` are always the newest. The website sends a
    download to them when it can't tell the newest version.
  - `latest-mac.yml` and `latest.yml` say which version is newest, with each file's checksum.
    They're uploaded last, so nothing finds a version before its files are there.
- **On GitHub.** Once both computers' installers are out, the version gets a release on the
  repository's Releases page: its notes from `apps/desktop/release-notes`, links to its own
  installers on downloads.factwright.com, where updates look, and, while the repository is public,
  how to check one.
- **Where each installer came from.** While the repository is public, each installer gets an
  attestation before it goes out: a record, signed through Sigstore and kept by GitHub, of the
  commit, tag and workflow run that built it. Anyone with the GitHub CLI, signed in to any GitHub
  account, can check a download against it:
  ```bash
  gh attestation verify Factwright-0.1.2.dmg -R factwright/factwright \
    --signer-workflow factwright/factwright/.github/workflows/release.yml --source-ref refs/tags/v0.1.2
  ```
  `--signer-workflow` makes it fail for a record that any other workflow in the repository made,
  and `--source-ref` for one from another version. GitHub's free plan makes attestations for public
  repositories only, so versions released while the repository was private have none.
- **Only Factwright's own.** The workflow builds with `FACTWRIGHT_SYNC_SERVER`
  (https://app.factwright.com) and `FACTWRIGHT_DOWNLOADS_URL` (https://downloads.factwright.com/)
  only when it runs in factwright/factwright, outside pull requests: for a release, or by hand on a
  branch. Builds anywhere else, a fork's or a pull request's included, have no Factwright's sync,
  only a server of your own, and never look for updates. A release stops before it builds unless both are set and answer as
  Factwright's, as one without them, or with either wrong, would leave everyone who installs it
  unable to sync, and stuck on it for good. Each built app's tests then check it can turn sync on,
  and that its update settings name the download site, only if it was built with them.
- **The sync server, for people who run their own.** Within six hours of a version's release
  on GitHub, [github.com/factwright/sync-server](https://github.com/factwright/sync-server) has its
  sync server, ready to deploy with Cloudflare's Deploy button.
  - sync-server's own Publish workflow builds it from that version's source with
    `pnpm --filter @factwright/server copy`: the Worker as Wrangler bundled it, the web view, the
    migrations, and settings for a workers.dev address with none of Factwright's own. It commits it
    with the version as a tag.
  - It needs no keys, as the source is public and it writes only to its own repository.
  - GitHub pauses its schedule after 60 days with no activity there. Running it by hand from its
    Actions tab starts it again.
  - Here, [`sync-server.yml`](../.github/workflows/sync-server.yml) checks that each change to the
    server still makes a copy that Wrangler takes.
  - Factwright's own server isn't deployed by any of this. That's still
    `pnpm --filter @factwright/server run deploy`, by hand.
- **Updates.** An installed copy looks at those feeds 30 seconds after it starts, then every ten
  minutes, and straight away when the user comes back to it or the computer wakes, at most once a
  minute ([`apps/desktop/src/main/updates.ts`](../apps/desktop/src/main/updates.ts)). So a new
  version reaches a running copy within minutes of its release.
  - It downloads a new version in the background, and checks it against the feed's checksum.
    On a Mac, the system then checks the developer's signature; on Windows, the updater checks
    the publisher's name.
  - The sidebar then shows **Update ready**, with the version's notes under What's new. On a
    Mac, that's once the system has checked the update and can install it.
  - Restart now installs it. Otherwise it installs the next time the user quits. While Claude is
    working, the card leaves out Restart now, as restarting would stop the run, and it asks first
    if the user is writing a fact or a note they haven't saved.
  - A problem is noted in `updates.log` in the app's data folder, and the next look tries again.
  - Only Factwright's own builds look for updates, as above. Each look sends the same ID for
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

The release on GitHub and the installers' attestations use the run's own token, so they need
nothing set up.

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
   - it's newer than the version out now, for the Mac and for Windows
   - it's built with Factwright's sync server and download site, and both answer

   Then it builds, signs and notarizes on a Mac and on Windows. It checks:
   - the app's archive holds only the app, and the helper is beside it
   - Gatekeeper and Windows accept the signatures, the app's own by Neatifai's name
   - the Mac app's certificate is from Apple's G2 authority, and Apple's ticket is stapled to it
   - each built app starts with a stand-in Claude Code, can turn sync on, and looks for updates
     at the download site, and its helper answers

   Only then does it upload, refusing to replace a version that's out already, and first records
   where each installer came from if the repository is public. A release that isn't signed is
   never published. Each computer's installers go out as soon as its own build passes, so Windows
   never waits on Apple, and for a while the two can be on different versions. Once both are out,
   the version's release appears on GitHub.

   Apple usually notarizes in minutes, but can hold an app for hours, especially the first time.
   The Mac job gives up after an hour, so a slow Apple can't use up the month's free GitHub minutes
   (Mac minutes count ten times). Apple carries on checking. Once it's done (`xcrun notarytool
   history` says Accepted), choose **Re-run failed jobs** on the run, and the Mac installers go out,
   unless a newer version has gone out since: an older version never replaces a newer one.
5. **Check it:** `https://downloads.factwright.com/latest-mac.yml` and `latest.yml` name the new
   version, the two downloads open, and the release is on the repository's Releases page.

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
  for this computer alone. `dist:win` does the same on Windows, unsigned. Each builds the helper
  first, which takes a C compiler: Xcode's command line tools on a Mac, and on Windows clang,
  MinGW, or Visual Studio's from its developer prompt.
- `pnpm --filter @factwright/desktop check-package` checks the app's archive holds only the app,
  and the helper is beside it.
- `pnpm --filter @factwright/desktop e2e:packaged` starts the built app with a stand-in Claude
  Code and checks it opens, reaches Claude Code with its own plugin, and reads the workspace, and
  that its helper answers.

These builds are for trying out only: macOS and Windows warn about apps that aren't signed, and
they have no sync server or update settings, so they sync only through a server of your own, and
never update themselves.
`build` reads `FACTWRIGHT_SYNC_SERVER` and `dist:mac` or `dist:win` reads `FACTWRIGHT_DOWNLOADS_URL`,
as the release workflow sets them for Factwright's own builds.

## If a release goes wrong
**If publishing stops partway,** such as an upload failing, choose **Re-run failed jobs** on the
run. It leaves the files already up, uploads the rest, and puts the update feed up last. It
refuses if a file that's up has other contents, as after **Re-run all jobs**, which builds new
files: then release the next version. Publishing reads the update feed from R2 before it uploads
anything, and stops if it can't tell what's out.

**To take a bad version back:** an installed copy only moves forward, so a bad version is fixed by
releasing the next one. To stop it spreading first, put the previous version's files back where the
newest go, mark the bad one as taken back, so that neither publishing nor its release on GitHub can
ever put it out again, and take its release off GitHub.

If the bad version's release run is still going, cancel it first. You need the AWS CLI, an R2 API
token with Object Read & Write on `factwright-downloads` (Cloudflare → R2 → Manage API tokens) as
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION=auto`, and the CLI's classic
transfer client, as its newer one can fail R2's signature checks:
`aws configure set default.s3.preferred_transfer_client classic`.

Each release keeps its update feeds under `feeds/<version>/`. To take 0.1.1 back to 0.1.0:

```bash
(
  set -euo pipefail
  endpoint=https://c4df27faf7b8fc65b74097415e723d3e.r2.cloudflarestorage.com
  echo "taken back" | aws s3 cp - s3://factwright-downloads/feeds/0.1.1/withdrawn --endpoint-url "$endpoint"
  for feed in latest-mac.yml latest.yml; do
    aws s3 cp "s3://factwright-downloads/feeds/0.1.0/$feed" "s3://factwright-downloads/$feed" \
      --endpoint-url "$endpoint" --metadata-directive REPLACE --cache-control no-cache --content-type text/yaml
  done
  work=$(mktemp -d)
  for pair in Factwright-0.1.0.dmg:Factwright.dmg Factwright-Setup-0.1.0.exe:Factwright-Setup.exe; do
    aws s3 cp "s3://factwright-downloads/${pair%%:*}" "$work/${pair##*:}" --endpoint-url "$endpoint"
    aws s3 cp "$work/${pair##*:}" "s3://factwright-downloads/${pair##*:}" --endpoint-url "$endpoint" --cache-control no-cache
  done
  if gh release view v0.1.1 --repo factwright/factwright > /dev/null 2>&1; then
    gh release delete v0.1.1 --repo factwright/factwright --yes
  fi
  gh release edit v0.1.0 --repo factwright/factwright --latest
)
```

It stops at the first step that fails, and can be run again. The feeds are copied with
`--metadata-directive REPLACE`, which sets their headers without the tag handling R2 doesn't
support. The installers are downloaded and uploaded again for the same reason, as a large copy
within R2 asks for the source's tags. Copies that haven't updated yet stay where they are.

## The website
The download pages, `factwright.com/download/mac` and `/download/windows`, offer the newest
version. The site's Worker reads it from `latest-mac.yml` and `latest.yml`, kept for a minute, so
the pages are current within a minute of a release. Their links go to `/download/get/mac` and
`/download/get/windows`, where the Worker counts the download and sends it on to that version's own
installer. `/download` goes on to the page for the visitor's computer, and the home page's buttons
go to them.

Without a feed, the Worker sends a download to `Factwright.dmg` or `Factwright-Setup.exe`, which
don't exist until the first release. Publish 0.1.0 before the site goes online.
