import {
  DARK,
  LIGHT,
  type Palette,
  TERMINAL_COLORS,
  type TerminalColors,
  TONE_COLORS,
  TONES,
  type Tone,
  type ToneColors,
} from './tokens.ts';

export type ThemeMode = 'light' | 'dark';

/**
 * A look for the whole app, in the same colors every component already takes its own from. Each
 * is light or dark at heart, which is what the system's own controls and Claude Code's text go by.
 */
export interface Theme {
  /** What data-theme calls it, and what's saved when it's chosen. */
  id: string;
  name: string;
  mode: ThemeMode;
  colors: Palette;
  tones: Readonly<Record<Tone, ToneColors>>;
  terminal: TerminalColors;
}

const baseTones = (mode: ThemeMode) =>
  Object.fromEntries(TONES.map((tone) => [tone, TONE_COLORS[tone][mode]])) as Record<
    Tone,
    ToneColors
  >;

/** What every theme's terminal takes from the rest of its colors. */
const terminalBase = (colors: Palette) => ({
  background: colors.term,
  foreground: colors.termText,
  cursor: colors.accent,
  cursorAccent: colors.term,
  selectionBackground: colors.accentSoft,
});

export const LIGHT_THEME: Theme = {
  id: 'light',
  name: 'Light',
  mode: 'light',
  colors: LIGHT,
  tones: baseTones('light'),
  terminal: TERMINAL_COLORS.light,
};

export const DARK_THEME: Theme = {
  id: 'dark',
  name: 'Dark',
  mode: 'dark',
  colors: DARK,
  tones: baseTones('dark'),
  terminal: TERMINAL_COLORS.dark,
};

const TOKYO_NIGHT_COLORS: Palette = {
  bg: '#16161E',
  bar: '#16161E',
  surface: '#1A1B26',
  sunken: '#1F2335',
  hover: '#24283B',
  border: '#292E42',
  controlBorder: '#737AA2',
  text: '#C0CAF5',
  muted: '#A9B1D6',
  accent: '#7AA2F7',
  accentHover: '#8FB3FA',
  accentInk: '#16161E',
  accentSoft: '#232D4D',
  accentText: '#A4C0FB',
  need: '#FF9E64',
  needSoft: '#3A2A22',
  ok: '#9ECE6A',
  okSoft: '#232E1F',
  bad: '#F7768E',
  badSoft: '#3B2029',
  term: '#16161E',
  termText: '#C0CAF5',
  termMuted: '#A9B1D6',
};

const NORD_COLORS: Palette = {
  bg: '#2A2F3A',
  bar: '#2E3440',
  surface: '#2E3440',
  sunken: '#343B49',
  hover: '#3B4252',
  border: '#434C5E',
  controlBorder: '#8691A8',
  text: '#ECEFF4',
  muted: '#C5CEDD',
  accent: '#88C0D0',
  accentHover: '#9BCDDB',
  accentInk: '#22262F',
  accentSoft: '#344155',
  accentText: '#A5D6E3',
  need: '#EBA98F',
  needSoft: '#473A38',
  ok: '#B4D19C',
  okSoft: '#38443A',
  bad: '#EE9AA3',
  badSoft: '#4A3439',
  term: '#2A2F3A',
  termText: '#E5E9F0',
  termMuted: '#C5CEDD',
};

const CATPPUCCIN_COLORS: Palette = {
  bg: '#181825',
  bar: '#181825',
  surface: '#1E1E2E',
  sunken: '#25253A',
  hover: '#2A2B3C',
  border: '#313244',
  controlBorder: '#7F849C',
  text: '#CDD6F4',
  muted: '#A6ADC8',
  accent: '#CBA6F7',
  accentHover: '#D6B8F9',
  accentInk: '#181825',
  accentSoft: '#332B4A',
  accentText: '#D9BFFA',
  need: '#FAB387',
  needSoft: '#3A2C26',
  ok: '#A6E3A1',
  okSoft: '#243327',
  bad: '#F38BA8',
  badSoft: '#3B2430',
  term: '#181825',
  termText: '#CDD6F4',
  termMuted: '#A6ADC8',
};

