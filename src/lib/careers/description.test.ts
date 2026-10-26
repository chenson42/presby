import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prose } from "presby-site-kit";
import { describe, expect, it } from "vitest";
import { checkHref, validateDescription } from "./description";

function ok(raw: string, requireNonEmpty = false): string {
  const result = validateDescription(raw, { requireNonEmpty });
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result.value;
}

function errors(raw: string, requireNonEmpty = false) {
  const result = validateDescription(raw, { requireNonEmpty });
  if (result.ok) throw new Error(`expected errors, got ${JSON.stringify(result.value)}`);
  return result.errors;
}

describe("validateDescription - normalisation", () => {
  it("NFC, CRLF to LF, leading blank lines and trailing space trimmed", () => {
    expect(ok("\r\n \r\nCafé\r\n\r\nSecond\r\n  ")).toBe("Café\n\nSecond");
  });

  it("strips control, bidi and zero-width characters (a name with U+202E)", () => {
    expect(ok("Contact ‮namow‬ at​ the\u0000 office")).toBe("Contact namow at the office");
  });

  it("is idempotent", () => {
    const first = ok("## Heading\r\n\r\nSome ‮text‬ with [a link](https://example.invalid/x)\r\n");
    expect(ok(first)).toBe(first);
  });
});

describe("validateDescription - length", () => {
  it("20,000 characters pass; 20,001 fail", () => {
    expect(ok("a".repeat(20000))).toHaveLength(20000);
    const result = errors("a".repeat(20001));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: "too_long",
      message: "The description is too long. The limit is 20,000 characters.",
    });
  });

  it("counts code points, as Postgres does", () => {
    expect(ok("\u{1F600}".repeat(20000))).toBeTruthy();
    expect(errors("\u{1F600}".repeat(20001))[0]!.code).toBe("too_long");
  });
});

describe("validateDescription - headings", () => {
  it("refuses a single # with its line number and the offending text", () => {
    const [error] = errors("Intro\n\n# Duties\n\nMore");
    expect(error).toMatchObject({ line: 3, code: "heading_single", snippet: "# Duties" });
    expect(error!.message).toBe(
      'Line 3 ("# Duties") starts with a single #. Use the Heading or Subheading button for section titles.',
    );
  });

  it("allows ## and ###", () => {
    expect(ok("## Duties\n\n### Hours")).toBe("## Duties\n\n### Hours");
  });

  it("refuses #### and deeper", () => {
    for (const marker of ["####", "#####", "######"]) {
      const [error] = errors(`${marker} Deep`);
      expect(error, marker).toMatchObject({ line: 1, code: "heading_level" });
      expect(error!.message).toBe(
        `Line 1 ("${marker} Deep") uses a heading level we don't support. Use ## or ###.`,
      );
    }
  });

  it("does not treat what the renderer does not treat as a heading", () => {
    expect(ok("#hashtag\n#######seven")).toBe("#hashtag\n#######seven");
    // Anchored at the line start, as the renderer's is: leading spaces make it a paragraph,
    // and the stored value keeps them so the validated text is the stored text.
    expect(ok("  # indented")).toBe("  # indented");
    expect(ok(ok("\n\n  # indented"))).toBe("  # indented");
  });

  it("shortens a long offending line", () => {
    const [error] = errors(`# ${"x".repeat(100)}`);
    expect(error!.snippet.endsWith("…")).toBe(true);
    expect(Array.from(error!.snippet)).toHaveLength(41);
  });
});

