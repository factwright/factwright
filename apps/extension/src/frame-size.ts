/**
 * The sizes of the extension's own frame on a job site you allowed (frame.html), which its script
 * there places before the frame has drawn anything, and the frame draws to. A row shows two lines
 * of an answer at most, and where it came from, so its size never depends on the answer's words,
 * which the page's script never has.
 */

/** The menu: as wide as this, or the window, less its edges. */
export const MENU_WIDTH = 320;
/** Its heading, each answer's row, the offer to save a new answer, and the room below them. */
export const MENU_HEAD = 28;
export const MENU_ROW = 56;
export const MENU_SAVE = 92;
export const MENU_FOOT = 8;

/** The most answers a menu shows. */
export const MENU_ROWS = 4;

/** The menu's height, for some answers, with or without an offer to save. */
export const menuHeight = (rows: number, save: boolean): number =>
  MENU_HEAD + Math.min(rows, MENU_ROWS) * MENU_ROW + (save ? MENU_SAVE : 0) + MENU_FOOT;

/** The Fill button, and what it says once it's filled the form in Firefox, without the sidebar. */
export const BUTTON = { width: 120, height: 40 };
export const BUTTON_CARD = { width: 300, height: 112 };
