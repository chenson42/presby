"""Rename a font so its name table no longer uses a Reserved Font Name.

Usage: rename-rfn.py <woff2> <family> <postscript> <old-name-regex>...

SIL OFL 1.1 section 3: a Modified Version may not use a Reserved Font Name.
Ours are instanced and subsetted, so they are Modified Versions. Lora
(RFN "Lora") and Source Sans 3 (RFN "Source") are renamed; see README.md.

Rewrites name IDs 1, 3, 4, 6, 16, 17, 21 and 22 (the ones that name the
family). ID 0, the copyright notice, is left exactly as upstream wrote it: the
licence requires it to be kept, and it is a notice, not a use of the name.
Exits non-zero if any of the old-name patterns given on the command line is
still present outside ID 0 afterwards. It does not search for the Reserved
Font Name itself: font-coverage.test.ts does that, for every name record but ID 0.
"""
import re
import sys

from fontTools.ttLib import TTFont

path, family, ps, *olds = sys.argv[1:]
pattern = re.compile("|".join(olds))
FAMILY_IDS = {1, 4, 16, 17, 21, 22}
PS_IDS = {3, 6}

font = TTFont(path)
for rec in font["name"].names:
    if rec.nameID in FAMILY_IDS:
        rec.string = pattern.sub(family, rec.toUnicode())
    elif rec.nameID in PS_IDS:
        rec.string = pattern.sub(ps, rec.toUnicode())
font.save(path)

left = [
    (r.nameID, r.toUnicode())
    for r in TTFont(path)["name"].names
    if r.nameID != 0 and pattern.search(r.toUnicode())
]
if left:
    sys.exit(f"{path}: Reserved Font Name still in {left}")
print(f"renamed {path} -> {family}")