describe("validateDescription - links", () => {
  it.each([
    "https://example.invalid/jobs",
    "http://example.invalid",
    "HTTPS://EXAMPLE.INVALID/Path",
    "mailto:name@example.invalid",
    "https://example.invalid/a?x=1&y=2#frag",
    "https://example.invalid:8443/x",
  ])("accepts %s", (href) => {
    expect(ok(`[apply](${href})`)).toBe(`[apply](${href})`);
  });

  it.each([
    ["javascript:alert(1)", "link_scheme"],
    ["JaVaScRiPt:alert(1)", "link_scheme"],
    ["data:text/html,hi", "link_scheme"],
    ["tel:+15555550100", "link_scheme"],
    ["/relative/path", "link_scheme"],
    ["#fragment", "link_scheme"],
    ["//example.invalid/x", "link_scheme"],
    ["ftp://example.invalid/x", "link_scheme"],
    ["mailto:name@example.invalid?body=x", "link_scheme"],
    ["mailto:name@example.invalid&cc=x", "link_scheme"],
    ["mailto:Name <name@example.invalid>", "link_scheme"],
    ["mailto:nohost", "link_scheme"],
    ["https://user:pass@example.invalid", "link_scheme"],
    ["https://user@example.invalid", "link_scheme"],
    ["https:example.invalid", "link_scheme"],
    ["https:///example.invalid", "link_scheme"],
    ["https:\\\\example.invalid", "link_scheme"],
    [`https://example.invalid/${"a".repeat(1990)}`, "link_scheme"],
    ["", "link_unfinished"],
    ["https://", "link_unfinished"],
    ["http://", "link_unfinished"],
  ])("refuses %s as %s", (href, code) => {
    const found = errors(`[click here](${href})`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code, line: 1, snippet: "click here" });
  });

  it("names a link with whitespace in its address, which the renderer would leave as plain text", () => {
    expect(errors("[x](https://example.invalid/a b)")[0]).toMatchObject({ code: "link_scheme" });
  });

  it("the unfinished-link message and the unusable-link message are Copy S6", () => {
    expect(errors("[Apply here](https://)")[0]!.message).toBe(
      'Line 1: finish the web address for the link "Apply here", or remove the link.',
    );
    expect(errors("[Apply here](javascript:alert(1))")[0]!.message).toBe(
      'Line 1: the link "Apply here" isn\'t a web address we can use. Links can start with https://, http:// or mailto:.',
    );
  });

  it("reports the right line for a link on a later line", () => {
    expect(errors("one\n\ntwo [bad](ftp://x.invalid) three")[0]).toMatchObject({ line: 3 });
  });

  it("reports every problem, in line order", () => {
    const found = errors("[a](ftp://x.invalid)\n# Title\n[b](https://)");
    expect(found.map((e) => [e.line, e.code])).toEqual([
      [1, "link_scheme"],
      [2, "heading_single"],
      [3, "link_unfinished"],
    ]);
  });

  it("a link inside a heading is checked too", () => {
    expect(errors("## See [us](javascript:x)")[0]).toMatchObject({ line: 1, code: "link_scheme" });
  });

  it("text that is not link-shaped is left alone", () => {
    expect(ok("Call (555) 0100 [or visit] our office.")).toBe("Call (555) 0100 [or visit] our office.");
  });
});

describe("validateDescription - emptiness", () => {
  it("an empty description is allowed for a draft", () => {
    expect(ok("")).toBe("");
    expect(ok("   \n\n  ")).toBe("");
  });

  it("is refused when it is required", () => {
    for (const raw of ["", "  \n "]) {
      expect(errors(raw, true)).toEqual([
        { line: 0, snippet: "", code: "empty", message: "Add a description before publishing." },
      ]);
    }
  });
});

describe("checkHref", () => {
  it("is the same rule the validator applies", () => {
    expect(checkHref("https://example.invalid").ok).toBe(true);
    expect(checkHref("tel:+15555550100")).toEqual({ ok: false, code: "link_scheme" });
    expect(checkHref("https://")).toEqual({ ok: false, code: "link_unfinished" });
  });

  it("does not trim: surrounding whitespace fails", () => {
    expect(checkHref(" https://example.invalid").ok).toBe(false);
    expect(checkHref("https://example.invalid ").ok).toBe(false);
  });
});

describe("renderer agreement (T8/T9 pin)", () => {
  const html = (body: string) => renderToStaticMarkup(createElement(Prose, { body }));

  it("every href the validator accepts renders as an <a href>", () => {
    const hrefs = [
      "https://example.invalid/jobs",
      "http://example.invalid",
      "HTTPS://EXAMPLE.INVALID/Path",
      "mailto:name@example.invalid",
      "https://example.invalid/a?x=1&y=2#frag",
    ];
    for (const href of hrefs) {
      const body = ok(`See [the posting](${href}) today.`);
      const rendered = html(body);
      // React escapes & in attributes.
      expect(rendered, href).toContain(`<a href="${href.replace(/&/g, "&amp;")}">the posting</a>`);
    }
  });

  it("an href the validator refuses would NOT have been a safe link, or is not one the renderer links", () => {
    // The renderer is looser: it links tel:, relative and # hrefs. That is why the validator is the stricter gate.
    expect(html("[call](tel:+15555550100)")).toContain('<a href="tel:+15555550100">');
    expect(html("[x](javascript:alert(1))")).not.toContain("<a ");
    expect(errors("[call](tel:+15555550100)")[0]!.code).toBe("link_scheme");
  });

  it("hostile bodies render as inert text", () => {
    for (const body of [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "[x](javascript:alert(1))",
      "**<b>**",
    ]) {
      const rendered = html(body);
      expect(rendered, body).not.toContain("<script");
      expect(rendered, body).not.toContain("<img");
      // "onerror=" may appear as escaped TEXT; it must never be an attribute of an element.
      expect(rendered, body).not.toMatch(/<[^>]*\sonerror=/);
      expect(rendered, body).not.toContain('href="javascript:');
    }
  });
});
