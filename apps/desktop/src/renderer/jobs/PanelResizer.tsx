import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import styles from './JobPanel.module.css';

/** The narrowest a job's details go, which their areas are laid out for, as the styles have it too. */
const PANEL_MIN = 340;
/** The room the list keeps beside them, as the styles have it too. */
const LIST_MIN = 360;
/** Over the list, in a window too narrow for both, how much of it still shows, to drag back from. */
const LIST_PEEK = 48;
/** How far each press of an arrow key moves the edge. */
const KEY_STEP = 24;

/** A width a job's details were left at, or null for the width they start at. */
export const isPanelWidth = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);

/** The widest the details can go in the room they have. */
function widest(frame: HTMLElement): number {
  const room = frame.parentElement?.clientWidth ?? 0;
  const over = getComputedStyle(frame).position === 'absolute';
  return Math.max(PANEL_MIN, room - (over ? LIST_PEEK : LIST_MIN));
}

/**
 * The edge between the list and a job's details, which drags to make the details any width, from
 * their narrowest to all but the list's own room. Its arrow keys do the same, Home and End go to
 * either end, and a double-click or Enter puts it back. It moves the frame's --panel-width itself while
 * it's dragged, so the app isn't drawn again at each step, and hears where it ended up after.
 */
export function PanelResizer({
  frame,
  onWidth,
  onOtherKey,
}: {
  /** What holds the details, which takes its width from --panel-width. */
  frame: RefObject<HTMLElement | null>;
  /** Hears the width they end up at, or null to go back to the width they start at. */
  onWidth: (width: number | null) => void;
  /** Hears the keys it doesn't use, so Escape works from it as from the details. */
  onOtherKey: (event: KeyboardEvent) => void;
}) {
  const [size, setSize] = useState({ now: PANEL_MIN, max: PANEL_MIN });
  const [dragging, setDragging] = useState(false);
  // How far in from the details' left edge the drag took hold, so the edge doesn't jump to it.
  const grip = useRef(0);
  // Whether the pointer moved while it held the edge, as a click alone leaves the width as it was.
  const moved = useRef(false);

  const measure = useCallback(() => {
    const element = frame.current;
    if (!element) return;
    const now = Math.round(element.getBoundingClientRect().width);
    const max = widest(element);
    setSize((was) => (was.now === now && was.max === max ? was : { now, max }));
  }, [frame]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const resizes = new ResizeObserver(measure);
    resizes.observe(element);
    if (element.parentElement) resizes.observe(element.parentElement);
    return () => resizes.disconnect();
  }, [frame, measure]);

  /** Sets the details' width within what fits, and says what it came to. */
  const setWidth = (wanted: number): number | null => {
    const element = frame.current;
    if (!element) return null;
    const width = Math.round(Math.min(Math.max(wanted, PANEL_MIN), widest(element)));
    element.style.setProperty('--panel-width', `${width}px`);
    return width;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const element = frame.current;
    if (event.button !== 0 || !element) return;
    // Taken here, so the drag selects no text, and the keyboard can carry on from the edge.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    grip.current = event.clientX - element.getBoundingClientRect().left;
    moved.current = false;
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const element = frame.current;
    if (!dragging || !element) return;
    moved.current = true;
    setWidth(element.getBoundingClientRect().right - event.clientX + grip.current);
  };
  const stop = () => {
    const element = frame.current;
    if (!dragging || !element) return;
    setDragging(false);
    if (moved.current) onWidth(Math.round(element.getBoundingClientRect().width));
  };
  const putBack = () => {
    frame.current?.style.removeProperty('--panel-width');
    onWidth(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      putBack();
      return;
    }
    const moves: Record<string, number> = {
      ArrowLeft: size.now + KEY_STEP,
      ArrowRight: size.now - KEY_STEP,
      Home: PANEL_MIN,
      End: size.max,
    };
    const wanted = moves[event.key];
    if (wanted === undefined) {
      onOtherKey(event);
      return;
    }
    event.preventDefault();
    const width = setWidth(wanted);
    if (width !== null) onWidth(width);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an hr can't hold focus or be dragged.
    <div
      className={styles.resizer}
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of the job’s details"
      aria-valuenow={size.now}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={size.max}
      tabIndex={0}
      title="Drag to change the width. Double-click to put it back."
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onLostPointerCapture={stop}
      onDoubleClick={putBack}
      onKeyDown={onKeyDown}
    />
  );
}
