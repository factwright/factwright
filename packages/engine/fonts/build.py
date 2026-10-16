"""Builds the resume fonts: trims Carlito, Caladea and Barlow to the characters resumes use,
renames the trimmed Carlito (its license reserves the name), and copies Selawik's web fonts as is.
Usage: python -I build.py <downloads dir> <output dir>"""
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

# Latin (Western, Central and Eastern European), punctuation, currency, arrows, common math.
# Not the characters for joined letters, such as "ﬁ" (U+FB01). The fonts still draw fi, fl, ff,
# ffi and ffl as one shape, at the same widths, but a shape with no character of its own goes
# into the PDF as the letters it was drawn for, so applicant tracking systems read "first", not
# "ﬁrst".
UNICODES = (
    "U+0020-007E,U+00A0-017F,U+0192,U+0218-021B,U+0237,U+02BB-02BC,U+02C6-02C7,U+02C9,"
    "U+02D8-02DD,U+1E9E,U+2000-206F,U+2070-209F,U+20AC,U+20B9,U+2100-215F,U+2190-2199,"
    "U+2202,U+2206,U+220F,U+2211-2215,U+2219-221A,U+221E,U+222B,U+2248,U+2260,U+2264-2265,"
    "U+25A0-25A1,U+25AA-25AB,U+25CA,U+25CB,U+25CF,U+FEFF,U+FFFD"
)


def trim(source: Path, target: Path, rename: tuple[str, str] | None = None) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False  # The printer makes PDFs, which never use screen hinting.
    options.name_IDs = ["*"]  # Keep the copyright, license and description records.
    options.notdef_outline = True
    font = TTFont(source)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    if rename:
        old, new = rename
        for record in font["name"].names:
            text = record.toUnicode()
            if record.nameID in (1, 3, 4, 16, 18, 21) and old in text:
                record.string = text.replace(old, new)
            elif record.nameID == 6 and old.replace(" ", "") in text:
                record.string = text.replace(old.replace(" ", ""), new.replace(" ", ""))
    font.flavor = "woff2"
    font.save(target)


for style, file in (("Regular", "regular"), ("Bold", "bold"), ("Italic", "italic")):
    trim(src / f"Carlito-{style}.ttf", out / f"factwright-sans-{file}.woff2", ("Carlito", "Factwright Sans"))
for style, file in (("Regular", "regular"), ("Bold", "bold"), ("Italic", "italic")):
    trim(src / f"Caladea-{style}.ttf", out / f"caladea-{file}.woff2")
trim(src / "Barlow-Bold.ttf", out / "barlow-bold.woff2")
for name, file in (("selawk", "regular"), ("selawksb", "semibold"), ("selawkb", "bold")):
    shutil.copyfile(src / "selawik" / f"{name}.woff2", out / f"selawik-{file}.woff2")
