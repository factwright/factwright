import {
  type CSSProperties,
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
  /**
   * The side it opens on when there's room there. Otherwise it's the opposite side, then one of
   * the two across, whichever has room, or else the one with the most.
   */
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

/** The sides to try, in turn: the one asked for, the opposite one, then the two across. */
const TRY: Readonly<Record<TooltipSide, readonly TooltipSide[]>> = {
  top: ['top', 'bottom', 'right', 'left'],
  bottom: ['bottom', 'top', 'right', 'left'],
  left: ['left', 'right', 'top', 'bottom'],
  right: ['right', 'left', 'top', 'bottom'],
};

interface Size {
  width: number;
  height: number;
}

/** Where a tooltip goes: its top left corner in the window, and the side of its trigger it's on. */
export interface TooltipPlace {
  top: number;
  left: number;
  side: TooltipSide;
}

/**
 * Where a tooltip goes: beside its trigger, on the first side it fits, starting with the one asked
 * for, as a narrow or zoomed window may leave room only above or below. It's centered on the
 * trigger along that side, but kept inside the window.
 */
export function placeTooltip(
  trigger: { top: number; left: number } & Size,
  tip: Size,
  view: Size,
  side: TooltipSide,
  gap = GAP,
): TooltipPlace {
  // The room each side has to spare, which is less than none where it doesn't fit.
  const spare: Readonly<Record<TooltipSide, number>> = {
    top: trigger.top - gap - tip.height - GAP,
    bottom: view.height - GAP - (trigger.top + trigger.height + gap + tip.height),
    left: trigger.left - gap - tip.width - GAP,
    right: view.width - GAP - (trigger.left + trigger.width + gap + tip.width),
  };
  const sides = TRY[side];
  // Where it fits nowhere, as in a window zoomed far in, the side with the most room. Even then it
  // stays beside its trigger, so it never covers it.
  const chosen =
    sides.find((each) => spare[each] >= 0) ??
    sides.reduce((most, each) => (spare[each] > spare[most] ? each : most));
  // Along the side, centered on the trigger, but never past the window's edges.
  const along = (start: number, length: number, room: number, own: number) =>
    Math.max(GAP, Math.min(start + length / 2 - own / 2, room - own - GAP));
  if (chosen === 'top' || chosen === 'bottom') {
    return {
      top: chosen === 'top' ? trigger.top - gap - tip.height : trigger.top + trigger.height + gap,
      left: along(trigger.left, trigger.width, view.width, tip.width),
      side: chosen,
    };
  }
  return {
    top: along(trigger.top, trigger.height, view.height, tip.height),
    left: chosen === 'left' ? trigger.left - gap - tip.width : trigger.left + trigger.width + gap,
    side: chosen,
  };
}

/**
 * Whether the keyboard was used since the pointer last was, which is how browsers judge whether
 * focus should show. So a tooltip shows for focus from Tab, but not for a click's focus, or focus
 * coming back to its trigger after a click closes a dialog. A shortcut doesn't count, as it
 * doesn't for browsers, so switching apps with Cmd or Alt and Tab doesn't show one on coming back.
 */
let keyboardLast = false;
let watching = false;

function watchInput() {
  if (watching) return;
  watching = true;
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboardLast = true;
    },
    true,
  );
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
  const [place, setPlace] = useState<TooltipPlace | null>(null);
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
      setPlace((now) =>
        now?.top === next.top && now.left === next.left && now.side === next.side ? now : next,
      );
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
        // Which side it's on, for the bridge over the gap to its trigger.
        data-side={place?.side}
        style={
          place
            ? ({ top: place.top, left: place.left, '--tooltip-gap': `${gap}px` } as CSSProperties)
            : undefined
        }
        onPointerEnter={() => clearTimeout(timer.current)}
        onPointerLeave={leave}
      >
        {content}
      </div>
    </>
  );
}
