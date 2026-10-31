import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateDescription } from "@/lib/careers/description";
import { PostingDescription } from "./posting-description";

const html = (body: string) => renderToStaticMarkup(<PostingDescription body={body} />);

describe("PostingDescription - T9 renderer agreement", () => {
  it("renders every href the validator accepts as an <a href>", () => {
    for (const href of [
      "https://example.invalid/jobs",
      "http://example.invalid/a?b=c",
      "mailto:office@example.invalid",
      "HTTPS://example.invalid/upper",
    ]) {
      const body = `[Apply here](${href})`;
      expect(validateDescription(body, { requireNonEmpty: false }).ok, href).toBe(true);
      expect(html(body), href).toContain(`<a href="${href.replace(/&/g, "&amp;")}">Apply here</a>`);
    }
  });

  it("renders headings, lists, emphasis and links as elements", () => {
    const out = html("## Duties\n\n### Hours\n\n- one\n- two\n\n1. first\n2. second\n\n**bold** and *italic*");
    for (const fragment of ["<h2", "<h3", "<ul", "<ol", "<li>one</li>", "<strong>bold</strong>", "<em>italic</em>"]) {
      expect(out, fragment).toContain(fragment);
    }
  });

  it("renders hostile bodies as inert text: no script, no handler, no javascript: link", () => {
    for (const body of [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "[x](javascript:alert(1))",
      "**<b>**",
      "[x](data:text/html;base64,AAAA)",
    ]) {
      const out = html(body);
      expect(out, body).not.toMatch(/<script/i);
      expect(out, body).not.toMatch(/<img/i);
      expect(out, body).not.toMatch(/<[a-z][^>]*\sonerror=/i);
      expect(out, body).not.toMatch(/href="javascript:/i);
      expect(out, body).not.toMatch(/href="data:/i);
    }
  });

  it("emits no .presby-site class and no dangerouslySetInnerHTML, and scopes its own typography", () => {
    const out = html("## A");
    expect(out).not.toContain("presby-site");
    expect(out).toContain("[overflow-wrap:anywhere]");
    expect(out).toContain('data-testid="posting-description"');
  });
});