const ROSE_PINE_COLORS: Palette = {
  bg: '#191724',
  bar: '#191724',
  surface: '#1F1D2E',
  sunken: '#26233A',
  hover: '#2A2740',
  border: '#312E47',
  controlBorder: '#7E7A99',
  text: '#E0DEF4',
  muted: '#AEAAC6',
  accent: '#C4A7E7',
  accentHover: '#D2BBEE',
  accentInk: '#191724',
  accentSoft: '#2E2A47',
  accentText: '#D5C2F0',
  need: '#F6C177',
  needSoft: '#3A2F22',
  ok: '#9CCFD8',
  okSoft: '#21333A',
  bad: '#EB6F92',
  badSoft: '#3A2030',
  term: '#191724',
  termText: '#E0DEF4',
  termMuted: '#AEAAC6',
};

const SOLARIZED_LIGHT_COLORS: Palette = {
  bg: '#F5EFDC',
  bar: '#F5EFDC',
  surface: '#FDF6E3',
  sunken: '#EEE8D5',
  hover: '#EEE8D5',
  border: '#DDD6C1',
  controlBorder: '#7C8889',
  text: '#073642',
  muted: '#4F656C',
  accent: '#1C6FAB',
  accentHover: '#175E92',
  accentInk: '#FDF6E3',
  accentSoft: '#DCE9EE',
  accentText: '#175E92',
  need: '#A83A0E',
  needSoft: '#F8E3CF',
  ok: '#566500',
  okSoft: '#EAEDC8',
  bad: '#BC2825',
  badSoft: '#F9E0D6',
  term: '#FDF6E3',
  termText: '#073642',
  termMuted: '#4F656C',
};

const ROSE_PINE_DAWN_COLORS: Palette = {
  bg: '#FAF4ED',
  bar: '#F6EFE8',
  surface: '#FFFAF3',
  sunken: '#F2E9E1',
  hover: '#F4EDE8',
  border: '#DFDAD9',
  controlBorder: '#8A8599',
  text: '#4A4568',
  muted: '#625E80',
  accent: '#286983',
  accentHover: '#20586F',
  accentInk: '#FFFAF3',
  accentSoft: '#DEEBEE',
  accentText: '#1F5A72',
  need: '#9A4A0A',
  needSoft: '#F8E8D3',
  ok: '#2E7258',
  okSoft: '#DFEFE6',
  bad: '#9A4560',
  badSoft: '#F6E3E6',
  term: '#FAF4ED',
  termText: '#4A4568',
  termMuted: '#625E80',
};

/**
 * Every theme the app offers, in the order it offers them, each made from its project's published
 * colors. Where one of those falls short of WCAG AA on a background the components put it on, the
 * color is moved just far enough to pass, which the contrast test holds them all to.
 */
