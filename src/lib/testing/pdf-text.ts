/**
 * A minimal PDF text extractor for the statement tests - TEST SUPPORT ONLY,
 * never imported by application code. It understands exactly what pdfkit emits
 * for an embedded TrueType font (Type0 / Identity-H, a ToUnicode CMap per font,
 * Flate-compressed content streams): enough to prove "the page says X" without
 * a PDF-parsing dependency.
 *
 * `extractPdfPages(buffer)` returns, per page in page-tree order, the lines of
 * text drawn on it (one entry per positioned text run, in drawing order).
 */
import { inflateSync } from "node:zlib";

const REPLACEMENT = String.fromCharCode(0xfffd);

interface PdfObject {
  dict: string;
  data: Buffer | null;
}

function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj/g;
  let match: RegExpExecArray | null;
  while ((match = header.exec(text))) {
    const id = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const streamAt = text.indexOf("stream", bodyStart);
    const endObjAt = text.indexOf("endobj", bodyStart);
    // The object has a stream when the first "stream" token comes before its "endobj".
    if (streamAt !== -1 && (endObjAt === -1 || streamAt < endObjAt)) {
      const dict = text.slice(bodyStart, streamAt);
      const length = Number(/\/Length (\d+)/.exec(dict)?.[1] ?? "0");
      let start = streamAt + "stream".length;
      if (text[start] === "\r") start += 1;
      if (text[start] === "\n") start += 1;
      let data: Buffer = pdf.subarray(start, start + length);
      if (/\/FlateDecode/.test(dict)) data = inflateSync(data);
      objects.set(id, { dict, data });
      header.lastIndex = start + length;
    } else {
      objects.set(id, { dict: text.slice(bodyStart, endObjAt), data: null });
      header.lastIndex = endObjAt === -1 ? text.length : endObjAt;
    }
  }
  return objects;
}

/** gid (as 4 hex digits) -> unicode string, from a ToUnicode CMap. */
function parseToUnicode(cmap: string): Map<string, string> {
  const map = new Map<string, string>();
  const u16 = (hex: string) => {
    let out = "";
    for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return out;
  };
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const row of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]+>)/gi)) {
      const lo = parseInt(row[1]!, 16);
      const target = row[3]!;
      if (target.startsWith("[")) {
        // An entry may hold several UTF-16 units separated by spaces (a ligature: <0066 0069>).
        [...target.matchAll(/<([0-9a-f\s]*)>/gi)].forEach((m, i) =>
          map.set((lo + i).toString(16).padStart(4, "0"), u16(m[1]!.replace(/\s+/g, ""))),
        );
      } else {
        const hi = parseInt(row[2]!, 16);
        const base = parseInt(target.slice(1, -1), 16);
        for (let c = lo; c <= hi; c += 1) map.set(c.toString(16).padStart(4, "0"), String.fromCharCode(base + (c - lo)));
      }
    }
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const row of block[1]!.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      map.set(row[1]!.toLowerCase().padStart(4, "0"), u16(row[2]!));
    }
  }
  return map;
}

export function extractPdfPages(pdf: Buffer): string[][] {
  const objects = parseObjects(pdf);
  const ref = (text: string, key: string): number | null => {
    const m = new RegExp(`/${key} (\\d+) 0 R`).exec(text);
    return m ? Number(m[1]) : null;
  };
  const pages: number[] = [];
  const root = [...objects.entries()].find(([, o]) => /\/Type \/Pages/.test(o.dict));
  const walk = (id: number) => {
    const obj = objects.get(id);
    if (!obj) return;
    if (/\/Type \/Pages/.test(obj.dict)) {
      const kids = /\/Kids \[([^\]]*)\]/.exec(obj.dict)?.[1] ?? "";
      for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
    } else if (/\/Type \/Page\b/.test(obj.dict)) {
      pages.push(id);
    }
  };
  if (root) walk(root[0]);

  const toUnicodeForFont = new Map<number, Map<string, string>>();
  const fontMap = (fontId: number) => {
    let cached = toUnicodeForFont.get(fontId);
    if (!cached) {
      const toUni = ref(objects.get(fontId)?.dict ?? "", "ToUnicode");
      const data = toUni ? objects.get(toUni)?.data : null;
      cached = data ? parseToUnicode(data.toString("latin1")) : new Map();
      toUnicodeForFont.set(fontId, cached);
    }
    return cached;
  };

  return pages.map((pageId) => {
    const page = objects.get(pageId)!;
    const contents = objects.get(ref(page.dict, "Contents") ?? -1)?.data?.toString("latin1") ?? "";
    const resources = objects.get(ref(page.dict, "Resources") ?? -1)?.dict ?? "";
    const fontNames = new Map<string, number>();
    for (const m of resources.matchAll(/\/(F\d+) (\d+) 0 R/g)) fontNames.set(m[1]!, Number(m[2]));

    const lines: string[] = [];
    let current: Map<string, string> = new Map();
    for (const block of contents.matchAll(/BT([\s\S]*?)ET/g)) {
      const body = block[1]!;
      const fontName = /\/(F\d+) [\d.]+ Tf/.exec(body)?.[1];
      current = fontName && fontNames.has(fontName) ? fontMap(fontNames.get(fontName)!) : current;
      let line = "";
      for (const arr of body.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        for (const hex of arr[1]!.matchAll(/<([0-9a-f]+)>/gi)) {
          for (let i = 0; i < hex[1]!.length; i += 4) {
            line += current.get(hex[1]!.slice(i, i + 4).toLowerCase()) ?? REPLACEMENT;
          }
        }
      }
      for (const hex of body.matchAll(/<([0-9a-f]+)>\s*Tj/gi)) {
        for (let i = 0; i < hex[1]!.length; i += 4) line += current.get(hex[1]!.slice(i, i + 4).toLowerCase()) ?? REPLACEMENT;
      }
      if (line) lines.push(line);
    }
    return lines;
  });
}

/** All text of a PDF, pages separated by a form feed - convenient for `toContain`. */
export function extractPdfText(pdf: Buffer): string {
  return extractPdfPages(pdf)
    .map((lines) => lines.join("\n"))
    .join("\f");
}
