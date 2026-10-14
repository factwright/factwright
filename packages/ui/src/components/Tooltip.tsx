import {
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import styles from './Tooltip.module.css';

/** Which side of its trigger a tooltip opens on. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

/** What a tooltip's trigger is given: what describes it, and what shows and hides the tooltip. */
export interface TooltipTrigger {
  'aria-describedby': string;
  onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: () => void;
  onFocus: (event: FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
}

export interface TooltipProps {
  /** What it says: a few short lines, with no links or buttons, since it never takes focus. */
  content: ReactNode;
  /** The side it opens on when there's room there, or else the opposite one. */
  side?: TooltipSide;
  /** How far it sits from its trigger, in pixels, such as to clear the edge of a sidebar. */
  gap?: number;
  /** The element it explains, such as a button. It must take focus, so the keyboard reaches it. */
  children: (trigger: TooltipTrigger) => ReactNode;
}

/** How long the pointer rests on the trigger before it shows, so passing over doesn't show it. */
const SHOW_AFTER_MS = 400;
/** How long it stays once the pointer leaves, so the pointer can move onto it. */
const HIDE_AFTER_MS = 200;
/** The space between it and its trigger, and the least it keeps from the window's edges. */
const GAP = 8;

/** Whether the browser can show it as a popover, above everything else on the page. */
const POPS = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

const OPPOSITE: Readonly<Record<TooltipSide, TooltipSide>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

interface Size {
  width: number;
  height: number;
}

/**
 * Where a tooltip goes, as its top left corner in the window: beside its trigger on the side
 * asked for, or the opposite side when it only fits there, and moved along that side to stay in
 * the window.
 */
export function placeTooltip(
  trigger: { top: number; left: number } & Size,
  tip: Size,
  view: Size,
  side: TooltipSide,
  gap = GAP,
): { top: number; left: number } {
  const fits: Readonly<Record<TooltipSide, boolean>> = {
    top: trigger.top - gap - tip.height >= GAP,
    bottom: trigger.top + trigger.height + gap + tip.height <= view.height - GAP,
    left: trigger.left - gap - tip.width >= GAP,
    right: trigger.left + trigger.width + gap + tip.width <= view.width - GAP,
  };
  const chosen = !fits[side] && fits[OPPOSITE[side]] ? OPPOSITE[side] : side;
  // Along the side, centered on the trigger, but never past the window's edges.
  const along = (start: number, length: number, room: number, own: number) =>
    Math.max(GAP, Math.min(start + length / 2 - own / 2, room - own - GAP));
  if (chosen === 'top' || chosen === 'bottom') {
    return {
      top: chosen === 'top' ? trigger.top - gap - tip.height : trigger.top + trigger.height + gap,
      left: along(trigger.left, trigger.width, view.width, tip.width),
    };
  }
  return {
    top: along(trigger.top, trigger.height, view.height, tip.height),
    left: chosen === 'left' ? trigger.left - gap - tip.width : trigger.left + trigger.width + gap,
  };
}

/**
 * Whether the keyboard was used since the pointer last was, which is how browsers judge whether
 * focus should show. So a tooltip shows for focus from Tab, but not for a click's focus, or focus
 * coming back to its trigger after a click closes a dialog.
 */
let keyboardLast = false;
let watching = false;

function watchInput() {
  if (watching) return;
  watching = true;
  document.addEventListener('keydown', () => (keyboardLast = true), true);
  document.addEventListener('pointerdown', () => (keyboardLast = false), true);
}

/**
 * A few words that explain something, shown beside it while the pointer rests on it or the
 * keyboard focuses it. Following WCAG's rule for content on hover, Escape hides it, the pointer
 * can move onto it without it closing, and it stays until the pointer and focus leave. Its text
 * also describes the trigger to screen readers. Touch screens have no hover, so the trigger must
 * make sense without it.
 */
export function Tooltip({ content, side = 'top', gap = GAP, children }: TooltipProps) {
  const id = useId();
  const tip = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const open = (hovered || focused) && !dismissed;

  const wait = (ms: number, then: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(then, ms);
  };
  useEffect(() => {
    watchInput();
    return () => clearTimeout(timer.current);
  }, []);

  // Once the pointer and focus have both left, it can show again.
  useEffect(() => {
    if (!hovered && !focused) setDismissed(false);
  }, [hovered, focused]);

  // Escape hides it, wherever focus is. Pressed on its trigger, it does nothing else, such as
  // closing a dialog the trigger is in. Pressed elsewhere, such as in a terminal, it still does
  // what it's for there too.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDismissed(true);
      if (event.target instanceof Node && anchor.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Over everything, as a popover where the browser has them, so no scrolling edge clips it.
  // It's placed before it's painted, and kept beside its trigger as the window scrolls or resizes.
  useLayoutEffect(() => {
    const element = tip.current;
    if (!open || !element) return;
    if (POPS) element.showPopover();
    const follow = () => {
      const trigger = anchor.current?.getBoundingClientRect();
      if (!trigger) return;
      const next = placeTooltip(
        trigger,
        element.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        side,
        gap,
      );
      setPlace((now) => (now?.top === next.top && now.left === next.left ? now : next));
    };
    follow();
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
      if (POPS) element.hidePopover();
    };
  }, [open, side, gap]);

  const leave = () => wait(HIDE_AFTER_MS, () => setHovered(false));

  return (
    <>
      {children({
        'aria-describedby': id,
        onPointerEnter: (event) => {
          if (event.pointerType === 'touch') return;
          anchor.current = event.currentTarget;
          if (open) {
            clearTimeout(timer.current);
            setHovered(true);
          } else {
            wait(SHOW_AFTER_MS, () => setHovered(true));
          }
        },
        onPointerLeave: leave,
        // A click does what the trigger is for, such as opening a dialog, so this makes way.
        onPointerDown: () => {
          clearTimeout(timer.current);
          if (hovered || focused) setDismissed(true);
        },
        onFocus: (event) => {
          anchor.current = event.currentTarget;
          // A click's focus comes with the pointer, which shows it on its own.
          if (keyboardLast) setFocused(true);
        },
        onBlur: () => setFocused(false),
      })}
      <div
        ref={tip}
        id={id}
        role="tooltip"
        popover={POPS ? 'manual' : undefined}
        hidden={!open}
        className={styles.tooltip}
        style={place ?? undefined}
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={leave}
      >
        {content}
      </div>
    </>
  );
}
