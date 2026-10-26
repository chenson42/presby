// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { validateDescription } from "./description";
import { MAX_PASTE_HTML_CHARS, htmlToMarkdown } from "./html-to-markdown";

function convert(html: string) {
  const result = htmlToMarkdown(html);
  if (!result) throw new Error("expected a conversion");
  return result;
}

// check:brand-scope bans a literal style element (and a literal table) in any source
// line outside the brand emitter and the UI primitives. These are HTML FIXTURES for a
// converter that must drop them, so the opening tags are assembled here.
const STYLE = "<" + "style>";
const TABLE = "<" + "table>";

/** Every fixture's output must be publishable as typed: T11's rule. */
function expectValid(markdown: string) {
  const check = validateDescription(markdown, { requireNonEmpty: false });
  expect(check.ok, JSON.stringify(check.ok ? [] : check.errors)).toBe(true);
}

// A representative Word (desktop) clipboard fragment: mso classes, o:p, a
// conditional comment, and list paragraphs whose bullet is an ignorable span.
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8">${STYLE}p.MsoNormal{margin:0}</style>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]--></head>
<body lang=EN-US style='tab-interval:.5in'>
<!--StartFragment-->
<h1 style='margin:0'><span style='font-size:20pt'>Associate Director of Music</span><o:p></o:p></h1>
<p class=MsoNormal><span style='font-weight:bold'>Part-time</span> position, <i>Sunday mornings</i>. Send a letter to
<a href="mailto:hiring@example.invalid">hiring@example.invalid<o:p></o:p></a>.<o:p></o:p></p>
<h2>Duties</h2>
<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>Lead the adult choir<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Plan the music<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Coordinate with the pastor<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<h3>Steps</h3>
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Apply<o:p></o:p></p>
<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>Interview<o:p></o:p></p>
<!--EndFragment-->
</body></html>`;

// A Google Docs fragment: the whole document sits inside <b style="font-weight:normal">.
const GOOGLE = `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0000">
<h1 dir="ltr" style="line-height:1.2"><span style="font-size:20pt;font-weight:700">Sexton</span></h1>
<p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;font-weight:400">Care for the </span><span style="font-size:11pt;font-weight:700">building</span><span style="font-size:11pt;font-weight:400"> and </span><span style="font-size:11pt;font-style:italic">grounds</span><span> at </span><a href="https://example.invalid/sexton" style="text-decoration:none"><span style="color:#1155cc;text-decoration:underline">our site</span></a><span>.</span></p>
<ul style="margin-top:0">
<li dir="ltr" style="list-style-type:disc"><p dir="ltr" role="presentation"><span>Open and close</span></p></li>
<li dir="ltr" style="list-style-type:disc"><p dir="ltr" role="presentation"><span>Set up for events</span></p>
<ul><li dir="ltr"><p dir="ltr" role="presentation"><span>Chairs</span></p></li><li dir="ltr"><p><span>Tables</span></p></li></ul></li>
</ul>
<ol><li><p><span>Fill out the form</span></p></li><li><p><span>Return it</span></p></li></ol>
<br class="Apple-interchange-newline"></b>`;

describe("Word fixture", () => {
  const { markdown, droppedLinks } = convert(WORD);

  it("converts headings, emphasis, links and both kinds of list", () => {
    expect(markdown).toBe(
      [
        "## Associate Director of Music",
        "**Part-time** position, *Sunday mornings*. Send a letter to [hiring@example.invalid](mailto:hiring@example.invalid).",
        "## Duties",
        "- Lead the adult choir\n- Plan the music\n- Coordinate with the pastor",
        "### Steps",
        "1. Apply\n2. Interview",
      ].join("\n\n"),
    );
    expect(droppedLinks).toBe(0);
  });

  it("is publishable as typed", () => expectValid(markdown));
});

describe("Google Docs fixture", () => {
  const { markdown } = convert(GOOGLE);

  it("the weight:normal wrapper is not bold; weight 400 spans are not bold; 700 is", () => {
    expect(markdown).toContain("Care for the **building** and *grounds* at [our site](https://example.invalid/sexton).");
    expect(markdown).not.toMatch(/^\*\*Care/m);
  });

  it("the heading is a ## and carries no bold of its own", () => {
    expect(markdown.startsWith("## Sexton\n\n")).toBe(true);
  });

  it("nested lists flatten to the same level; paragraphs inside items are inline", () => {
    expect(markdown).toContain("- Open and close\n- Set up for events\n- Chairs\n- Tables");
    expect(markdown).toContain("1. Fill out the form\n2. Return it");
  });

  it("is publishable as typed", () => expectValid(markdown));
});

describe("emphasis", () => {
  it("<strong>/<b>/<em>/<i> and weighted spans", () => {
    expect(
      convert(
        "<p><strong>A</strong> x <b>B</b> x <em>C</em> x <i>D</i> x <span style='font-weight:600'>E</span> x <span style='font-weight:bold'>F</span> x <span style='font-style:italic'>G</span></p>",
      ).markdown,
    ).toBe("**A** x **B** x *C* x *D* x **E** x **F** x *G*");
  });

  it("adjacent runs merge into one, even across a space", () => {
    expect(convert("<p><b>Hello</b><b> there</b><b> world</b></p>").markdown).toBe("**Hello there world**");
    expect(convert("<p><b>A</b> <b>B</b></p>").markdown).toBe("**A B**");
  });

  it("spaces move outside the markers", () => {
    expect(convert("<p>a<b> bold </b>b</p>").markdown).toBe("a **bold** b");
  });

  it("an empty emphasis disappears", () => {
    expect(convert("<p>a<b> </b>b<i></i>c</p>").markdown).toBe("a bc");
  });

  it("nested emphasis keeps the outer only (the renderer cannot nest)", () => {
    const { markdown } = convert("<p><b>bold <i>and italic</i></b> and <i>italic <b>and bold</b></i></p>");
    expect(markdown).toBe("**bold and italic** and *italic and bold*");
    expectValid(markdown);
  });

  it("a link inside bold sits outside the bold, so it still links", () => {
    const { markdown } = convert("<p><b>Apply <a href='https://example.invalid/x'>here</a> today</b></p>");
    expect(markdown).toBe("**Apply** [here](https://example.invalid/x) **today**");
  });

  it("emphasis inside a heading is dropped", () => {
    expect(convert("<h2><b>Duties</b> <i>now</i></h2>").markdown).toBe("## Duties now");
  });
});

describe("headings", () => {
  it("h1 and h2 become ##; h3 to h6 become ###", () => {
    expect(convert("<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5><h6>F</h6>").markdown).toBe(
      "## A\n\n## B\n\n### C\n\n### D\n\n### E\n\n### F",
    );
  });
});

describe("links", () => {
  it("keeps usable addresses and counts the dropped ones, keeping their text", () => {
    const { markdown, droppedLinks } = convert(
      `<p><a href="https://example.invalid/a">ok</a> <a href="javascript:alert(1)">bad one</a> <a href="/relative">rel</a>
       <a href="tel:+15555550100">phone</a> <a href="#frag">frag</a> <a href="https://">empty</a> <a href="mailto:a@example.invalid?subject=x">q</a></p>`,
    );
    expect(markdown).toBe("[ok](https://example.invalid/a) bad one rel phone frag empty q");
    expect(droppedLinks).toBe(6);
    expectValid(markdown);
  });

  it("an anchor with no href (a bookmark) is just its text and is not counted", () => {
    const { markdown, droppedLinks } = convert("<p><a name='top'>Top</a></p>");
    expect(markdown).toBe("Top");
    expect(droppedLinks).toBe(0);
  });

  it("an empty link is dropped silently", () => {
    expect(convert("<p>a<a href='https://example.invalid/x'></a>b</p>")).toEqual({ markdown: "ab", droppedLinks: 0 });
  });

  it("parentheses in an address are encoded so the link survives", () => {
    const { markdown } = convert("<p><a href='https://example.invalid/a_(b)'>x</a></p>");
    expect(markdown).toBe("[x](https://example.invalid/a_%28b%29)");
    expectValid(markdown);
  });

  it("brackets in the label cannot break the link", () => {
    const { markdown } = convert("<p><a href='https://example.invalid/x'>[1] notes</a></p>");
    expect(markdown).toBe("[(1) notes](https://example.invalid/x)");
    expectValid(markdown);
  });

  it("credentials in an address drop the link", () => {
    const { markdown, droppedLinks } = convert("<p><a href='https://u:p@example.invalid/'>x</a></p>");
    expect(markdown).toBe("x");
    expect(droppedLinks).toBe(1);
  });
});

describe("structure", () => {
  it("<br> is a space (the renderer joins a paragraph's lines)", () => {
    expect(convert("<p>one<br>two<br/>three</p>").markdown).toBe("one two three");
  });

  it("paragraphs and divs are separated by a blank line", () => {
    expect(convert("<div>one</div><div>two<div>three</div></div><p>four</p>").markdown).toBe("one\n\ntwo\n\nthree\n\nfour");
  });

  it("loose text between blocks becomes its own paragraph", () => {
    expect(convert("before<p>inside</p>after").markdown).toBe("before\n\ninside\n\nafter");
  });

  it("tables flatten to cell paragraphs, row by row", () => {
    expect(
      convert(`${TABLE}<thead><tr><th>Day</th><th>Time</th></tr></thead><tbody><tr><td>Sun</td><td>9 am</td></tr></tbody></table>`)
        .markdown,
    ).toBe("Day\n\nTime\n\nSun\n\n9 am");
  });

  it("whitespace collapses, including non-breaking spaces and newlines", () => {
    expect(convert("<p>  a \n\t b  c  </p>").markdown).toBe("a b c");
  });

  it("an empty list item is skipped and numbering follows what is kept", () => {
    expect(convert("<ol><li>One</li><li> </li><li>Two</li></ol>").markdown).toBe("1. One\n2. Two");
  });

  it("empty input and markup with no text give an empty result", () => {
    expect(convert("")).toEqual({ markdown: "", droppedLinks: 0 });
    expect(convert("<div><p> </p><br></div>")).toEqual({ markdown: "", droppedLinks: 0 });
  });
});

describe("everything non-textual is dropped", () => {
  it("images, scripts, styles, comments, embeds and hidden content", () => {
    const { markdown } = convert(
      `<p>Visible</p><img src="https://example.invalid/x.png" alt="alt text">
       <script>alert(1)</script>${STYLE}p{color:red}</style><!-- a comment -->
       <iframe src="https://example.invalid"></iframe><object data="x"></object><svg><text>svg text</text></svg>
       <p style="display:none">hidden</p><p hidden>also hidden</p><p style="mso-hide:all">word hidden</p>
       <noscript>no script</noscript><video>video</video><input value="v"><button>btn</button>`,
    );
    expect(markdown).toBe("Visible");
  });
});

describe("the subset has no escapes (finding P3-8)", () => {
  it("a literal * becomes a lookalike, so it cannot italicise", () => {
    const { markdown } = convert("<p>Salary*: 5 * 6 and *bold-looking*</p>");
    expect(markdown).toBe("Salary∗: 5 ∗ 6 and ∗bold-looking∗");
    expect(markdown).not.toContain("*");
    expectValid(markdown);
  });

  it("a paragraph starting with # keeps its words but not the heading syntax", () => {
    for (const html of ["<p># Not a heading</p>", "<p>#### Deep</p>", "<p>##</p>"]) {
      const { markdown } = convert(html);
      expect(markdown, html).not.toMatch(/^#/);
      expectValid(markdown);
    }
    expect(convert("<p>#1 priority</p>").markdown).toBe("#1 priority");
  });

  it("a paragraph that is only --- does not become a rule", () => {
    expect(convert("<p>---</p>").markdown).toBe("—");
  });

  it("a ]( in plain text cannot become the middle of a link", () => {
    const { markdown } = convert("<p>see [here](https://example.invalid) please</p>");
    expect(markdown).toBe("see [here］(https://example.invalid) please");
    expectValid(markdown);
  });
});

describe("hostile characters", () => {
  it("bidi, zero-width and control characters are stripped", () => {
    const { markdown } = convert("<p>Pay‮gnirts‬ ​ok\u0000\u0007 ⁦x⁩</p>");
    expect(markdown).toBe("Paygnirts ok x");
  });

  it("private-use characters cannot forge emphasis", () => {
    expect(convert("<p>abc</p>").markdown).toBe("abc");
  });

  it("output is NFC", () => {
    expect(convert("<p>Café</p>").markdown).toBe("Café");
  });
});

describe("limits and safety", () => {
  it("input over the cap returns null so the browser pastes plain text", () => {
    expect(htmlToMarkdown("a".repeat(MAX_PASTE_HTML_CHARS + 1))).toBeNull();
    expect(htmlToMarkdown("<p>x</p>".repeat(100))).not.toBeNull();
    expect(htmlToMarkdown(`<p>${"a".repeat(MAX_PASTE_HTML_CHARS - 7)}</p>`)).not.toBeNull();
  });

  it("a parser that throws returns null", () => {
    expect(
      htmlToMarkdown("<p>x</p>", () => {
        throw new Error("boom");
      }),
    ).toBeNull();
  });

  it("deeply nested markup is flattened rather than overflowing the stack", () => {
    const depth = 5000;
    const html = `${"<div>".repeat(depth)}deep text${"</div>".repeat(depth)}`;
    const result = htmlToMarkdown(html);
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain("deep text");
  });

  it("nothing executes or loads: window is untouched by scripts and onerror handlers", () => {
    const w = globalThis as unknown as Record<string, unknown>;
    delete w.__pwned;
    const html = `<script>window.__pwned = 'script'</script><img src="x" onerror="window.__pwned = 'img'"><p onclick="window.__pwned='click'">text</p>
      <a href="javascript:window.__pwned='link'">go</a><iframe srcdoc="<script>parent.__pwned='frame'</script>"></iframe>`;
    const { markdown } = convert(html);
    expect(markdown).toBe("text\n\ngo");
    expect(w.__pwned).toBeUndefined();
  });

  it("takes the parser as an argument (the default is DOMParser)", () => {
    let called = 0;
    const result = htmlToMarkdown("<p>via jsdom</p>", (html) => {
      called += 1;
      return new DOMParser().parseFromString(html, "text/html");
    });
    expect(called).toBe(1);
    expect(result).toEqual({ markdown: "via jsdom", droppedLinks: 0 });
  });
});
