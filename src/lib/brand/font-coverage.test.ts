// Pins what the bundled font files can DRAW, not just that they exist.
//
// `next/font/google` emitted an @font-face with a `unicode-range` for every
// subset a family has, so Ł, ő, ș, ễ, Cyrillic and Greek rendered in the brand
// face. The first bundled cut was latin-only and silently dropped all of that
// to Arial (docs/work-log/2026-11-01-self-host-fonts.md, QA run 1). A
// "file exists and starts wOF2" test cannot see that, so this one decodes each
// woff2 and reads its own `cmap` and `fvar`.
//
// Not circular: the expectations below are written out by hand from the
// subsets Google's CSS2 API serves each family (the `/* subset */` comments in
// its response, recorded in font-files/subsets.json), not read back from the
// build script or from the files under test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";

/* ---- a minimal WOFF2 reader: just enough to reach cmap and fvar ---------- */

// The 63 table tags a WOFF2 directory entry can name by index (W3C WOFF2 §5.1).
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ",
  "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp",
  "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF",
  "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL",
  "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc",
  "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx",
  "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readTables(file: Buffer): Map<string, Buffer> {
  if (file.subarray(0, 4).toString("latin1") !== "wOF2") {
    throw new Error("not a woff2 file");
  }
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let pos = 48;
  const entries: { tag: string; size: number }[] = [];
  const base128 = (): number => {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const b = file[pos++];
      n = n * 128 + (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    throw new Error("bad UIntBase128");
  };
  for (let i = 0; i < numTables; i++) {
    const flags = file[pos++];
    const idx = flags & 0x3f;
    const version = flags >> 6;
    let tag: string;
    if (idx === 0x3f) {
      tag = file.subarray(pos, pos + 4).toString("latin1");
      pos += 4;
    } else {
      tag = KNOWN_TAGS[idx];
    }
    const origLength = base128();
    // glyf/loca are transformed at version 0; every other table at version != 0.
    const transformed =
      tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    entries.push({ tag, size: transformed ? base128() : origLength });
  }
  const data = brotliDecompressSync(file.subarray(pos, pos + compressedSize));
  const tables = new Map<string, Buffer>();
  let at = 0;
  for (const { tag, size } of entries) {
    tables.set(tag, data.subarray(at, at + size));
    at += size;
  }
  return tables;
}

