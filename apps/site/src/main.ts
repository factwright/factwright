import 'virtual:theme.css';
import './styles/index.css';
import { downloadPage, offerDownloads, platform, startDownload } from './downloads.ts';
import { ownServerGuide, thisBrowser } from './own-server.ts';

/**
 * The page reads fine without this script. It adds the motion: the app drawing plays a run, the
 * fact bank answers the line you pick, and each part eases in as it scrolls into view. On the
 * download pages, it starts the download, and the page that picks goes on to this computer's. On
 * the guide to running your own sync server, it fills in your addresses and copies them.
 */

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Calls `start` once, when the element is far enough into view. */
function whenSeen(element: Element, start: () => void, threshold = 0.35): void {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      start();
    },
    { threshold },
  );
  observer.observe(element);
}

/** The header gets its line once the page scrolls under it. */
function header(): void {
  const bar = document.querySelector('[data-header]');
  if (!bar) return;
  const update = () => bar.classList.toggle('is-scrolled', window.scrollY > 4);
  update();
  window.addEventListener('scroll', update, { passive: true });
}

type RunPhase = 'working' | 'need' | 'done';

const PHASES: Readonly<Record<RunPhase, { label: string; hint: string }>> = {
  working: { label: 'Working', hint: 'Keep working. You’ll hear when Claude needs you.' },
  need: {
    label: 'Needs your answer',
    hint: 'Claude has a question. Answer it in the panel below.',
  },
  done: { label: 'Done', hint: 'Claude is done. Type to keep going, or close the panel.' },
};

/** Claude Code's spinner, as it turns while Claude works. */
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

/**
 * The app drawing at the top: Call prep runs for the job's next call in Claude's panel, asks one
 * question, and the prep sheet lands on the call. Its buttons change the way the app's do, what
 * would start Claude waits while it works, and what the job needs next moves on once it's done.
 * With reduced motion, it shows the finished run.
 */
function heroRun(root: HTMLElement): void {
  const find = (selector: string) => root.querySelector<HTMLElement>(selector);
  const claude = find('[data-demo-claude]');
  const status = find('[data-demo-status]');
  const statusLabel = find('[data-demo-status-label]');
  const title = find('[data-demo-title]');
  const hint = find('[data-demo-hint]');
  const toggle = find('[data-demo-toggle]');
  const run = find('[data-demo-run]');
  const runState = find('[data-demo-run-state]');
  const calls = find('[data-demo-calls]');
  const call = find('[data-demo-call]');
  const sections = find('[data-demo-scroll]');
  if (!claude || !status || !statusLabel || !title || !hint || !toggle || !run || !runState) return;
  const lines = [...root.querySelectorAll<HTMLElement>('[data-at]')];
  const spinners = [...root.querySelectorAll<HTMLElement>('.t-spin')];
  const waiting = [...root.querySelectorAll<HTMLElement>('[data-demo-wait]')];
  const made = [...root.querySelectorAll<HTMLElement>('[data-demo-doc]')];
  const after = [...root.querySelectorAll<HTMLElement>('[data-demo-then]')];
  const term = claude.querySelector<HTMLElement>('.term');

  const show = (stage: number) => {
    for (const line of lines) {
      const from = Number(line.dataset.at);
      const until = line.dataset.until ? Number(line.dataset.until) : Number.POSITIVE_INFINITY;
      line.hidden = stage < from || stage >= until;
    }
    // Like a real terminal, it keeps the newest lines in view.
    if (term) term.scrollTop = term.scrollHeight;
  };
  const phase = (next: RunPhase) => {
    status.classList.remove('is-working', 'is-need', 'is-done');
    status.classList.add(`is-${next}`);
    statusLabel.textContent = PHASES[next].label;
    hint.textContent = PHASES[next].hint;
  };
  // The job's sections scroll to a part of them, with a little room above it, the way you would.
  const scrollSections = (part: HTMLElement | null, room: number, smooth = !still) => {
    if (!sections || !part) return;
    const top = part.getBoundingClientRect().top - sections.getBoundingClientRect().top;
    sections.scrollTo({
      top: Math.max(0, sections.scrollTop + top - room),
      behavior: smooth ? 'smooth' : 'auto',
    });
  };
  // Until the run starts, the sections show the job's calls, once laid out and whenever their
  // size changes, such as when a tablet turns.
  const settle = new ResizeObserver(() => scrollSections(calls, 0, false));
  if (sections) settle.observe(sections);
  const open = () => {
    claude.classList.add('is-open');
    toggle.textContent = 'Hide';
    title.textContent = 'Call prep · Lumen Health';
  };
  // While Claude works, anything else that would start it waits.
  const busy = (on: boolean) => {
    for (const part of waiting) part.classList.toggle('is-waiting', on);
  };
  const start = () => {
    settle.disconnect();
    runState.textContent = 'Preparing…';
    busy(true);
    open();
    phase('working');
    // Claude's panel takes room from the job's, so the call it's prepping for stays in view.
    scrollSections(call, 12);
  };
  const finish = () => {
    show(7);
    phase('done');
    busy(false);
    // The call has its prep sheet, so its button preps again, as the app's does.
    runState.textContent = 'Prep again';
    run.classList.replace('ui-primary', 'ui-quiet');
    for (const part of made) part.classList.add('is-shown');
    // What the job needs next moves on: the panel is prepped for, so it no longer needs you.
    for (const part of after) {
      part.textContent = part.dataset.demoThen ?? part.textContent;
      if (part.dataset.demoThenClass) part.className = part.dataset.demoThenClass;
    }
    // The prep sheet is on the call. The sections keep it in view once laid out, and again
    // whenever their size changes.
    if (sections) new ResizeObserver(() => scrollSections(call, 12)).observe(sections);
  };

  show(0);
  if (still) {
    start();
    finish();
    return;
  }

  // It starts once Claude's panel is in view, so the run plays where it can be seen.
  whenSeen(
    claude,
    async () => {
      let turn = 0;
      const spin = window.setInterval(() => {
        turn = (turn + 1) % SPINNER.length;
        for (const spinner of spinners) spinner.textContent = SPINNER[turn] ?? '✻';
      }, 110);
      await wait(900);
      run.classList.add('is-pressed');
      await wait(220);
      run.classList.remove('is-pressed');
      start();
      show(1);
      await wait(700);
      show(2);
      await wait(1500);
      show(3);
      await wait(800);
      show(4);
      phase('need');
      await wait(2300);
      show(5);
      phase('working');
      await wait(600);
      show(6);
      await wait(1900);
      finish();
      window.clearInterval(spin);
    },
    0.9,
  );
}

