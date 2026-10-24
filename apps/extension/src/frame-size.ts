/**
 * The sizes of the extension's own frame on a job site you allowed (frame.html), which its script
 * there places before the frame has drawn anything, and the frame draws to. A menu is the same size
 * however many answers it has, with room for two rows, and more scroll inside it, so the page,
 * which sees the frame's box, can't tell how many there are. A row shows two lines of an answer
 * at most, and where it came from.
 */

/** The menu: as wide as this, or the window, less its edges. */
export const MENU_WIDTH = 320;
/** Its heading, each answer's row, the offer to save a new answer, and the room below them. */
export const MENU_HEAD = 28;
export const MENU_ROW = 56;
export const MENU_SAVE = 92;
export const MENU_FOOT = 8;

/** The rows a menu has room for, and the most answers it holds, which scroll. */
export const MENU_ROWS_SHOWN = 2;
export const MENU_ROWS = 4;

/** The menu's height, with answers or without, and with an offer to save or without. */
export const menuHeight = (answers: boolean, save: boolean): number =>
  MENU_HEAD + (answers ? MENU_ROWS_SHOWN * MENU_ROW : 0) + (save ? MENU_SAVE : 0) + MENU_FOOT;

/** The Fill button, and what it says once it's filled the form in Firefox, without the sidebar. */
export const BUTTON = { width: 120, height: 40 };
export const BUTTON_CARD = { width: 300, height: 112 };
