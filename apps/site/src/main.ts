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

const PHASES: Readonly<Record<RunPhase, string>> = {
  working: 'Working',
  need: 'Needs your answer',
  done: 'Done',
};

/** What the bar says while Claude works: the last step it finished, and the one it's on. */
interface BarLine {
  did?: string;
  doing: string;
}

/** The drawing's run, a step at a time, in the words the app's bar uses for each. */
const BEFORE_QUESTION: readonly BarLine[] = [
  { doing: 'Reading what’s on file for the job…' },
  { did: 'Read what’s on file for the job', doing: 'Reading your fact bank…' },
  { did: 'Read your fact bank', doing: 'Thinking…' },
];
const AFTER_QUESTION: readonly BarLine[] = [
  { did: 'Read your fact bank', doing: 'Searching the web for “Lumen Health panel interview”…' },
  {
    did: 'Searched the web for “Lumen Health panel interview”',
    doing: 'Saving the prep sheet…',
  },
];

/** What the bar says once the prep sheet is saved. */
const READY = 'Your prep sheet for the panel interview at Lumen Health is ready.';

/** How long the run has taken so far, as the bar shows it. */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The app drawing at the top: Up next's Prep for the call starts Claude, the bar along the bottom
 * says what it's doing, a step at a time, Claude asks one question in a box of its own, and once
 * the prep sheet is saved, the bar says so, with Open it, which goes to the call it's for. The
 * buttons change the way the app's do, what would start Claude waits while it works, and what the
 * job needs next moves on once it's done. With reduced motion, it shows the finished run.
 */
function heroRun(root: HTMLElement): void {
  const find = (selector: string) => root.querySelector<HTMLElement>(selector);
  const bar = find('[data-demo-bar]');
  const status = find('[data-demo-status]');
  const statusLabel = find('[data-demo-status-label]');
  const did = find('[data-demo-did]');
  const didText = find('[data-demo-did-text]');
  const doing = find('[data-demo-doing]');
  const elapsed = find('[data-demo-elapsed]');
  const openIt = find('[data-demo-open]');
  const run = find('[data-demo-run]');
  const runState = find('[data-demo-run-state]');
  const callRun = find('[data-demo-call-run]');
  const callRunState = find('[data-demo-call-run-state]');
  const call = find('[data-demo-call]');
  const ask = find('[data-demo-ask]');
  const pick = find('[data-demo-pick]');
  const send = find('[data-demo-send]');
  const areas = find('[data-demo-scroll]');
  if (!bar || !status || !statusLabel || !did || !didText || !doing || !elapsed || !openIt) return;
  if (!run || !runState || !ask || !pick || !send) return;
  const waiting = [...root.querySelectorAll<HTMLElement>('[data-demo-wait]')];
  const made = [...root.querySelectorAll<HTMLElement>('[data-demo-doc]')];
  const after = [...root.querySelectorAll<HTMLElement>('[data-demo-then], [data-demo-then-class]')];

  const phase = (next: RunPhase) => {
    status.classList.remove('is-working', 'is-need', 'is-done');
    status.classList.add(`is-${next}`);
    statusLabel.textContent = PHASES[next];
    bar.classList.toggle('is-busy', next === 'working');
  };
  const say = (line: BarLine) => {
    did.hidden = !line.did;
    didText.textContent = line.did ?? '';
    doing.textContent = line.doing;
  };
  // The job's areas scroll to a part of them, with a little room above it, the way you would.
  const scrollAreas = (part: HTMLElement | null, room: number, smooth = !still) => {
    if (!areas || !part) return;
    const top = part.getBoundingClientRect().top - areas.getBoundingClientRect().top;
    areas.scrollTo({
      top: Math.max(0, areas.scrollTop + top - room),
      behavior: smooth ? 'smooth' : 'auto',
    });
  };
  // The button gives a little, as a real one does.
  const press = async (button: HTMLElement) => {
    button.classList.add('is-pressed');
    await wait(220);
    button.classList.remove('is-pressed');
  };
  let seconds = 0;
  let timer = 0;
  const start = () => {
    // Up next's button says Claude is on it, and the call's says it's preparing.
    run.classList.add('is-running');
    runState.textContent = 'Claude is on it';
    if (callRunState) callRunState.textContent = 'Preparing…';
    for (const part of waiting) part.classList.add('is-waiting');
    // The bar that said what Claude made last time says what it's doing now.
    bar.classList.remove('is-finished', 'is-arriving');
    openIt.hidden = true;
    elapsed.hidden = false;
    elapsed.textContent = clock(0);
    phase('working');
    say(BEFORE_QUESTION[0] ?? { doing: 'Thinking…' });
    if (!still) {
      timer = window.setInterval(() => {
        seconds += 1;
        elapsed.textContent = clock(seconds);
      }, 1000);
    }
  };
  const asking = (on: boolean) => {
    ask.hidden = !on;
    if (on) {
      phase('need');
      say({ doing: 'Claude has a question for you.' });
    } else {
      phase('working');
    }
  };
  const finish = () => {
    window.clearInterval(timer);
    phase('done');
    say({ doing: READY });
    bar.classList.add('is-finished');
    if (!still) bar.classList.add('is-arriving');
    elapsed.hidden = true;
    openIt.hidden = false;
    for (const part of waiting) part.classList.remove('is-waiting');
    // Up next moves on, to practicing for the call.
    run.classList.remove('is-running');
    runState.textContent = 'Practice for the call';
    // The call has its prep sheet, so its button preps again, as the app's does.
    if (callRun && callRunState) {
      callRunState.textContent = 'Prep again';
      callRun.classList.replace('ui-primary', 'ui-quiet');
    }
    for (const part of made) part.classList.add('is-shown');
    // What the job needs next moves on, from prepping for the panel to practicing for it.
    for (const part of after) {
      if (part.dataset.demoThen !== undefined) part.textContent = part.dataset.demoThen;
      if (part.dataset.demoThenClass) part.className = part.dataset.demoThenClass;
    }
  };
  // Open it goes to the call, where the prep sheet is, and keeps it in view once laid out, and
  // again whenever the areas' size changes, such as when a tablet turns.
  const openCall = () => {
    scrollAreas(call, 12);
    if (areas) new ResizeObserver(() => scrollAreas(call, 12, false)).observe(areas);
  };

  if (still) {
    start();
    finish();
    openCall();
    return;
  }

  // It starts once the bar is in view, so the run plays where it can be seen.
  whenSeen(
    bar,
    async () => {
      await wait(900);
      await press(run);
      start();
      for (const line of BEFORE_QUESTION.slice(1)) {
        await wait(1300);
        say(line);
      }
      await wait(900);
      asking(true);
      await wait(1400);
      pick.classList.add('is-picked');
      send.classList.add('is-ready');
      await wait(700);
      await press(send);
      asking(false);
      say({ did: 'Read your fact bank', doing: 'Thinking…' });
      for (const line of AFTER_QUESTION) {
        await wait(1200);
        say(line);
      }
      await wait(1300);
      finish();
      await wait(1900);
      await press(openIt);
      openCall();
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
