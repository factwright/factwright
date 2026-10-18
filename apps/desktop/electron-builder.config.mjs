// How the app becomes installers: `pnpm dist:mac` or `pnpm dist:win`, after `pnpm build`.
// Signing and notarizing happen only when their credentials are in the environment, as in the
// release workflow. Without them, a Mac build is signed only for this computer, and a Windows
// build isn't signed: both are for trying out, never for sending to anyone. Only Factwright's
// own releases look for updates, as `publish` below says.

import { existsSync, readFileSync } from 'node:fs';

const env = process.env;

// The release workflow passes each signing key, empty where there's none, as on a pull request,
// which never gets them. electron-builder would take an empty one for a key to use, such as a
// certificate at no path at all, so empty ones are cleared.
for (const name of [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
]) {
  if (env[name] === '') delete env[name];
}

/** The version being built, and what's new in it, which installed copies show as they update. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const notes = `release-notes/${version}.md`;

/**
 * Where the Mac disk image's window puts the app and the Applications folder.
 * scripts/installer-art.ts draws the window's background, build/background.png, to match.
 */
const diskImage = JSON.parse(
  readFileSync(new URL('./build/disk-image.json', import.meta.url), 'utf8'),
);

/** Each run builds for one kind of computer, as the dist scripts say. */
const windows = process.argv.includes('--win');

/**
 * The helper the browsers start for Save to Factwright, so it can save to the app on this
 * computer. It's in helper/out once scripts/build-helper.ts has built it, as `pnpm dist:mac` and
 * `dist:win` do first. Without it, electron-builder would build the app anyway, with only a
 * warning, and the extension could never reach that app: the build stops instead.
 */
const helpers = { mac: 'helper/out/factwright-save', win: 'helper/out/factwright-save.exe' };
const helper = windows ? helpers.win : helpers.mac;
if (!existsSync(new URL(helper, import.meta.url))) {
  throw new Error(
    `No helper at apps/desktop/${helper}: build it with pnpm --filter @factwright/desktop helper.`,
  );
}

/** Whether the Mac build has a Developer ID certificate to sign with. */
const macCertificate = Boolean(env.CSC_LINK || env.CSC_NAME);

/**
 * Windows signing, through Neatifai's Azure Artifact Signing account. Installed copies take an
 * update only if it's signed by the publisher named here, so a blank or wrong name would stop
 * every update for good: the build stops instead.
 */
function azureSigning() {
  if (!env.AZURE_CLIENT_ID) return undefined;
  const options = {
    publisherName: env.AZURE_PUBLISHER_NAME?.trim(),
    endpoint: env.AZURE_SIGNING_ENDPOINT?.trim(),
    codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT?.trim(),
    certificateProfileName: env.AZURE_CERTIFICATE_PROFILE?.trim(),
  };
  const missing = Object.entries(options).filter(([, value]) => !value);
  if (missing.length > 0) {
    throw new Error(`Windows signing needs ${missing.map(([key]) => key).join(', ')}.`);
  }
  return options;
}

const azure = windows ? azureSigning() : undefined;

/**
 * What goes in the app's archive: the built app, and node-pty's files for this kind of computer.
 * Each list is whole, as a list of only exclusions would let in everything else in the folder.
 */
