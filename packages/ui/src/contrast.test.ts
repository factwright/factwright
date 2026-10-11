import { describe, expect, it } from 'vitest';
import { CONTROL_CONTRAST, contrastRatio, TEXT_CONTRAST } from './contrast.ts';
import {
  DARK,
  LIGHT,
  type Palette,
  TERMINAL_COLORS,
  type TerminalColors,
  TONE_COLORS,
  TONES,
} from './tokens.ts';

/** The colored text Claude Code writes in either theme. */
const TERMINAL_HUES: readonly (keyof TerminalColors)[] = [
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
];

/** How Claude Code's ANSI themes use the grays: main text, secondary text, and the message bar. */
describe.each([
  ['light', TERMINAL_COLORS.light, ['black', 'brightBlack'], 'white'],
  ['dark', TERMINAL_COLORS.dark, ['brightWhite', 'white'], 'brightBlack'],
] as const)("Claude's panel in %s", (_name, colors, text, bar) => {
  it.each(['foreground', ...text, ...TERMINAL_HUES] as const)(
    '%s text meets WCAG AA on the background',
    (color) => {
      expect(contrastRatio(colors[color], colors.background)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    },
  );

  it.each(text)('%s text meets WCAG AA on the bar behind the user’s message', (color) => {
    expect(contrastRatio(colors[color], colors[bar])).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it('keeps selected text readable', () => {
    expect(contrastRatio(colors.foreground, colors.selectionBackground)).toBeGreaterThanOrEqual(
      TEXT_CONTRAST,
    );
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, either way round', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for a color on itself', () => {
    expect(contrastRatio('#2F4BD0', '#2F4BD0')).toBe(1);
  });

  it('rejects anything but #RRGGBB', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow('Not a #RRGGBB color: #fff');
  });
});

/** Every text color the components put on each background. */
function textPairs(p: Palette): [string, string, string][] {
  return [
    ['text on bg', p.text, p.bg],
    ['text on bar', p.text, p.bar],
    ['text on surface', p.text, p.surface],
    ['text on sunken', p.text, p.sunken],
    ['text on hover', p.text, p.hover],
    ['text on accentSoft', p.text, p.accentSoft],
    ['text on needSoft', p.text, p.needSoft],
    ['muted on bg', p.muted, p.bg],
    ['muted on bar', p.muted, p.bar],
    ['muted on surface', p.muted, p.surface],
    ['muted on sunken', p.muted, p.sunken],
    ['muted on accentSoft', p.muted, p.accentSoft],
    ['accentText on accentSoft', p.accentText, p.accentSoft],
    ['accentText on surface', p.accentText, p.surface],
    ['accentInk on accent', p.accentInk, p.accent],
    ['accentInk on accentHover', p.accentInk, p.accentHover],
    ['need on needSoft', p.need, p.needSoft],
    ['need on surface', p.need, p.surface],
    ['need on bg', p.need, p.bg],
    ['ok on okSoft', p.ok, p.okSoft],
    ['ok on surface', p.ok, p.surface],
    ['bad on badSoft', p.bad, p.badSoft],
    ['bad on surface', p.bad, p.surface],
    ['termText on term', p.termText, p.term],
    ['termMuted on term', p.termMuted, p.term],
    ['accent on term', p.accent, p.term],
  ];
}

describe.each([
  ['light', LIGHT, 'light'],
  ['dark', DARK, 'dark'],
] as const)('the %s theme', (_name, palette, mode) => {
  it.each(textPairs(palette))('%s meets WCAG AA for text', (_pair, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it.each(TONES)('the %s tone meets WCAG AA for text', (tone) => {
    const { fg, bg } = TONE_COLORS[tone][mode];
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it.each([
    ['surface', palette.surface],
    ['bg', palette.bg],
  ])('control borders stand out from %s', (_where, bg) => {
    expect(contrastRatio(palette.controlBorder, bg)).toBeGreaterThanOrEqual(CONTROL_CONTRAST);
  });
});
