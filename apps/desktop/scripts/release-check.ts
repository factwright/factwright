// Checks a release before its installers are built: the tag names the app's version, and that
// version has its notes, which installed copies show under "What's new".
// node scripts/release-check.ts v0.1.0
import { existsSync, readFileSync } from 'node:fs';

const tag = process.argv[2] ?? '';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const notes = new URL(`../release-notes/${version}.md`, import.meta.url);

if (tag !== `v${version}`) {
  console.error(`The tag ${tag} doesn't match the app's version, ${version}: change one of them.`);
  process.exit(1);
}
if (!existsSync(notes) || !readFileSync(notes, 'utf8').trim()) {
  console.error(`Say what's new in apps/desktop/release-notes/${version}.md first.`);
  process.exit(1);
}
console.log(`Releasing Factwright ${version}.`);
