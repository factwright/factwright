import { describe, expect, it } from 'vitest';
import { BUTTON, MENU_WIDTH, menuHeight } from '../src/frame-size.ts';
import {
  type Box,
  CORNER,
  EDGE,
  GAP,
  overlaps,
  type Place,
  placeButton,
  placeMenu,
} from '../src/place.ts';

const WINDOW = { width: 1280, height: 800 };
const MENU = { width: MENU_WIDTH, height: menuHeight(true, false) };

/** A field, as a form lays one out. */
const field: Box = { left: 100, top: 200, width: 300, height: 32 };

const at = (place: Place | null, size = MENU): Box => {
  if (!place) throw new Error('No place.');
  return { ...place, ...size };
};

describe('a menu beside its field', () => {
  it('goes to the field’s right, lined up with its top, where nothing’s there', () => {
    expect(placeMenu(MENU, field, [], WINDOW)).toEqual({ left: 400 + GAP, top: 200 });
  });

  it('never covers the page’s own controls, nor its field', () => {
    // Every place but one has a control of the page's: the menu goes there.
    const controls: Box[] = [
      { left: 420, top: 150, width: 400, height: 300 },
      { left: 0, top: 240, width: 1280, height: 40 },
    ];
    const place = placeMenu(MENU, field, controls, WINDOW);
    const box = at(place);
    expect(box.top + box.height).toBeLessThanOrEqual(field.top - GAP);
    for (const control of [field, ...controls]) expect(overlaps(box, control)).toBe(false);
  });

  it('leaves a gap even beside a control that only touches it', () => {
    const touching: Box = { left: 400 + GAP + MENU.width, top: 200, width: 40, height: 20 };
    const box = at(placeMenu(MENU, field, [touching], WINDOW));
    expect(box.left).not.toBe(400 + GAP);
  });

  it('stays inside the window, as a field at its bottom has its menu above', () => {
    const low: Box = { left: 900, top: 760, width: 300, height: 32 };
    const box = at(placeMenu(MENU, low, [], WINDOW));
    expect(box.left).toBeGreaterThanOrEqual(EDGE);
    expect(box.top).toBeGreaterThanOrEqual(EDGE);
    expect(box.left + box.width).toBeLessThanOrEqual(WINDOW.width - EDGE);
    expect(box.top + box.height).toBeLessThanOrEqual(WINDOW.height - EDGE);
  });

  it('doesn’t show where every place would cover a control or leave the window', () => {
    const everywhere: Box = { left: 0, top: 0, width: 1280, height: 800 };
    expect(placeMenu(MENU, field, [everywhere], WINDOW)).toBeNull();
    const tiny = { width: 300, height: 120 };
    expect(placeMenu(MENU, field, [], tiny)).toBeNull();
  });

  it('takes no account of a control that isn’t laid out, as one with no size', () => {
    const hidden: Box = { left: 400 + GAP, top: 200, width: 0, height: 0 };
    expect(placeMenu(MENU, field, [hidden], WINDOW)).toEqual({ left: 400 + GAP, top: 200 });
  });
});

describe('the Fill button', () => {
  it('goes in the window’s bottom right corner', () => {
    expect(placeButton(BUTTON, [], WINDOW)).toEqual({
      left: WINDOW.width - CORNER - BUTTON.width,
      top: WINDOW.height - CORNER - BUTTON.height,
    });
  });

  it('goes to another corner where the page has a control in that one, as a chat button', () => {
    const chat: Box = { left: 1180, top: 700, width: 80, height: 80 };
    const box = at(placeButton(BUTTON, [chat], WINDOW), BUTTON);
    expect(box).toMatchObject({ left: CORNER, top: WINDOW.height - CORNER - BUTTON.height });
    expect(overlaps(box, chat)).toBe(false);
  });

  it('doesn’t show where every corner has one', () => {
    const bars: Box[] = [
      { left: 0, top: 0, width: 1280, height: 80 },
      { left: 0, top: 720, width: 1280, height: 80 },
    ];
    expect(placeButton(BUTTON, bars, WINDOW)).toBeNull();
  });
});

describe('in a frame another page scrolls, as a careers page shows a form in one', () => {
  /** The part of a tall frame that shows: from 1200 to 2000 down it. */
  const shown = { left: 0, top: 1200, width: 1280, height: 800 };

  it('puts the Fill button in a corner of the part that shows, not of the frame', () => {
    expect(placeButton(BUTTON, [], shown)).toEqual({
      left: shown.width - CORNER - BUTTON.width,
      top: shown.top + shown.height - CORNER - BUTTON.height,
    });
  });

  it('puts a menu only where it shows whole', () => {
    const low: Box = { left: 100, top: 1960, width: 300, height: 32 };
    const box = at(placeMenu(MENU, low, [], shown));
    expect(box.top).toBeGreaterThanOrEqual(shown.top + EDGE);
    expect(box.top + box.height).toBeLessThanOrEqual(shown.top + shown.height - EDGE);
    // A field above the part that shows has no room for one.
    const above: Box = { left: 100, top: 300, width: 300, height: 32 };
    expect(placeMenu(MENU, above, [], shown)).toBeNull();
  });
});
