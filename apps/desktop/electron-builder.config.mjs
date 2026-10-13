// How the app becomes installers: `pnpm dist:mac` or `pnpm dist:win`, after `pnpm build`.
// Signing and notarizing happen only when their credentials are in the environment, as in the
// release workflow. Without them, a Mac build is signed only for this computer, and a Windows
// build isn't signed: both are for trying out, never for sending to anyone.

import { existsSync, readFileSync } from 'node:fs';

const env = process.env;

/** The version being built, and what's new in it, which installed copies show as they update. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const notes = `release-notes/${version}.md`;

/** Whether the Mac build has a Developer ID certificate to sign with. */
const macCertificate = Boolean(env.CSC_LINK || env.CSC_NAME);

/** Windows signing, through Neatifai's Azure Artifact Signing account. */
const azureSigning = env.AZURE_CLIENT_ID
  ? {
      publisherName: env.AZURE_PUBLISHER_NAME,
      endpoint: env.AZURE_SIGNING_ENDPOINT,
      codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
      certificateProfileName: env.AZURE_CERTIFICATE_PROFILE,
    }
  : undefined;

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'com.factwright.app',
  // The same name as the app has while it's being developed, so an installed copy opens the same
  // data folder, and with it the user's job hunt.
  productName: 'Factwright',
  copyright: 'Copyright © 2026 Neatifai LLC',
  directories: { output: 'dist', buildResources: 'build' },
  files: [
    'out/**',
    'package.json',
    // node-pty runs from its prebuilt files: its sources, build scripts and debug symbols stay out.
    '!**/node_modules/node-pty/{src,deps,third_party,scripts,typings}/**',
    '!**/node_modules/node-pty/binding.gyp',
    '!**/*.pdb',
  ],
  // Factwright's Claude Code plugin, which the app hands each run.
  extraResources: [{ from: '../../plugin', to: 'plugin' }],
  // A native module and the helper it starts have to be real files, not inside the archive.
  asarUnpack: ['**/node_modules/node-pty/**'],
  // Locks the installed app down: it can't be started as plain Node, take Node's options from
  // the environment or a debugger flag, or load code from anywhere but its own checked archive.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  mac: {
    // One app for every Mac, Apple silicon and Intel. The zip is what updates download.
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
    category: 'public.app-category.productivity',
    icon: 'build/icon.png',
    // Apple notarizes only apps with the hardened runtime, which a build signed for this computer
    // alone can't run with.
    hardenedRuntime: macCertificate,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // node-pty ships the same files for both kinds of Mac, which the universal app keeps as they are.
    x64ArchFiles: '**/node_modules/node-pty/prebuilds/**',
    files: ['!**/node_modules/node-pty/prebuilds/win32-*/**'],
    // "-" signs for this computer alone, when there's no Developer ID certificate.
    ...(macCertificate ? {} : { identity: '-' }),
    notarize: Boolean(macCertificate && env.APPLE_API_KEY),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in its own ${version} and ${ext}.
    artifactName: 'Factwright-${version}-mac.${ext}',
  },
  // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder fills in its own ${version} and ${ext}.
  dmg: { artifactName: 'Factwright-${version}.${ext}' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon-win.png',
    files: ['!**/node_modules/node-pty/prebuilds/darwin-*/**'],
    ...(azureSigning ? { azureSignOptions: azureSigning } : {}),
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
  publish: [{ provider: 'generic', url: 'https://downloads.factwright.com/' }],
  ...(existsSync(new URL(notes, import.meta.url))
    ? { releaseInfo: { releaseNotesFile: notes } }
    : {}),
};
