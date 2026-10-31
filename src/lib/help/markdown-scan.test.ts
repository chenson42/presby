import { describe, expect, it } from "vitest";
import { scanMarkdown } from "./markdown-scan";

const scan = scanMarkdown;

describe("headings", () => {
  it("reads ATX headings with level, raw text and 1-based line", () => {
    const s = scan("Intro\n\n# One\n## Two ##\n###### Six\n####### Seven\n#nospace\n");
    expect(s.headings).toEqual([
      { level: 1, text: "One", line: 3 },
      { level: 2, text: "Two", line: 4 },
      { level: 6, text: "Six", line: 5 },
    ]);
  });
  it("reports an empty heading with empty text", () => {
    expect(scan("##\n").headings).toEqual([{ level: 2, text: "", line: 1 }]);
  });
  it("skips fenced code (backtick and tilde) entirely", () => {
    const s = scan("```md\n# hidden\n[a](b)\n<div>\n```\n~~~\n## hidden\n~~~\n## Shown\n");
    expect(s.headings).toEqual([{ level: 2, text: "Shown", line: 9 }]);
    expect(s.links).toEqual([]);
    expect(s.rawHtml).toEqual([]);
  });
  it("treats an unclosed fence as running to the end", () => {
    expect(scan("```\n## hidden\n").headings).toEqual([]);
  });
  it("flags setext headings", () => {
    expect(scan("Title\n=====\n").setext).toHaveLength(1);
    expect(scan("Title\n-----\n").setext).toHaveLength(1);
  });
  it("does not flag a thematic break after a blank line or a table rule", () => {
    expect(scan("Para\n\n---\n").setext).toEqual([]);
    expect(scan("| a | b |\n| --- | --- |\n| 1 | 2 |\n").setext).toEqual([]);
  });
});

describe("links and images", () => {
  it("reads inline links, with a title, a fragment and nested brackets", () => {
    const s = scan('See [one](/help/a#b), [two](/x "Title") and [a [b] c](/y).');
    expect(s.links).toEqual([
      { text: "one", destination: "/help/a#b", line: 1 },
      { text: "two", destination: "/x", line: 1 },
      { text: "a [b] c", destination: "/y", line: 1 },
    ]);
  });
  it("reads a link whose text wraps onto the next line, at the line it starts", () => {
    expect(scan("x [wrapped\ntext](/z) y").links).toEqual([
      { text: "wrapped\ntext", destination: "/z", line: 1 },
    ]);
  });
  it("does not read a link across a blank line", () => {
    expect(scan("[a\n\nb](/z)").links).toEqual([]);
  });
  it("ignores escaped brackets and links inside inline code", () => {
    expect(scan("\\[a](/b) and `[c](/d)`").links).toEqual([]);
  });
  it("reads images separately from links", () => {
    const s = scan("![The form](shot:signin-form) and [t](/signin)");
    expect(s.images).toEqual([{ alt: "The form", source: "shot:signin-form", line: 1 }]);
    expect(s.links).toEqual([{ text: "t", destination: "/signin", line: 1 }]);
  });
  it("reads an image with an empty alt", () => {
    expect(scan("![](shot:a)").images).toEqual([{ alt: "", source: "shot:a", line: 1 }]);
  });
  it("reads links inside table cells and headings", () => {
    const s = scan("## See [x](/a)\n\n| a |\n| - |\n| [y](/b) |\n");
    expect(s.links.map((l) => l.destination)).toEqual(["/a", "/b"]);
  });
  it("does not treat [ ] or a lone [text] as a link", () => {
    const s = scan("- [ ] task and [shortcut] text");
    expect(s.links).toEqual([]);
    expect(s.referenceLinks).toEqual([]);
  });
});

describe("the closed subset", () => {
  it("flags reference-style links, definitions and footnotes", () => {
    expect(scan("see [a][b]").referenceLinks).toHaveLength(1);
    expect(scan("see [a][]").referenceLinks).toHaveLength(1);
    expect(scan("[b]: https://x.invalid\n").referenceLinks).toHaveLength(1);
    expect(scan("a[^1]\n").referenceLinks).toHaveLength(1);
  });
  it("flags <https://...> and <a@b> autolinks and does not also count them as raw HTML", () => {
    const s = scan("go <https://x.invalid> or <a@b.invalid>");
    expect(s.autolinks).toHaveLength(2);
    expect(s.rawHtml).toEqual([]);
  });
  it("flags raw HTML: an element, a closing tag, a comment", () => {
    expect(scan("a <b>x</b>").rawHtml).toHaveLength(2);
    expect(scan("<!-- note -->").rawHtml).toHaveLength(1);
    expect(scan("<div>\nx\n</div>").rawHtml.map((f) => f.line)).toEqual([1, 3]);
  });
  it("does not flag a < that is not followed by a letter, nor HTML in inline code, nor an escape", () => {
    expect(scan("1 < 2 and 3 <= 4 and <3").rawHtml).toEqual([]);
    expect(scan("write `<div>` here").rawHtml).toEqual([]);
    expect(scan("a \\<b> c").rawHtml).toEqual([]);
  });
  it("flags bare URLs and emails, but not a link destination", () => {
    expect(scan("see https://x.invalid/a now").bareUrls).toHaveLength(1);
    expect(scan("see www.x.invalid now").bareUrls).toHaveLength(1);
    expect(scan("write a@b.invalid now").bareUrls).toHaveLength(1);
    expect(scan("see [x](https://x.invalid/a)").bareUrls).toEqual([]);
    expect(scan("see `https://x.invalid`").bareUrls).toEqual([]);
  });
  it("flags HTML entities left in prose but not an ampersand", () => {
    expect(scan("Tom &amp; Jerry &#39; &#x27; &rsquo;").entities).toHaveLength(4);
    expect(scan("R&D and Q&A").entities).toEqual([]);
    expect(scan("`&amp;` in code").entities).toEqual([]);
  });
});

describe("prose", () => {
  it("is the markdown with link and image destinations blanked, same length", () => {
    const md = "Read [the page](/help/planned) and ![a](shot:x).";
    const s = scan(md);
    expect(s.prose).toHaveLength(md.length);
    expect(s.prose).not.toContain("/help/planned");
    expect(s.prose).not.toContain("shot:x");
    expect(s.prose).toContain("the page");
  });
  it("keeps fenced and inline code text", () => {
    expect(scan("a `b` c\n```\nd\n```\n").prose).toContain("d");
  });
});
