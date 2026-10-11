/** Every color one theme needs. Each becomes a CSS variable, such as accentSoft → --fw-accent-soft. */
export interface Palette {
  bg: string;
  bar: string;
  surface: string;
  sunken: string;
  hover: string;
  border: string;
  /** Borders that identify form controls, which need 3:1 against what's around them. */
  controlBorder: string;
  text: string;
  muted: string;
  accent: string;
  accentHover: string;
  /** Text on the accent color. */
  accentInk: string;
  accentSoft: string;
  /** Accent-colored text, readable on accentSoft. */
  accentText: string;
  /** Claude needs the user. */
  need: string;
  needSoft: string;
  /** Done. */
  ok: string;
  okSoft: string;
  /** Something went wrong. */
  bad: string;
  badSoft: string;
  /** Claude's panel. */
  term: string;
  termText: string;
  termMuted: string;
}

export const LIGHT: Palette = {
  bg: '#F6F5F1',
  bar: '#FAF9F6',
  surface: '#FFFFFF',
  sunken: '#F0EEE8',
  hover: '#F2F0EB',
  border: '#E4E1D8',
  controlBorder: '#8C887D',
  text: '#1B1B19',
  muted: '#5E5D56',
  accent: '#2F4BD0',
  accentHover: '#2840B5',
  accentInk: '#FFFFFF',
  accentSoft: '#EAEEFC',
  accentText: '#2A43B8',
  need: '#B4410C',
  needSoft: '#FDEEE4',
  ok: '#1C7442',
  okSoft: '#E5F3EA',
  bad: '#B42318',
  badSoft: '#FDECEA',
  term: '#FBFAF7',
  termText: '#262622',
  termMuted: '#66655E',
};

export const DARK: Palette = {
  bg: '#111110',
  bar: '#161615',
  surface: '#1B1B19',
  sunken: '#232320',
  hover: '#262623',
  border: '#2D2D29',
  controlBorder: '#6E6C64',
  text: '#ECEBE5',
  muted: '#A7A59C',
  accent: '#8EA2FF',
  accentHover: '#A3B3FF',
  accentInk: '#0D1022',
  accentSoft: '#232A4A',
  accentText: '#AEBBFF',
  need: '#FB923C',
  needSoft: '#3A2414',
  ok: '#5BCB8A',
  okSoft: '#16301F',
  bad: '#F97066',
  badSoft: '#3A1D1A',
  term: '#141413',
  termText: '#E4E3DC',
  termMuted: '#A09E95',
};

/** Tints for pills and badges. Each pairs a text color with its background. */
export const TONES = [
  'gray',
  'slate',
  'violet',
  'blue',
  'teal',
  'purple',
  'green',
  'amber',
] as const;

export type Tone = (typeof TONES)[number];

export interface ToneColors {
  fg: string;
  bg: string;
}

export const TONE_COLORS: Readonly<Record<Tone, { light: ToneColors; dark: ToneColors }>> = {
  gray: { light: { fg: '#5E5D56', bg: '#EFEDE7' }, dark: { fg: '#C9C7BE', bg: '#2A2A26' } },
  slate: { light: { fg: '#44557D', bg: '#EBEEF5' }, dark: { fg: '#AEBBDA', bg: '#252A36' } },
  violet: { light: { fg: '#5A41BF', bg: '#EFEBFC' }, dark: { fg: '#BDAEFF', bg: '#2A2440' } },
  blue: { light: { fg: '#2453B5', bg: '#E7EEFC' }, dark: { fg: '#9BBBFF', bg: '#1F2A42' } },
  teal: { light: { fg: '#0A6B6C', bg: '#E1F3F3' }, dark: { fg: '#6FD6D6', bg: '#14302F' } },
  purple: { light: { fg: '#8A2E9E', bg: '#F5E9F8' }, dark: { fg: '#E8A4F5', bg: '#35203A' } },
  green: { light: { fg: '#1C7442', bg: '#E5F3EA' }, dark: { fg: '#7EDBA3', bg: '#16301F' } },
  amber: { light: { fg: '#8A5300', bg: '#FBF0DC' }, dark: { fg: '#F0BE6A', bg: '#33270F' } },
};

/**
 * Claude's panel: the terminal's colors, including the 16 ANSI colors. Claude Code runs with an
 * ANSI theme there, so these are all the colors it shows. Seen in a real run of its dark theme:
 * bright white is the main text, white the secondary text, and bright black the bar behind the
 * user's message. Its light theme is taken to mirror that: black, bright black, then white.
 */
export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_COLORS: Readonly<{ light: TerminalColors; dark: TerminalColors }> = {
  light: {
    background: LIGHT.term,
    foreground: LIGHT.termText,
    cursor: LIGHT.accent,
    cursorAccent: LIGHT.term,
    selectionBackground: LIGHT.accentSoft,
    black: '#262622',
    red: '#B42318',
    green: '#1C7442',
    yellow: '#8A5300',
    blue: '#2453B5',
    magenta: '#8A2E9E',
    cyan: '#0A6B6C',
    white: '#E9E6DE',
    brightBlack: '#66655E',
    brightRed: '#A51E14',
    brightGreen: '#176538',
    brightYellow: '#7A4900',
    brightBlue: '#2F4BD0',
    brightMagenta: '#7A2690',
    brightCyan: '#095E5F',
    brightWhite: '#F0EEE8',
  },
  dark: {
    background: DARK.term,
    foreground: DARK.termText,
    cursor: DARK.accent,
    cursorAccent: DARK.term,
    selectionBackground: DARK.accentSoft,
    black: '#2D2D29',
    red: '#F97066',
    green: '#5BCB8A',
    yellow: '#F0BE6A',
    blue: '#8EA2FF',
    magenta: '#E8A4F5',
    cyan: '#6FD6D6',
    white: '#B5B3AA',
    brightBlack: '#3A3A35',
    brightRed: '#FF8E85',
    brightGreen: '#7EDBA3',
    brightYellow: '#F5CD84',
    brightBlue: '#AEBBFF',
    brightMagenta: '#EFBDF7',
    brightCyan: '#8FE3E3',
    brightWhite: '#ECEBE5',
  },
};

/** The system fonts, so the app feels native: SF Pro on Mac, Segoe UI on Windows. */
export const FONTS = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
} as const;

/** Type sizes, from small print to page titles. */
export const TEXT_SIZES = {
  xs: '12px',
  sm: '12.5px',
  md: '13.5px',
  base: '14px',
  lg: '20px',
  xl: '22px',
} as const;

/** The spacing scale, in 4px steps. */
export const SPACE = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
} as const;

export const RADII = {
  sm: '6px',
  md: '9px',
  lg: '12px',
  xl: '16px',
  full: '999px',
} as const;
