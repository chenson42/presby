# Bundled fonts

The nine families the app draws, committed so no build ever asks Google for
them (`next/font/google` made production builds fail at random,
vercel/next.js#99114; see `docs/work-log/2026-11-01-self-host-fonts.md`).
`next/font/local` loads them from `../fonts.ts` (the four type pairings) and
`../../../app/layout.tsx` (Inter).

One file per family: `<family>/<family>-variable.woff2` beside its `OFL.txt`.
All nine are SIL Open Font License 1.1.

## What each file is

- A **variable** font cut from the family's own upstream TTF, roman only, with
  the `wght` axis limited to the range `fonts.ts` / `layout.tsx` declare
  (400-700, 400-600, 400-800, Inter 100-900). Other axes are pinned at their
  default (Open Sans `wdth`, Inter `opsz`).
- Subsetted, per family, to **the union of the subsets Google's CSS2 API serves
  for that family**, so the coverage equals what `next/font/google` gave. The
  candidates are latin, latin-ext, vietnamese, cyrillic, cyrillic-ext, greek,
  greek-ext, math, symbols and hebrew, and each family has only some of them
  (Karla has latin and latin-ext alone; Open Sans has hebrew). The per-subset
  `unicode-range` values are in `subsets.json`.
- All layout features kept (`--layout-features='*'`).

`../font-coverage.test.ts` decodes each woff2 and fails if a subset's sample
code points (Ł ő ș ễ ặ Ж № Ω ...) or the weight axis go missing.

| file | bytes |
|---|---|
| `lora/lora-variable.woff2` | 80,556 |
| `source-sans-3/source-sans-3-variable.woff2` | 126,808 |
| `libre-franklin/libre-franklin-variable.woff2` | 60,908 |
| `public-sans/public-sans-variable.woff2` | 32,156 |
| `bitter/bitter-variable.woff2` | 95,632 |
| `karla/karla-variable.woff2` | 28,404 |
| `montserrat/montserrat-variable.woff2` | 207,872 |
| `open-sans/open-sans-variable.woff2` | 88,536 |
| `inter/inter-variable.woff2` | 181,384 |
| total | 902,256 |

## Two files are renamed (Reserved Font Names)

These files are instanced and subsetted, which makes them *Modified Versions*
under OFL 1.1, and section 3 forbids a Modified Version from using a Reserved
Font Name. Every `OFL.txt` here was checked for a "Reserved Font Name" clause:

| family | Reserved Font Name | what we did |
|---|---|---|
| Lora | `Lora` | renamed to **PP Classic Serif** |
| Source Sans 3 | `Source` | renamed to **PP Classic Sans** |
| Bitter | `Bitter Pro` | nothing: the family we ship is "Bitter", which is not that name |
| the other six | none | nothing |

`rename-rfn.py` rewrites the `name` table's family-naming records (IDs 1, 3, 4,
6, 16, 17, 21, 22) and fails the build if any of the old family names it is given is left in any of them; `font-coverage.test.ts` checks the Reserved Font Name itself in every record but ID 0. Name ID 0, the copyright notice ("... with Reserved Font Name ..."),
is **kept exactly as upstream wrote it**: the licence requires the notice, and
it is a statement, not a use of the name. Nothing visible changes: the CSS
family name comes from `next/font`'s variable, never from the font's own name,
and the outlines, metrics, kerning and variation data are untouched (compared
table by table against the pre-rename files: `cmap`, `glyf`, `gvar`, `GSUB`,
`GPOS`, `hmtx`, `fvar`, `HVAR`, `STAT`, `OS/2`, `hhea` and `maxp` identical;
`head` differs only in its checksum and timestamp). `../font-coverage.test.ts`
fails if a Reserved Font Name reappears in a name record.

## Rebuilding

Needs `python3` and `curl`. `fonttools` and `brotli` install into a throwaway
venv; they are a local tool, **not** a repository dependency.

```sh
export WORK=$(mktemp -d)     # must be outside the repository
bash src/lib/brand/font-files/build-fonts.sh
```

It:

1. Downloads each `Family[wght].ttf` (Open Sans `[wdth,wght]`, Inter
   `[opsz,wght]`) from
   `https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/<dir>/<file>`,
   where `<dir>` is `lora`, `sourcesans3`, `librefranklin`, `publicsans`,
   `bitter`, `karla`, `montserrat`, `opensans` or `inter` (the commit of
   `github.com/google/fonts` on 2026-11-02).
2. Runs `fonttools varLib.instancer` to limit `wght` and pin other axes.
3. Runs `pyftsubset <ttf> --unicodes=<union of subsets.json> --flavor=woff2
   --layout-features='*'` (fonttools 4.68.0, brotli 1.2.1).
4. Runs `rename-rfn.py` over the Lora and Source Sans 3 outputs (above).

`subsets.json` came from the Google CSS2 API, fetched with a current desktop
Chrome User-Agent, one request per family, for example
`https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400..600&display=swap`
(the other eight: `Lora:wght@400..700`, `Libre+Franklin:wght@400..700`,
`Public+Sans:wght@400..600`, `Bitter:wght@400..700`, `Karla:wght@400..600`,
`Montserrat:wght@400..800`, `Open+Sans:wght@400..600`, `Inter:wght@100..900`).
Each `/* subset */` block's `unicode-range` is recorded under that subset's
name. Re-fetch it only to follow a change in Google's subset definitions.

The output is not guaranteed byte-identical between runs (fonttools versions
and timestamps), so a rebuild changes the committed bytes; the coverage test is
what says it is still right. After a rebuild, update the byte table above.

To add a family or change a weight range: add its row to the list at the end of
`build-fonts.sh`, add its CSS2 subsets to `subsets.json`, fetch its `OFL.txt`
from the same `ofl/<dir>/` path, wire it in `fonts.ts`, and add it to
`FAMILIES` in `../font-coverage.test.ts`.
