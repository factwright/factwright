// Checks a release before its installers are built: the tag names the app's version, and that
// version has its notes, which installed copies show under "What's new", and its short notes,
// which the app shows on its first open after the update.
// node scripts/release-check.ts v0.1.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { notesProblem } from './release-notes.ts';

const tag = process.argv[2] ?? '';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

if (tag !== `v${version}`) {
  console.error(`The tag ${tag} doesn't match the app's version, ${version}: change one of them.`);
  process.exit(1);
}
const problem = notesProblem(version, fileURLToPath(new URL('../release-notes', import.meta.url)));
if (problem) {
  console.error(problem);
  process.exit(1);
}
console.log(`Releasing Factwright ${version}.`);