/** Every code point the font maps to a real glyph (cmap formats 4 and 12). */
function cmapCodePoints(cmap: Buffer): Set<number> {
  const out = new Set<number>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const off = cmap.readUInt32BE(8 + i * 8);
    const unicode =
      platform === 0 ||
      (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = cmap.readUInt16BE(off);
    if (format === 4) {
      const segs = cmap.readUInt16BE(off + 6) / 2;
      const endAt = off + 14;
      const startAt = endAt + segs * 2 + 2;
      const deltaAt = startAt + segs * 2;
      const rangeAt = deltaAt + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = cmap.readUInt16BE(endAt + s * 2);
        const start = cmap.readUInt16BE(startAt + s * 2);
        const delta = cmap.readUInt16BE(deltaAt + s * 2);
        const rangeOffset = cmap.readUInt16BE(rangeAt + s * 2);
        for (let c = start; c <= end && c < 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
          else {
            const g = cmap.readUInt16BE(
              rangeAt + s * 2 + rangeOffset + (c - start) * 2,
            );
            glyph = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyph !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const start = cmap.readUInt32BE(off + 16 + g * 12);
        const end = cmap.readUInt32BE(off + 20 + g * 12);
        const glyph = cmap.readUInt32BE(off + 24 + g * 12);
        for (let c = start; c <= end; c++) {
          if (glyph + (c - start) !== 0) out.add(c);
        }
      }
    }
  }
  return out;
}

/** The variation axes in `fvar`, as [tag, min, default, max]. */
function axes(fvar: Buffer): [string, number, number, number][] {
  const first = fvar.readUInt16BE(4);
  const n = fvar.readUInt16BE(8);
  const size = fvar.readUInt16BE(10);
  const fixed = (at: number) => fvar.readInt32BE(at) / 65536;
  return Array.from({ length: n }, (_, i) => {
    const at = first + i * size;
    return [
      fvar.subarray(at, at + 4).toString("latin1"),
      fixed(at + 4),
      fixed(at + 8),
      fixed(at + 12),
    ];
  });
}

/* ---- what each family must cover ----------------------------------------- */

// Sample code points per Google subset. Words people actually have in their
// names are the point: Łukasz, Nguyễn, Đặng, Şimić, Őry, Ștefan, Жанна, Ωmega.
const SAMPLE = {
  latin: [0x41, 0x7a, 0x30, 0xe9, 0x2013, 0x2019, 0x2022],
  "latin-ext": [0x141, 0x151, 0x219, 0x10d, 0x101], // Ł ő ș č ā
  vietnamese: [0x1ec5, 0x1eb7], // ễ ặ
  cyrillic: [0x416, 0x2116], // Ж №
  "cyrillic-ext": [0x4d8, 0x4e8], // Ә Ө
  greek: [0x3a9, 0x3b1], // Ω α
  "greek-ext": [0x1f00, 0x1f80], // ἀ ᾀ
  hebrew: [0x5d0], // א
  math: [0x2202, 0x2211], // ∂ ∑
} as const;

type Family = {
  dir: string;
  weight: [number, number];
  // [subset, samples] — only the subsets Google serves this family.
  subsets: [string, readonly number[]][];
};

const S = (...names: (keyof typeof SAMPLE)[]): Family["subsets"] =>
  names.map((n) => [n, SAMPLE[n]]);

const FAMILIES: Family[] = [
  { dir: "lora", weight: [400, 700], subsets: [
      ...S("latin", "latin-ext", "vietnamese", "cyrillic", "math"),
      ["cyrillic-ext", [0x48a, 0x4d8]],
      ["symbols", [0x2219, 0x25ca]],
  ] },
  { dir: "source-sans-3", weight: [400, 600], subsets: [
      ...S("latin", "latin-ext", "vietnamese", "cyrillic", "greek", "greek-ext"),
      ["cyrillic-ext", [0x4d8, 0x4e8]],
  ] },
  { dir: "libre-franklin", weight: [400, 700], subsets: S(
      "latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext") },
  { dir: "public-sans", weight: [400, 600], subsets: [
      ...S("vietnamese", "latin"),
      // 0x1e9e is not in Public Sans; the rest of the Latin Extended sample is.
      ["latin-ext", [0x141, 0x151, 0x219, 0x10d, 0x101]],
  ] },
  { dir: "bitter", weight: [400, 700], subsets: S(
      "latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext") },
  { dir: "karla", weight: [400, 600], subsets: S("latin", "latin-ext") },
  { dir: "montserrat", weight: [400, 800], subsets: S(
      "latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext") },
  { dir: "open-sans", weight: [400, 600], subsets: [
      ...S("latin", "latin-ext", "vietnamese", "cyrillic", "greek", "hebrew", "math"),
      ["cyrillic-ext", [0x460, 0x48a]],
      ["greek-ext", [0x1f4d, 0x1fde]], // Open Sans has only these two
      ["symbols", [0x215b, 0x25ca]],
  ] },
  { dir: "inter", weight: [100, 900], subsets: S(
      "latin", "latin-ext", "vietnamese", "cyrillic", "cyrillic-ext", "greek", "greek-ext") },
];

const filesRoot = path.resolve(__dirname, "font-files");

describe("bundled font coverage", () => {
  it("covers all nine families", () => {
    expect(FAMILIES.map((f) => f.dir).sort()).toEqual(
      [
        "bitter", "inter", "karla", "libre-franklin", "lora", "montserrat",
        "open-sans", "public-sans", "source-sans-3",
      ],
    );
  });

  describe.each(FAMILIES)("$dir", (family) => {
    const tables = readTables(
      readFileSync(path.join(filesRoot, family.dir, `${family.dir}-variable.woff2`)),
    );
    const cps = cmapCodePoints(tables.get("cmap")!);

    it.each(family.subsets)("draws the %s subset (sample code points are mapped)", (_subset, samples) => {
      const missing = samples.filter((c) => !cps.has(c));
      expect(
        missing.map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`),
      ).toEqual([]);
    });

    it("is a variable font whose only axis is wght, spanning the declared weights", () => {
      expect(axes(tables.get("fvar")!).map(([tag, min, , max]) => [tag, min, max])).toEqual([
        ["wght", family.weight[0], family.weight[1]],
      ]);
    });
  });
});

describe("the woff2 reader itself", () => {
  it("rejects a file that is not woff2, so a bad path cannot pass vacuously", () => {
    expect(() => readTables(Buffer.from("not a font at all, definitely"))).toThrow(
      "not a woff2 file",
    );
  });
});
