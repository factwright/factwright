import { type Script, startScript } from './job-site-script.ts';

/**
 * The extension's script on the job sites you allowed, as the browser runs it on each of their
 * pages (src/job-site-script.ts). A newer copy of the extension, as after an update, takes over
 * from the one that ran before on the page.
 */

const RUNNING = Symbol.for('factwright job site script');
const own = globalThis as { [RUNNING]?: Script };
own[RUNNING]?.stop();
own[RUNNING] = startScript();
