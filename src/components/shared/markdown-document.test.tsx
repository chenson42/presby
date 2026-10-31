// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MarkdownDocument, type MarkdownDocumentProps } from "./markdown-document";
import { extractHeadings } from "@/lib/help/headings";

afterEach(cleanup);

const internalOnly: MarkdownDocumentProps["resolveLink"] = (href) =>
  href.startsWith("/help") ? { kind: "internal", href } : href.startsWith("https://github.com/") ? { kind: "external", href } : null;
const imagesById: MarkdownDocumentProps["resolveImage"] = (src) =>
  src === "shot:known" ? { src: "/_next/static/known.png", width: 640, height: 480 } : null;

function view(markdown: string, headingBase: 1 | 2 = 2) {
  return render(
    <MarkdownDocument markdown={markdown} resolveLink={internalOnly} resolveImage={imagesById} headingBase={headingBase} />,
  );
}

describe("MarkdownDocument — contract", () => {
  it("has no rehypePlugins prop: rehype-raw cannot be passed in", () => {
    // @ts-expect-error the prop does not exist on the renderer
    const props: MarkdownDocumentProps = { markdown: "", resolveLink: internalOnly, resolveImage: imagesById, headingBase: 2, rehypePlugins: [] };
    expect(props).toBeTruthy();
  });

  it("renders raw HTML as text, never as elements", () => {
    const { container } = view('Before <script>alert(1)</script> <img src="x" onerror="alert(1)"> after');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("renders a link the resolver does not admit as text with no anchor", () => {
    const { container } = view("[sketchy](https://example.org/x) and [mine](/help/signing-in)");
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/help/signing-in");
    expect(container.textContent).toContain("sketchy");
  });

  it("renders javascript: and data: links as plain text", () => {
    const { container } = view("[one](javascript:alert(1)) [two](data:text/html;base64,AAAA)");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("one");
    expect(container.textContent).toContain("two");
  });

  it("marks an external link: new tab, noreferrer noopener, a spoken cue and an aria-hidden icon", () => {
    const { container } = view("[the project](https://github.com/example/repo)");
    const a = container.querySelector("a") as HTMLAnchorElement;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer noopener");
    expect(a.querySelector(".sr-only")?.textContent).toBe(" (opens in a new tab)");
    expect(a.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders no anchor for an autolinked bare URL the resolver refuses", () => {
    const { container } = view("See https://tracker.example.net/pixel for details");
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("MarkdownDocument — images", () => {
  it("renders an admitted image as a plain img with size, alt and lazy loading", () => {
    const { container } = view("![The sign-in form](shot:known)");
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/_next/static/known.png");
    expect(img.getAttribute("width")).toBe("640");
    expect(img.getAttribute("height")).toBe("480");
    expect(img.getAttribute("alt")).toBe("The sign-in form");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.className).toContain("h-auto");
    expect(img.className).toContain("max-w-full");
  });

  it("renders nothing for a remote or unknown source", () => {
    const { container } = view("![pixel](https://tracker.example.net/p.gif) ![nope](shot:missing) ![js](javascript:alert(1))");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("MarkdownDocument — headings", () => {
  it("clamps '#' to the base and renders '##'..'######' as h2..h6 (base 2)", () => {
    const { container } = view("# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f");
    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect([...container.querySelectorAll("h2,h3,h4,h5,h6")].map((h) => h.tagName)).toEqual(["H2", "H2", "H3", "H4", "H5", "H6"]);
  });

  it("with base 1, '#' is the one h1", () => {
    const { container } = view("# Title\n\n## Part", 1);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelectorAll("h2")).toHaveLength(1);
  });

  it("gives every heading the id extractHeadings gives it, de-duplicated (parity)", () => {
    const md = "## First steps\n\n### Details\n\n## First steps\n\n## Why can't I see this?\n\n```\n## not a heading\n```\n\n## `Code` and [a link](/help/x)";
    const { container } = view(md);
    const rendered = [...container.querySelectorAll("h2,h3,h4,h5,h6")].map((h) => h.id);
    expect(rendered).toEqual(extractHeadings(md).map((h) => h.id));
    expect(rendered).toContain("first-steps-2");
  });
});

describe("MarkdownDocument — type scale and structure", () => {
  const md = "Paragraph.\n\n- one\n- two\n\n1. step\n2. step\n\n> a note\n\n`code`\n\n## Head\n\n### Sub\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";

  it("uses the platform scale and none of prose, text-xs, arbitrary sizes or palette literals", () => {
    const { container } = view(md);
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bprose\b/);
    expect(html).not.toMatch(/\btext-xs\b/);
    expect(html).not.toMatch(/text-\[/);
    expect(html).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|amber|zinc|gray|slate|neutral|stone|yellow|orange|purple|pink)-\d/);
    expect(container.querySelector("p")?.className).toContain("text-base");
    expect(container.querySelector("p")?.className).toContain("leading-7");
    expect(container.querySelector("h2")?.className).toContain("text-xl");
    expect(container.querySelector("h3")?.className).toContain("text-lg");
  });

  it("renders steps as ol and lists as ul", () => {
    const { container } = view(md);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
  });

  it("renders a table in a focusable, labelled scroll region through the Table primitive", () => {
    const { container } = view(md);
    const region = container.querySelector('[data-slot="table-container"]') as HTMLElement;
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("Table. Scroll sideways to see all of it.");
    expect(region.className).toContain("overflow-x-auto");
    expect(region.querySelector("table th")?.textContent).toBe("A");
    expect(region.querySelectorAll("tbody td")).toHaveLength(2);
  });

  it("lets a 200-character unbroken token wrap instead of widening the page", () => {
    const { container } = view(`x${"a".repeat(200)}`);
    expect((container.firstElementChild as HTMLElement).className).toContain("break-words");
    expect((container.firstElementChild as HTMLElement).className).toContain("min-w-0");
  });
});

describe("MarkdownDocument — an email link", () => {
  const withEmail: MarkdownDocumentProps["resolveLink"] = (href) =>
    href === "mailto:privacy@example.invalid" ? { kind: "email", href } : null;

  it("renders a plain anchor: same tab, no new-window cue, no external icon", () => {
    const { container } = render(
      <MarkdownDocument
        markdown="Email us at [privacy@example.invalid](mailto:privacy@example.invalid)."
        resolveLink={withEmail}
        resolveImage={imagesById}
        headingBase={2}
      />,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("mailto:privacy@example.invalid");
    expect(a?.getAttribute("target")).toBeNull();
    expect(a?.getAttribute("rel")).toBeNull();
    expect(a?.querySelector("svg")).toBeNull();
    expect(a?.textContent).toBe("privacy@example.invalid");
  });

  it("renders any other mailto: as text with no anchor", () => {
    const { container } = render(
      <MarkdownDocument
        markdown="[someone](mailto:someone@example.invalid)"
        resolveLink={withEmail}
        resolveImage={imagesById}
        headingBase={2}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("someone");
  });
});
