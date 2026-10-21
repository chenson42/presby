import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor } from "@/lib/brand/contrast";
import { PLATFORM_TOKENS } from "@/lib/brand/contract";
import { EMAIL_PALETTE, renderEmail, type EmailContent } from "./render";

const URL_PLAIN = "https://app.example.invalid/reset-password?a=1&b=2";

const BASE: EmailContent = {
  subject: "Hello",
  heading: "Hello there",
  blocks: [{ kind: "p", text: "A paragraph." }],
};

const FORBIDDEN_WORDS = /vercel|resend|cloudflare|presby-verify|bearer|authorization|token/i;

describe("renderEmail - escaping", () => {
  it("escapes every interpolated value in html once, and keeps text and subject raw", () => {
    const m = renderEmail({
      subject: `Q&A "x" <y> & 'z'`,
      preheader: `pre & <b>`,
      heading: `Head & <i>`,
      blocks: [
        { kind: "p", text: `para & <img src=x onerror=1>` },
        { kind: "facts", rows: [{ label: `La&bel`, value: `Va&lue <script>` }] },
        { kind: "list", label: `Li&st`, items: [`it&em <b>`] },
        { kind: "quote", text: `quo&te <u>` },
      ],
      action: { label: `Go & <go>`, href: URL_PLAIN },
      footnote: `foot & <note>`,
    });

    // Raw characters never reach the html as markup.
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<script");
    expect(m.html).not.toContain("<i>");
    expect(m.html).not.toContain("<b>");
    expect(m.html).not.toContain("<go>");
    // Escaped exactly once: an ampersand is `&amp;`, never `&amp;amp;`.
    expect(m.html).toContain("Head &amp; &lt;i&gt;");
    expect(m.html).toContain("para &amp; &lt;img src=x onerror=1&gt;");
    expect(m.html).toContain("La&amp;bel");
    expect(m.html).toContain("Va&amp;lue &lt;script&gt;");
    expect(m.html).toContain("Li&amp;st");
    expect(m.html).toContain("it&amp;em &lt;b&gt;");
    expect(m.html).toContain("quo&amp;te &lt;u&gt;");
    expect(m.html).toContain("Go &amp; &lt;go&gt;");
    expect(m.html).toContain("foot &amp; &lt;note&gt;");
    expect(m.html).toContain("pre &amp; &lt;b&gt;");
    expect(m.html).not.toContain("&amp;amp;");

    // Text and subject are raw.
    expect(m.text).toContain("Head & <i>");
    expect(m.text).toContain("para & <img src=x onerror=1>");
    expect(m.text).toContain("La&bel: Va&lue <script>");
    expect(m.text).toContain("Li&st\n- it&em <b>");
    expect(m.text).toContain("> quo&te <u>");
    expect(m.text).toContain("Go & <go>:");
    expect(m.text).toContain("foot & <note>");
    expect(m.text).not.toContain("&amp;");
    expect(m.subject).toBe(`Q&A "x" <y> & 'z'`);
  });

  it("turns newlines in user prose into line breaks in html and keeps them in text", () => {
    const m = renderEmail({
      ...BASE,
      blocks: [{ kind: "p", text: "line one\r\nline two" }, { kind: "quote", text: "a\nb" }],
    });
    expect(m.html).toContain("line one<br>line two");
    expect(m.html).toContain("a<br>b");
    expect(m.text).toContain("line one\nline two");
    expect(m.text).not.toContain("\r");
    expect(m.text).toContain("> a\n> b");
  });
});

