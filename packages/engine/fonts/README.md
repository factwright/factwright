# Resume fonts

The templates are designed with Windows fonts: Calibri, Cambria, Segoe UI and Bahnschrift. Macs don't have them. So every resume carries open fonts drawn to the same character widths, and a resume looks the same and breaks its lines in the same places on any computer.

| Files | Stands in for | From | Changes |
|---|---|---|---|
| `factwright-sans-regular`, `-bold`, `-italic` | Calibri. It also supplies symbols the other fonts lack, such as →, in every template | [Carlito](https://github.com/googlefonts/carlito) at `3a810ca` | Trimmed (below) and renamed, since Carlito's license reserves its name |
| `caladea-regular`, `-bold`, `-italic` | Cambria, in the Classic template | [Caladea](https://github.com/huertatipografica/Caladea) at `336a529` | Trimmed |
| `selawik-regular`, `-semibold`, `-bold` | Segoe UI, in the Minimal template | [Selawik](https://github.com/microsoft/Selawik) 1.01 | None: Microsoft's own web fonts |
| `barlow-bold` | Bahnschrift, for display headings in a user's own templates | [Barlow](https://github.com/jpt/barlow) at `dc2940e` | Trimmed |

Carlito, Caladea and Selawik match their Windows fonts' widths. Bahnschrift has no open font with its widths, so Barlow, a similar DIN-style face, takes its place in headings, where it can't move a line break.

**Trimmed** means:
- Kept: Latin letters for Western, Central and Eastern European languages, punctuation, currency signs, arrows and common math signs.
- Removed: other scripts, screen hinting, which PDFs never use, and the characters for letters joined into one, such as "ﬁ" (U+FB01).
- Every kept character has the same width and kerning as in the original.

Factwright Sans, Caladea's italic and Barlow still draw fi, fl and the like as one shape, as the originals do. With no character of its own, that shape goes into the PDF as the letters it was drawn for, so applicant tracking systems read "first", not "ﬁrst". Selawik never had those characters.

A template names the files it carries in its `fonts`, so a user's own template can use any of them.

Word files keep naming the Windows fonts, since Word lays a document out with the reader's own fonts.

## Licenses
All four fonts are under the SIL Open Font License 1.1, which lets them be bundled with Factwright and embedded in the PDFs it makes:
- Factwright Sans, from Carlito: [Carlito-OFL.txt](Carlito-OFL.txt)
- Caladea: [Caladea-OFL.txt](Caladea-OFL.txt)
- Selawik: [Selawik-LICENSE.txt](Selawik-LICENSE.txt)
- Barlow: [Barlow-OFL.txt](Barlow-OFL.txt)

## Rebuilding
[`build.py`](build.py) makes these files with [fontTools](https://github.com/fonttools/fonttools), from a folder holding:
- `Carlito-Regular.ttf`, `Carlito-Bold.ttf` and `Carlito-Italic.ttf`, from Carlito's `fonts/ttf`
- `Caladea-Regular.ttf`, `Caladea-Bold.ttf` and `Caladea-Italic.ttf`, from Caladea's `fonts/ttf`
- `Barlow-Bold.ttf`, from Barlow's `fonts/ttf`
- `selawik/`: the contents of `Selawik_Release.zip`, from Selawik's 1.01 release

```bash
python3 -m venv .venv && .venv/bin/pip install fonttools brotli
.venv/bin/python -I build.py <that folder> packages/engine/fonts
```

Then make the X-ray's test files again, with `pnpm --filter @factwright/xray fixtures`: its tests check that words with fi and fl read as letters in Classic, Minimal, a template of a user's own and plain letters. The desktop app's tests check that no font gives such letters a character of its own.
