/**
 * Where the extension's own frame goes on a job site you allowed: its menu beside the field you're
 * in, and its Fill button in a corner of the window, each only where it covers none of the page's
 * own controls, and never the field. Where nothing has room, it doesn't show: the panel has the
 * same answers, by a click on the extension's button.
 */

/** A box on the screen, as a page's layout gives one, from the window's top left corner. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A size, of the frame, or of the window. */
export interface Size {
  width: number;
  height: number;
}

/** A place, from the window's top left corner. */
export interface Place {
  left: number;
  top: number;
}

/** The room the menu leaves between it and its field. */
export const GAP = 6;

/** The room the frame leaves from the window's edges, and the button from its corner. */
export const EDGE = 4;
export const CORNER = 16;

/** How near a control the frame may come: a couple of pixels, as the eye takes a gap. */
const CLEAR = 2;

/** Whether two boxes overlap, more than touching. */
export const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/** Whether a box is all inside the window, with room from its edges. */
const inside = (box: Box, window: Size): boolean =>
  box.left >= EDGE &&
  box.top >= EDGE &&
  box.left + box.width <= window.width - EDGE &&
  box.top + box.height <= window.height - EDGE;

/** A box grown on each side, to keep a gap around it. */
const grown = (box: Box, by: number): Box => ({
  left: box.left - by,
  top: box.top - by,
  width: box.width + 2 * by,
  height: box.height + 2 * by,
});

/** The first of some places where a frame of a size covers nothing it mustn't, or null. */
function firstFree(
  places: readonly Place[],
  size: Size,
  covered: readonly Box[],
  window: Size,
): Place | null {
  for (const place of places) {
    const box = { ...place, ...size };
    if (!inside(box, window)) continue;
    const near = grown(box, CLEAR);
    if (covered.some((other) => other.width > 0 && other.height > 0 && overlaps(near, other))) {
      continue;
    }
    return place;
  }
  return null;
}

/**
 * Where a menu of a size goes beside its field: to its right, below it, above it, or to its left,
 * lined up with one of its edges, the first of these that's inside the window and covers neither
 * the field nor any of the page's own controls. Null when none is.
 */
export function placeMenu(
  size: Size,
  field: Box,
  controls: readonly Box[],
  window: Size,
): Place | null {
  const right = field.left + field.width;
  const bottom = field.top + field.height;
  return firstFree(
    [
      { left: right + GAP, top: field.top },
      { left: right + GAP, top: bottom - size.height },
      { left: field.left, top: bottom + GAP },
      { left: right - size.width, top: bottom + GAP },
      { left: field.left, top: field.top - GAP - size.height },
      { left: right - size.width, top: field.top - GAP - size.height },
      { left: field.left - GAP - size.width, top: field.top },
      { left: field.left - GAP - size.width, top: bottom - size.height },
    ],
    size,
    [field, ...controls],
    window,
  );
}

/**
 * Where the Fill button goes: a corner of the window, the bottom right first, that covers none of
 * the page's own controls. Null when every corner does.
 */
export function placeButton(size: Size, controls: readonly Box[], window: Size): Place | null {
  const right = window.width - CORNER - size.width;
  const bottom = window.height - CORNER - size.height;
  return firstFree(
    [
      { left: right, top: bottom },
      { left: CORNER, top: bottom },
      { left: right, top: CORNER },
      { left: CORNER, top: CORNER },
    ],
    size,
    controls,
    window,
  );
}