export const THEMES: readonly Theme[] = [
  LIGHT_THEME,
  DARK_THEME,
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    mode: 'dark',
    colors: TOKYO_NIGHT_COLORS,
    tones: {
      gray: { fg: '#A9B1D6', bg: '#292E42' },
      slate: { fg: '#9AA5CE', bg: '#24283B' },
      violet: { fg: '#BB9AF7', bg: '#2D2A45' },
      blue: { fg: '#7AA2F7', bg: '#1F2A47' },
      teal: { fg: '#73DACA', bg: '#16302F' },
      purple: { fg: '#D7A6FF', bg: '#33264A' },
      green: { fg: '#9ECE6A', bg: '#232E1F' },
      amber: { fg: '#E0AF68', bg: '#33291A' },
      red: { fg: '#F7768E', bg: '#3A2029' },
    },
    terminal: {
      ...terminalBase(TOKYO_NIGHT_COLORS),
      black: '#292E42',
      red: '#F7768E',
      green: '#9ECE6A',
      yellow: '#E0AF68',
      blue: '#7AA2F7',
      magenta: '#BB9AF7',
      cyan: '#7DCFFF',
      white: '#A9B1D6',
      brightBlack: '#2F334D',
      brightRed: '#FF8FA3',
      brightGreen: '#B2DE82',
      brightYellow: '#EBC283',
      brightBlue: '#8FB3FA',
      brightMagenta: '#CBB0F9',
      brightCyan: '#9AD9FF',
      brightWhite: '#C0CAF5',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    mode: 'dark',
    colors: NORD_COLORS,
    tones: {
      gray: { fg: '#D8DEE9', bg: '#3B4252' },
      slate: { fg: '#C5D1E5', bg: '#39465A' },
      violet: { fg: '#CFC2EA', bg: '#40405A' },
      blue: { fg: '#A9C4E4', bg: '#364A63' },
      teal: { fg: '#A5D6D4', bg: '#31474B' },
      purple: { fg: '#D9BFD4', bg: '#453A4C' },
      green: { fg: '#B4D19C', bg: '#38443A' },
      amber: { fg: '#EBCB8B', bg: '#4A4334' },
      red: { fg: '#EE9AA3', bg: '#4A3439' },
    },
    terminal: {
      ...terminalBase(NORD_COLORS),
      black: '#3B4252',
      red: '#EE9AA3',
      green: '#B4D19C',
      yellow: '#EBCB8B',
      blue: '#A9C4E4',
      magenta: '#D5B6CF',
      cyan: '#A5D6E3',
      white: '#D8DEE9',
      brightBlack: '#434C5E',
      brightRed: '#F2AEB5',
      brightGreen: '#C3DCAF',
      brightYellow: '#F0D8A5',
      brightBlue: '#BCD3EC',
      brightMagenta: '#E0C9DC',
      brightCyan: '#BDE3EC',
      brightWhite: '#ECEFF4',
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    mode: 'dark',
    colors: CATPPUCCIN_COLORS,
    tones: {
      gray: { fg: '#BAC2DE', bg: '#313244' },
      slate: { fg: '#A6B5DE', bg: '#2A2D42' },
      violet: { fg: '#B4BEFE', bg: '#2C2E4A' },
      blue: { fg: '#89B4FA', bg: '#1F2C47' },
      teal: { fg: '#94E2D5', bg: '#1B3433' },
      purple: { fg: '#F5C2E7', bg: '#3B2840' },
      green: { fg: '#A6E3A1', bg: '#243327' },
      amber: { fg: '#F9E2AF', bg: '#3A3122' },
      red: { fg: '#F38BA8', bg: '#3B2430' },
    },
    terminal: {
      ...terminalBase(CATPPUCCIN_COLORS),
      black: '#313244',
      red: '#F38BA8',
      green: '#A6E3A1',
      yellow: '#F9E2AF',
      blue: '#89B4FA',
      magenta: '#F5C2E7',
      cyan: '#94E2D5',
      white: '#BAC2DE',
      brightBlack: '#45475A',
      brightRed: '#F5A0B8',
      brightGreen: '#B8E9B4',
      brightYellow: '#FBE9C2',
      brightBlue: '#A0C3FB',
      brightMagenta: '#F8D2ED',
      brightCyan: '#AAE8DE',
      brightWhite: '#CDD6F4',
    },
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    mode: 'dark',
    colors: ROSE_PINE_COLORS,
    tones: {
      gray: { fg: '#C4C2D8', bg: '#2A273F' },
      slate: { fg: '#B4B5D6', bg: '#2A2B42' },
      violet: { fg: '#C4A7E7', bg: '#332E4F' },
      blue: { fg: '#8FC1DC', bg: '#20334A' },
      teal: { fg: '#9CCFD8', bg: '#21333A' },
      purple: { fg: '#EBBCBA', bg: '#3A2A3A' },
      green: { fg: '#A8D8C0', bg: '#1F3530' },
      amber: { fg: '#F6C177', bg: '#3A2F22' },
      red: { fg: '#EB6F92', bg: '#3A2030' },
    },
    terminal: {
      ...terminalBase(ROSE_PINE_COLORS),
      black: '#26233A',
      red: '#EB6F92',
      green: '#9CCFD8',
      yellow: '#F6C177',
      blue: '#7FB7CF',
      magenta: '#C4A7E7',
      cyan: '#EBBCBA',
      white: '#B8B5D0',
      brightBlack: '#403D52',
      brightRed: '#F08CA8',
      brightGreen: '#B5DCE3',
      brightYellow: '#F9D19A',
      brightBlue: '#9BC8DB',
      brightMagenta: '#D2BBEE',
      brightCyan: '#F2D0CE',
      brightWhite: '#E0DEF4',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    mode: 'light',
    colors: SOLARIZED_LIGHT_COLORS,
    tones: {
      gray: { fg: '#4F656C', bg: '#EEE8D5' },
      slate: { fg: '#3F5C6E', bg: '#E3E6DA' },
      violet: { fg: '#5357A8', bg: '#E8E4EE' },
      blue: { fg: '#175E92', bg: '#DCE9EE' },
      teal: { fg: '#17766F', bg: '#DCEEE6' },
      purple: { fg: '#A5286A', bg: '#F5E1E6' },
      green: { fg: '#566500', bg: '#EAEDC8' },
      amber: { fg: '#7D5E00', bg: '#F5EBC4' },
      red: { fg: '#BC2825', bg: '#F9E0D6' },
    },
    terminal: {
      ...terminalBase(SOLARIZED_LIGHT_COLORS),
      black: '#073642',
      red: '#BC2825',
      green: '#566500',
      yellow: '#7D5E00',
      blue: '#1C6FAB',
      magenta: '#B52A6E',
      cyan: '#17766F',
      white: '#EEE8D5',
      brightBlack: '#4F656C',
      brightRed: '#A83A0E',
      brightGreen: '#4E5C00',
      brightYellow: '#715400',
      brightBlue: '#4F52A8',
      brightMagenta: '#A02560',
      brightCyan: '#146860',
      brightWhite: '#F5EFDC',
    },
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    mode: 'light',
    colors: ROSE_PINE_DAWN_COLORS,
    tones: {
      gray: { fg: '#625E80', bg: '#F2E9E1' },
      slate: { fg: '#4F5B7D', bg: '#E8E8EE' },
      violet: { fg: '#6C5290', bg: '#EDE6F2' },
      blue: { fg: '#286983', bg: '#DEEBEE' },
      teal: { fg: '#2B6F78', bg: '#DDEEEE' },
      purple: { fg: '#8A4A8A', bg: '#F3E6F0' },
      green: { fg: '#2E7258', bg: '#DFEFE6' },
      amber: { fg: '#8A5208', bg: '#F8E8D3' },
      red: { fg: '#9A4560', bg: '#F6E3E6' },
    },
    terminal: {
      ...terminalBase(ROSE_PINE_DAWN_COLORS),
      black: '#4A4568',
      red: '#9A4560',
      green: '#2E7258',
      yellow: '#8F5609',
      blue: '#286983',
      magenta: '#7A5F9C',
      cyan: '#33727D',
      white: '#EDE4DC',
      brightBlack: '#625E80',
      brightRed: '#96455E',
      brightGreen: '#266349',
      brightYellow: '#8A5208',
      brightBlue: '#20586F',
      brightMagenta: '#6C5290',
      brightCyan: '#2B636D',
      brightWhite: '#F2E9E1',
    },
  },
];

/** What the user can choose: a theme, or to follow the system's light or dark setting. */
export type ThemeChoice = string;

export const SYSTEM_THEME: ThemeChoice = 'system';

export const isThemeChoice = (value: unknown): value is ThemeChoice =>
  value === SYSTEM_THEME || THEMES.some((theme) => theme.id === value);

/** The theme by its ID, or null for one the app doesn't have, or for following the system. */
export const themeById = (id: string): Theme | null =>
  THEMES.find((theme) => theme.id === id) ?? null;

/** The theme a choice shows, given whether the system is in dark mode. */
export const themeShown = (choice: ThemeChoice, systemDark: boolean): Theme =>
  themeById(choice) ?? (systemDark ? DARK_THEME : LIGHT_THEME);
