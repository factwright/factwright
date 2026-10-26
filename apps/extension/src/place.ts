/**
 * Where the extension's own frame goes on a job site you allowed: its menu beside the field you're
 * in, where it covers none of the page's own controls, or else just under the field, over the
 * page, as a password manager's does, and its Fill button in a corner of the window that covers
 * none of them. Neither ever covers the field. In a form another site's page shows in a frame,
 * "the window" is the part of the frame you can see, as the page around it scrolls it. Where
 * nothing has room, it doesn't show: the panel has the same answers, by a click on the extension's
 * button.
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

/**
 * Where the frame may go: the window, from its top left corner, or the part of it that shows, as
 * a frame's that another page scrolls.
 */
export type Area = Size & Partial<Place>;

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

/** Whether a box is all inside the window, or the part of it that shows, with room from its edges. */
const inside = (box: Box, area: Area): boolean => {
  const left = area.left ?? 0;
  const top = area.top ?? 0;
  return (
    box.left >= left + EDGE &&
    box.top >= top + EDGE &&
    box.left + box.width <= left + area.width - EDGE &&
    box.top + box.height <= top + area.height - EDGE
  );
};

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
  area: Area,
): Place | null {
  for (const place of places) {
    const box = { ...place, ...size };
    if (!inside(box, area)) continue;
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
 * the field nor any of the page's own controls. Where none is, as in a form of one column with
 * labels between its fields, it goes just under the field, over the page, as a password manager's
 * does, or just over it, lined up with its left edge as far as the window lets it. Null only when
 * neither is inside the window.
 */
export function placeMenu(
  size: Size,
  field: Box,
  controls: readonly Box[],
  area: Area,
): Place | null {
  const right = field.left + field.width;
  const bottom = field.top + field.height;
  const beside = firstFree(
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
    area,
  );
  return beside ?? overThePage(size, field, area);
}

/**
 * Just under a field, or just over it, over the page, lined up with the field's left edge as far as
 * the window lets it: or null where neither is inside the window.
 */
function overThePage(size: Size, field: Box, area: Area): Place | null {
  const first = (area.left ?? 0) + EDGE;
  const last = (area.left ?? 0) + area.width - EDGE - size.width;
  if (last < first) return null;
  const left = Math.min(Math.max(field.left, first), last);
  for (const top of [field.top + field.height + GAP, field.top - GAP - size.height]) {
    if (inside({ left, top, ...size }, area)) return { left, top };
  }
  return null;
}

/**
 * Where the Fill button goes: a corner of the window, or of the part of it that shows, the bottom
 * right first, that covers none of the page's own controls. Null when every corner does.
 */
export function placeButton(size: Size, controls: readonly Box[], area: Area): Place | null {
  const left = (area.left ?? 0) + CORNER;
  const top = (area.top ?? 0) + CORNER;
  const right = (area.left ?? 0) + area.width - CORNER - size.width;
  const bottom = (area.top ?? 0) + area.height - CORNER - size.height;
  return firstFree(
    [
      { left: right, top: bottom },
      { left, top: bottom },
      { left: right, top },
      { left, top },
    ],
    size,
    controls,
    area,
  );
}