describe("renderEmail - subject", () => {
  it("collapses CR, LF and whitespace runs to single spaces and trims (header injection)", () => {
    const m = renderEmail({ ...BASE, subject: "  Hello\r\nBcc: x@example.invalid\n\n  there \t" });
    expect(m.subject).toBe("Hello Bcc: x@example.invalid there");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("caps the subject at 200 characters", () => {
    expect(renderEmail({ ...BASE, subject: "x".repeat(500) }).subject).toHaveLength(200);
  });
});

describe("renderEmail - action", () => {
  it("emits the URL as an unchanged substring in href, in the printed link and in text", () => {
    const m = renderEmail({ ...BASE, action: { label: "Open it", href: URL_PLAIN } });
    const escaped = URL_PLAIN.replace(/&/g, "&amp;");
    expect(m.html).toContain(`href="${escaped}"`);
    // Printed visible link text (between > and </a>) carries the same string.
    expect(m.html).toContain(`>${escaped}</a>`);
    expect(m.text).toContain(`\n${URL_PLAIN}\n`);
    // A later replaceAll of the escaped and raw forms rewrites every occurrence.
    const rewritten = m.html.replaceAll(escaped, "https://other.example.invalid/x");
    expect(rewritten).not.toContain("app.example.invalid");
    expect(m.text.replaceAll(URL_PLAIN, "https://other.example.invalid/x")).not.toContain("app.example.invalid");
    // The URL is never soft-wrapped or zero-width-padded.
    expect(m.html).not.toMatch(/[​‌‍⁠﻿]/);
    expect(m.text).not.toMatch(/[​‌‍⁠﻿]/);
  });

  it("prints the label on a button and the label with the URL in text", () => {
    const m = renderEmail({ ...BASE, action: { label: "Open it", href: URL_PLAIN } });
    expect(m.html).toContain(">Open it</a>");
    expect(m.text).toContain(`Open it:\n${URL_PLAIN}`);
  });

  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<b>x</b>"],
    ["/admin/feedback"],
    ["//evil.example.invalid/x"],
    ["ftp://example.invalid/x"],
    ["not a url"],
    ["https://example.invalid/a b"],
    ["https://example.invalid/\u0000"],
    ['https://example.invalid/"onmouseover="x'],
    ["https://example.invalid/<x>"],
    [""],
  ])("throws on the href %j", (href) => {
    expect(() => renderEmail({ ...BASE, action: { label: "Go", href } })).toThrow(/absolute http\(s\) URL/);
  });

  it("does not echo a rejected href in the error", () => {
    expect(() => renderEmail({ ...BASE, action: { label: "Go", href: "javascript:secret-value" } })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("secret-value") }),
    );
  });

  it("omits the button and the printed link when there is no action", () => {
    const m = renderEmail(BASE);
    expect(m.html).not.toContain("copy and paste");
    expect(m.text).not.toMatch(/https?:/);
  });
});

describe("renderEmail - text part", () => {
  it("is generated from the structured content, not by stripping html", () => {
    const m = renderEmail({
      subject: "S",
      heading: "Heading",
      blocks: [
        { kind: "p", text: "Para one" },
        { kind: "facts", rows: [{ label: "From", value: "A <a@example.invalid>" }] },
        { kind: "list", label: "Domains:", items: ["a.invalid", "b.invalid"] },
      ],
      action: { label: "Go", href: "https://example.invalid/x" },
      footnote: "Ignore if unexpected.",
    });
    expect(m.text).toBe(
      [
        "Heading",
        "Para one",
        "From: A <a@example.invalid>",
        "Domains:\n- a.invalid\n- b.invalid",
        "Go:\nhttps://example.invalid/x",
        "Ignore if unexpected.",
        "--\nThis message was sent automatically by PresbyPortal.",
      ].join("\n\n"),
    );
    expect(m.text).not.toMatch(/<(p|div|td|strong|br)\b/);
  });

  it("is always present, even for a minimal message", () => {
    expect(renderEmail(BASE).text.length).toBeGreaterThan(0);
  });
});

