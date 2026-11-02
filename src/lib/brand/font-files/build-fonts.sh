#!/usr/bin/env bash
# Rebuilds every woff2 in this directory. See README.md. Needs python3 and curl.
# fonttools and brotli install into a throwaway venv under $WORK; they are a
# local tool, not a repository dependency.
#
#   WORK=$(mktemp -d) bash src/lib/brand/font-files/build-fonts.sh
#
# Output goes straight into the family directories next to this script.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:?set WORK to an empty scratch directory outside the repository}
SHA=6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec   # github.com/google/fonts, 2026-11-02

python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q fonttools==4.68.0 brotli==1.2.1
mkdir -p "$WORK/src" "$WORK/inst"

# family-dir  upstream-dir  upstream-file  wght-range  extra-axis-pins
while read -r fam dir file wght pins; do
  enc=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$file")
  curl -sSfL -o "$WORK/src/$fam.ttf" \
    "https://raw.githubusercontent.com/google/fonts/$SHA/ofl/$dir/$enc"
  # Keep the variable weight axis at the range fonts.ts declares; pin any other
  # axis at its default (Open Sans wdth, Inter opsz); roman only, no italic.
  # shellcheck disable=SC2086
  "$WORK/venv/bin/fonttools" varLib.instancer "$WORK/src/$fam.ttf" "wght=$wght" $pins \
    -o "$WORK/inst/$fam.ttf" -q
  # Every subset Google's CSS2 API serves this family, as one unicode set.
  uni=$(python3 -I -c '
import json, sys
d = json.load(open(sys.argv[1]))[sys.argv[2]]
print(",".join(r.replace("U+", "") for v in d.values() for r in v[0].split(",")))
' "$HERE/subsets.json" "$fam")
  "$WORK/venv/bin/pyftsubset" "$WORK/inst/$fam.ttf" --unicodes="$uni" \
    --flavor=woff2 --layout-features='*' \
    --output-file="$HERE/$fam/$fam-variable.woff2"
  echo "$fam $(wc -c < "$HERE/$fam/$fam-variable.woff2") bytes"
done <<'LIST'
lora lora Lora[wght].ttf 400:700
source-sans-3 sourcesans3 SourceSans3[wght].ttf 400:600
libre-franklin librefranklin LibreFranklin[wght].ttf 400:700
public-sans publicsans PublicSans[wght].ttf 400:600
bitter bitter Bitter[wght].ttf 400:700
karla karla Karla[wght].ttf 400:600
montserrat montserrat Montserrat[wght].ttf 400:800
open-sans opensans OpenSans[wdth,wght].ttf 400:600 wdth=100
inter inter Inter[opsz,wght].ttf 100:900 opsz=14
LIST
