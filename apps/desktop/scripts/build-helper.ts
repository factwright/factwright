// Builds factwright-save, the small helper the browser extension saves through on this computer
// (helper/README.md says what it does), from helper/factwright-save.c, for the computer it runs on:
// on a Mac, one program for both Apple silicon and Intel, as the app is, on Windows one for x64,
// and on Linux one for the tests alone. It compiles in the app's version, from package.json. The
// installers carry helper/out/factwright-save (.exe on Windows), which `pnpm dist:mac` and
// `dist:win` build first. With --testing, the helper takes its data folder from
// FACTWRIGHT_HELPER_HOME, as the tests give it, so that build must go elsewhere, with --out, where
// the installers never look.
// node scripts/build-helper.ts [--testing] [--out <file>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DESKTOP = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(DESKTOP, 'helper', 'factwright-save.c');

/** Where the installers take the helper from. */
const BUILT = join(DESKTOP, 'helper', 'out');

/** What to install for a C compiler, on each kind of computer. */
const INSTALL: Readonly<Record<string, string>> = {
  darwin: "install Xcode's command line tools (xcode-select --install)",
  win32:
    'install LLVM (winget install LLVM.LLVM) and open a new terminal, or run this in a Visual Studio developer prompt',
  linux: 'install one, such as build-essential on Ubuntu (sudo apt install build-essential)',
};

const windows = process.platform === 'win32';
const { values } = parseArgs({
  options: { testing: { type: 'boolean', default: false }, out: { type: 'string' } },
});
const out = resolve(values.out ?? join(BUILT, windows ? 'factwright-save.exe' : 'factwright-save'));

/** Whether a file is somewhere in a folder. */
function isInside(folder: string, file: string): boolean {
  const path = relative(folder, file);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

if (values.testing && (values.out === undefined || isInside(BUILT, out))) {
  console.error(
    'A build for the tests goes elsewhere: pass --out with a file outside helper/out, so the installers never carry it.',
  );
  process.exit(1);
}

// The helper gives its version as it is, in a string of C and of JSON, so it's checked first.
const { version } = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as {
  version: string;
};
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`The app's version, ${version}, isn't one the helper can give.`);
  process.exit(1);
}

/** Whether a program is on PATH. */
function onPath(program: string): boolean {
  const name = windows ? `${program}.exe` : program;
  return (process.env.PATH ?? '')
    .split(delimiter)
    .some((folder) => folder !== '' && existsSync(join(folder, name)));
}

const defines = [
  `-DFACTWRIGHT_VERSION="${version}"`,
  ...(values.testing ? ['-DFACTWRIGHT_TESTING'] : []),
];

/** Every warning is an error: the helper is small enough to keep clear of them all. */
const STRICT = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror'];

/** The compiler for this computer, and what it's given, or null when there's none. */
function compiler(): { program: string; args: string[] } | null {
  if (process.platform === 'darwin') {
    // One program for both kinds of Mac, for the oldest macOS the app runs on.
    if (!onPath('clang')) return null;
    const macs = ['-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=12.0'];
    return { program: 'clang', args: [...STRICT, ...macs, ...defines, '-o', out, SOURCE] };
  }
  if (windows) {
    // shell32 finds the user's application data, and ole32 frees the path it gives. Clang uses
    // the C runtime built into the program, so the helper needs no Visual C++ runtime installed,
    // and with -static, MinGW's gcc needs none of its own libraries beside it either.
    const libraries = ['-lshell32', '-lole32'];
    if (onPath('clang')) {
      return { program: 'clang', args: [...STRICT, ...defines, '-o', out, SOURCE, ...libraries] };
    }
    if (onPath('gcc')) {
      const args = [...STRICT, '-static', ...defines, '-o', out, SOURCE, ...libraries];
      return { program: 'gcc', args };
    }
    // Visual Studio's own, in its developer prompt. GitHub's runners build with clang.
    if (onPath('cl')) {
      const args = [
        '/nologo',
        '/std:c11',
        '/O2',
        '/W4',
        ...defines.map((define) => define.replace(/^-/, '/')),
        `/Fe${out}`,
        `/Fo${out}.obj`,
        SOURCE,
        'shell32.lib',
        'ole32.lib',
      ];
      return { program: 'cl', args };
    }
    return null;
  }
  return onPath('cc') ? { program: 'cc', args: [...STRICT, ...defines, '-o', out, SOURCE] } : null;
}

const build = compiler();
if (!build) {
  console.error(
    `There's no C compiler to build the helper with: ${INSTALL[process.platform] ?? INSTALL.linux}.`,
  );
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
try {
  execFileSync(build.program, build.args, { stdio: 'inherit' });
} catch {
  console.error(`${build.program} couldn't build the helper: what it said is above.`);
  process.exit(1);
}
console.log(
  `Built ${relative(process.cwd(), out)}, the helper for Factwright ${version}${values.testing ? ', for the tests' : ''}.`,
);