describe("renderEmail - markup (R12)", () => {
  const m = renderEmail({
    ...BASE,
    blocks: [
      { kind: "p", text: "x" },
      { kind: "facts", rows: [{ label: "a", value: "b" }] },
      { kind: "list", items: ["i"] },
      { kind: "quote", text: "q" },
    ],
    action: { label: "Go", href: "https://example.invalid/x" },
    footnote: "f",
  });

  it("uses inline styles only: no style element, no image, no script, no remote asset", () => {
    expect(m.html).not.toMatch(/<\s*style/i);
    expect(m.html).not.toMatch(/<\s*img/i);
    expect(m.html).not.toMatch(/<\s*script/i);
    expect(m.html).not.toMatch(/<\s*link\b/i);
    expect(m.html).not.toMatch(/url\(/i);
  });

  it("declares the single colour scheme it ships", () => {
    expect(m.html).toContain('<meta name="color-scheme" content="light">');
    expect(m.html).toContain('<meta name="supported-color-schemes" content="light">');
  });

  it("carries a hidden preheader, a text wordmark and the generic footer", () => {
    expect(m.html).toContain("display:none");
    expect(m.html).toContain(">PresbyPortal</td>");
    expect(m.html).toContain("This message was sent automatically by PresbyPortal.");
  });

  it("defaults the preheader to the heading and honours an explicit one", () => {
    expect(renderEmail({ ...BASE, heading: "H1 text" }).html).toMatch(/display:none[^>]*>H1 text</);
    expect(renderEmail({ ...BASE, preheader: "Preview me" }).html).toMatch(/display:none[^>]*>Preview me</);
  });

  it("gives every layout table role=presentation and builds them all through one annotated helper", () => {
    const tables = m.html.match(/<\s*table\b[^>]*>/gi) ?? [];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t).toContain('role="presentation"');

    const src = readFileSync(path.join(__dirname, "render.ts"), "utf8").split("\n");
    const opens = src
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /<\s*table\b/i.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
    expect(opens).toHaveLength(1);
    expect(src[opens[0]!.i - 1]).toMatch(/\/\/\s*ui-ok:/);
  });

  it("puts explicit bgcolor and color on every structural block", () => {
    expect(m.html).toContain(`bgcolor="${EMAIL_PALETTE.navy}"`);
    expect(m.html).toContain(`bgcolor="${EMAIL_PALETTE.white}"`);
    expect(m.html).toContain(`bgcolor="${EMAIL_PALETTE.surface}"`);
    expect(m.html).toContain(`bgcolor="${EMAIL_PALETTE.blue}"`);
    // Every td carries a background-color; every text element carries a color.
    for (const td of m.html.match(/<td\b[^>]*>/g) ?? []) {
      expect(td).toMatch(/bgcolor="#[0-9a-f]{6}"/);
      expect(td).toMatch(/background-color:#[0-9a-f]{6}/);
    }
    for (const el of m.html.match(/<(p|h1|li|a|div)\b[^>]*style="[^"]*"[^>]*>/g) ?? []) {
      expect(el).toMatch(/(^|[;"\s])color:#[0-9a-f]{6}/);
    }
  });
});

describe("renderEmail - palette (R12, rule 7)", () => {
  const light = PLATFORM_TOKENS.light;

  it("every palette value equals its platform token", () => {
    const pairs: Array<[string, string]> = [
      [EMAIL_PALETTE.white, light["--background"]],
      [EMAIL_PALETTE.navy, light["--foreground"]],
      [EMAIL_PALETTE.blue, light["--primary"]],
      [EMAIL_PALETTE.surface, light["--secondary"]],
      [EMAIL_PALETTE.muted, light["--muted-foreground"]],
      [EMAIL_PALETTE.rule, light["--border"]],
    ];
    for (const [hex, token] of pairs) expect(parseColor(hex)).toEqual(parseColor(token));
  });

  it("body text pairs clear 7:1", () => {
    expect(contrastRatio(EMAIL_PALETTE.navy, EMAIL_PALETTE.white)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(EMAIL_PALETTE.navy, EMAIL_PALETTE.surface)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(EMAIL_PALETTE.white, EMAIL_PALETTE.navy)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(EMAIL_PALETTE.muted, EMAIL_PALETTE.white)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(EMAIL_PALETTE.muted, EMAIL_PALETTE.surface)).toBeGreaterThanOrEqual(7);
  });

  it("button label and link pairs clear the platform's own 4.5:1 floor (D2)", () => {
    // PLATFORM_TOKENS records white on blue at 6.84, below 7:1 but above D2.
    expect(contrastRatio(EMAIL_PALETTE.white, EMAIL_PALETTE.blue)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(EMAIL_PALETTE.blue, EMAIL_PALETTE.white)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("renderEmail - fixed chrome (R13, giving notice B5)", () => {
  const empty = renderEmail({ subject: "", heading: "", blocks: [] });
  const all = [empty.subject, empty.html, empty.text];

  it("contains no dollar sign, no decimal number and no thousands-separated number", () => {
    for (const part of all) {
      expect(part).not.toContain("$");
      expect(part).not.toMatch(/\d+\.\d{2}/);
      expect(part).not.toMatch(/\d{1,3}(,\d{3})+/);
    }
  });

  it("contains no year", () => {
    for (const part of all) expect(part).not.toMatch(/\b(19|20)\d{2}\b/);
  });

  it("avoids the words the domain notification tests forbid, and any image or style element", () => {
    for (const part of all) expect(part).not.toMatch(FORBIDDEN_WORDS);
    expect(empty.html).not.toMatch(/<\s*img/i);
    expect(empty.html).not.toMatch(/<\s*style/i);
  });

  it("carries no address, phone number or unsubscribe link", () => {
    for (const part of all) {
      expect(part).not.toMatch(/@/);
      expect(part).not.toMatch(/\d{3}[-. ]\d{3,4}/);
      expect(part).not.toMatch(/unsubscribe/i);
    }
  });
});

// ---------------------------------------------------------------------------
// The brand scan (R10). `RenderedEmail` can only be produced by renderEmail();
// a cast anywhere else would defeat the type. Comment lines are skipped.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("RenderedEmail brand scan", () => {
  const SRC = path.resolve(__dirname, "..", "..");
  const RENDER = path.join(SRC, "lib", "email", "render.ts");
  const CAST = /\bas\s+(?:unknown\s+as\s+)?RenderedEmail\b|(?<![\w$>\]])<RenderedEmail>\s*[\w({["'`]/;

  it("no file under src/ casts to RenderedEmail except render.ts", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      // render.ts is the one legitimate caster; this file quotes the casts as fixtures.
      if (file === RENDER || path.basename(file) === "render.test.ts") continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (CAST.test(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the scan itself catches the casts it exists for", () => {
    expect(CAST.test("const m = x as RenderedEmail;")).toBe(true);
    expect(CAST.test("const m = x as unknown as RenderedEmail;")).toBe(true);
    expect(CAST.test("const m = <RenderedEmail>x;")).toBe(true);
    expect(CAST.test("function f(): Promise<RenderedEmail> {")).toBe(false);
    expect(CAST.test("const a: Array<RenderedEmail> = [];")).toBe(false);
  });
});