/** Step 2: Claude's question is answered, and the drafted claim becomes a confirmed one. */
function confirmClaim(root: HTMLElement): void {
  if (still) return;
  root.classList.add('is-before');
  whenSeen(
    root,
    async () => {
      await wait(1300);
      root.classList.add('is-answering');
      await wait(450);
      root.classList.remove('is-before', 'is-answering');
    },
    0.45,
  );
}

/** Step 3: the score bars fill as the fit check comes into view. */
function fillScores(root: HTMLElement): void {
  if (still) return;
  root.classList.add('is-before');
  whenSeen(root, () => window.setTimeout(() => root.classList.remove('is-before'), 150), 0.3);
}

/**
 * The fact bank: picking a resume line shows the fact it came from. Side by side on wide
 * screens; on narrow ones, the fact opens right under the line picked.
 */
function traceFacts(root: HTMLElement): void {
  const lines = [...root.querySelectorAll<HTMLButtonElement>('[data-fact]')];
  const facts = [...root.querySelectorAll<HTMLElement>('[data-fact-card]')];
  const card = root.querySelector<HTMLElement>('#trace-fact');
  const status = root.querySelector<HTMLElement>('[data-trace-status]');
  const narrow = window.matchMedia('(max-width: 900px)');
  let shown = '0';
  const place = () => {
    if (!card) return;
    const picked = lines.find((line) => line.dataset.fact === shown)?.parentElement;
    const home = narrow.matches && picked ? picked : root;
    if (card.parentElement !== home) home.append(card);
  };
  const pick = (index: string) => {
    if (index === shown) return;
    shown = index;
    for (const line of lines)
      line.setAttribute('aria-pressed', String(line.dataset.fact === index));
    for (const fact of facts) {
      const match = fact.dataset.factCard === index;
      fact.hidden = !match;
      fact.classList.toggle('is-entering', match && !still);
      if (match && status) {
        status.textContent = `The fact behind it: ${fact.querySelector('h3')?.textContent ?? ''}.`;
      }
    }
    place();
  };
  place();
  narrow.addEventListener('change', place);
  for (const line of lines) {
    const index = line.dataset.fact ?? '0';
    line.addEventListener('click', () => pick(index));
    // Side by side, pointing at a line is enough. Narrow, the fact opens under the line, which
    // would move lines out from under the pointer, so it waits for a click.
    line.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && !narrow.matches) pick(index);
    });
  }
}

/** Each part below the fold eases in as it scrolls into view, just after any that came with it. */
function reveal(): void {
  if (still) return;
  const parts = [...document.querySelectorAll<HTMLElement>('.reveal')];
  const observer = new IntersectionObserver(
    (entries) => {
      let order = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const part = entry.target as HTMLElement;
        observer.unobserve(part);
        part.style.transitionDelay = `${Math.min(order++, 5) * 80}ms`;
        part.classList.add('is-revealing');
        part.classList.remove('is-pending');
        // Once it has eased in, its own hover effects get their usual timing back. Transitions
        // inside it bubble up here too, so only its own counts.
        const settle = (event: TransitionEvent) => {
          if (event.target !== part) return;
          part.removeEventListener('transitionend', settle);
          part.classList.remove('is-revealing');
          part.style.transitionDelay = '';
        };
        part.addEventListener('transitionend', settle);
      }
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  for (const part of parts) {
    if (part.getBoundingClientRect().top < window.innerHeight) continue;
    part.classList.add('is-pending');
    observer.observe(part);
  }
}

header();
reveal();
const computer = platform(navigator);
if (computer) {
  for (const root of document.querySelectorAll<HTMLElement>('[data-downloads]')) {
    offerDownloads(root, computer);
  }
}
// The download page that picks goes straight on to this computer's, which starts the download.
// A phone, a tablet or Linux stays on it, to see both.
if (computer && document.querySelector('[data-get="choose"]')) {
  window.location.replace(downloadPage(computer));
}
for (const page of document.querySelectorAll<HTMLElement>(
  '[data-get="mac"], [data-get="windows"]',
)) {
  startDownload(page, (url) => window.location.assign(url));
}
for (const root of document.querySelectorAll<HTMLElement>('[data-demo]')) heroRun(root);
for (const root of document.querySelectorAll<HTMLElement>('[data-confirm]')) confirmClaim(root);
for (const root of document.querySelectorAll<HTMLElement>('.fit')) fillScores(root);
for (const root of document.querySelectorAll<HTMLElement>('[data-trace]')) traceFacts(root);
for (const root of document.querySelectorAll<HTMLElement>('[data-own-server]')) {
  ownServerGuide(root, thisBrowser(computer));
}