function filesFor(/** @type {string[]} */ otherPrebuilds) {
  return [
    'out/**',
    // Source maps would carry the app's source.
    '!out/**/*.map',
    'package.json',
    // node-pty runs from its built files: its sources, tests, build scripts, source maps and
    // debug symbols stay out.
    '!**/node_modules/node-pty/{src,deps,third_party,scripts,typings}/**',
    '!**/node_modules/node-pty/binding.gyp',
    '!**/node_modules/node-pty/lib/**/*.test.js',
    '!**/node_modules/**/*.map',
    '!**/*.pdb',
    ...otherPrebuilds.map((prebuild) => `!**/node_modules/node-pty/prebuilds/${prebuild}/**`),
  ];
}

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'com.factwright.app',
  // The same name as the app has while it's being developed, so an installed copy opens the same
  // data folder, and with it the user's job hunt.
  productName: 'Factwright',
  // The name Windows installs it under, and its updates download to, in place of the package's.
  extraMetadata: { name: 'factwright' },
  copyright: 'Copyright © 2026 Neatifai LLC',
  directories: { output: 'dist', buildResources: 'build' },
  // Factwright's Claude Code plugin, which the app hands each run.
  extraResources: [{ from: '../../plugin', to: 'plugin' }],
  // A native module and the helper it starts have to be real files, not inside the archive.
  asarUnpack: ['**/node_modules/node-pty/**'],
  // Locks the installed app down: it can't take Node's options from the environment or a
  // debugger flag, or load code from anywhere but its own checked archive, and only a Mac app is
  // kept from starting as plain Node. On Windows, node-pty stops a terminal through a helper
  // that runs the app as Node, so turning that off there would open a second copy instead.
  electronFuses: {
    runAsNode: windows,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  mac: {
    // One app for every Mac, Apple silicon and Intel. The zip is what updates download.
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
    category: 'public.app-category.productivity',
    icon: 'build/icon.png',
    files: filesFor(['win32-*']),
    // Apple notarizes only apps with the hardened runtime, which a build signed for this computer
    // alone can't run with.
    hardenedRuntime: macCertificate,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // node-pty's prebuilt files are the same in both halves of the universal app, kept as they are.
    x64ArchFiles: '**/node_modules/node-pty/prebuilds/**',
    // The helper goes in Contents/Resources/helper, and is signed with the app, every program in
    // it being signed. Signing goes deepest first, so it's signed before the app's own program,
    // which won't be signed beside a program that isn't yet, as one in Contents/MacOS would be.
    // node-pty's own helper is under Contents/Resources too. It's built for both kinds of Mac in
    // one file, which the universal app keeps as it is.
    extraFiles: [{ from: helpers.mac, to: 'Resources/helper/factwright-save' }],
    // "-" signs for this computer alone, when there's no Developer ID certificate.
    ...(macCertificate ? {} : { identity: '-' }),
    notarize: Boolean(macCertificate && env.APPLE_API_KEY),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in its own ${version} and ${ext}.
    artifactName: 'Factwright-${version}-mac.${ext}',
  },
  // The disk image opens on a window to drag the app onto Applications. The window takes the
  // size of the picture behind it, which build/background.png and @2x hold.
  dmg: {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in its own ${version} and ${ext}.
    artifactName: 'Factwright-${version}.${ext}',
    iconSize: diskImage.iconSize,
    contents: [
      { ...diskImage.app, type: 'file' },
      { ...diskImage.applications, type: 'link', path: '/Applications' },
    ],
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon-win.png',
    files: filesFor(['darwin-*', 'win32-arm64']),
    // Windows checks each module a program loads, so node-pty's are signed as well as the app.
    signExts: ['.node', '.dll'],
    // The helper goes beside Factwright.exe, and is signed with it, as is every program there.
    extraFiles: [{ from: helpers.win, to: 'factwright-save.exe' }],
    ...(azure ? { azureSignOptions: azure } : {}),
  },
  nsis: {
    // Installs for this user, without asking for an administrator, as updates need.
    oneClick: true,
    perMachine: false,
    // The job hunt is the user's: uninstalling leaves it, as a reinstall picks it up again.
    deleteAppDataOnUninstall: false,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in its own ${version} and ${ext}.
    artifactName: 'Factwright-Setup-${version}.${ext}',
  },
  // Where installed copies look for updates, and where the release workflow puts each version.
  // Only Factwright's own releases are built with it, as release.yml sets FACTWRIGHT_DOWNLOADS_URL
  // for them alone: a copy built anywhere else, such as from a fork or on this computer, never
  // updates itself. Updates download a range at a time, as Cloudflare's storage doesn't send
  // several in one answer.
  publish: env.FACTWRIGHT_DOWNLOADS_URL
    ? [
        {
          provider: 'generic',
          url: env.FACTWRIGHT_DOWNLOADS_URL,
          useMultipleRangeRequest: false,
        },
      ]
    : null,
  ...(existsSync(new URL(notes, import.meta.url))
    ? { releaseInfo: { releaseNotesFile: notes } }
    : {}),
};
