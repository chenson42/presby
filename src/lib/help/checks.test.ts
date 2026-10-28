/**
 * check:help's pure rules, H1 to H18. Every rule has a failing and a passing
 * fixture; a fixture is an in-memory input, never the real tree. (H19, the import
 * boundary, is scripts/lib/help-boundary.test.mjs; the catalog and tile coverage rules
 * are coverage.test.ts.)
 */
import { describe, expect, it } from "vitest";
import {
  HELP_RULES,
  checkHelp,
  formatViolation,
  readPngSize,
  type HelpCheckInput,
} from "./checks";
import type { HelpEntry, HelpShot } from "./types";

// ---- fixtures -------------------------------------------------------------

const TODO_OK = [
  "# TODO",
  "## In Flight",
  "- [ ] Feature in flight [help:in-flight]",
  "- [ ] A planned thing [help:worship-planning]",
  "## Done",
  "- [x] Shipped feature [help:shipped]",
].join("\n");

const pub = (slug: string, extra: Record<string, unknown> = {}): HelpEntry =>
  ({
    status: "published",
    slug,
    title: `Title ${slug}`,
    summary: "A summary.",
    order: 10,
    audience: "everyone",
    covers: [],
    labels: [],
    verifiedIn: "0.47.0",
    ...extra,
  }) as HelpEntry;
const pend = (slug: string, extra: Record<string, unknown> = {}): HelpEntry =>
  ({
    status: "pending",
    slug,
    title: `Title ${slug}`,
    summary: "A summary.",
    order: 10,
    audience: "everyone",
    covers: [],
    labels: [],
    verifiedIn: null,
    requires: "in-flight",
    ...extra,
  }) as HelpEntry;
const plan = (slug: string, extra: Record<string, unknown> = {}): HelpEntry =>
  ({
    status: "planned",
    slug,
    title: slug,
    summary: "A summary.",
    order: 1,
    forWhom: "Congregations",
    today: "There is no such tool.",
    confirmedOn: "2026-10-26",
    ...extra,
  }) as HelpEntry;

const md = (slug: string, body: string) => ({ path: `src/content/help/${slug}.md`, content: body });
const src = (p: string, content: string) => ({ path: p, content });

const base = (over: Partial<HelpCheckInput> = {}): HelpCheckInput => ({
  pages: [],
  contentFiles: [],
  imageFiles: [],
  shots: [],
  screenshotsSource: null,
  slugHistory: [],
  todo: TODO_OK,
  packageVersion: "0.47.0",
  functionalityMap: "",
  srcFiles: [],
  ...over,
});
/** One published page with a body, plus its file, for the content-rule tests. */
const withBody = (body: string, entry: Record<string, unknown> = {}, slug = "a-page"): HelpCheckInput =>
  base({
    pages: [pub(slug, entry)],
    contentFiles: [md(slug, body)],
    slugHistory: [slug],
    functionalityMap: `/help/${slug}`,
  });

const run = (rule: string, input: HelpCheckInput) => HELP_RULES[rule](input);
const messages = (rule: string, input: HelpCheckInput) => run(rule, input).map((v) => v.message);

describe("the harness", () => {
  it("passes a clean empty registry on the real-shaped base input (nothing uses any token yet)", () => {
    expect(checkHelp(base())).toEqual([]);
  });
  it("registers H1 to H18", () => {
    expect(Object.keys(HELP_RULES)).toEqual(Array.from({ length: 18 }, (_, i) => `H${i + 1}`));
  });
  it("formats a violation as [H<n>] <file>: <message>", () => {
    expect(formatViolation({ rule: "H4", file: "a.md", message: "bad" })).toBe("[H4] a.md: bad");
  });
});

// ---- H1 -------------------------------------------------------------------

describe("H1 registry shape", () => {
  it("passes a well-formed registry", () => {
    const pages = [
      pub("one", { order: 10 }),
      pub("two", { order: 20 }),
      pub("admin-one", { audience: "administrator", order: 10 }),
      pend("three", { order: 30 }),
      plan("worship-planning"),
    ];
    expect(run("H1", base({ pages }))).toEqual([]);
  });
  it("fails a duplicate slug", () => {
    expect(messages("H1", base({ pages: [pub("one"), pub("one", { order: 20 })] })).join()).toMatch(/duplicate slug/i);
  });
  it("fails a slug that is not kebab-case, or longer than 60 characters", () => {
    expect(run("H1", base({ pages: [pub("Not_Kebab")] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [pub("a".repeat(61))] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [pub("a".repeat(60))] }))).toEqual([]);
  });
  it("refuses the reserved slugs planned and contact", () => {
    expect(messages("H1", base({ pages: [pub("planned")] })).join()).toMatch(/reserved/i);
    expect(messages("H1", base({ pages: [pub("contact")] })).join()).toMatch(/reserved/i);
  });
  it("fails an alias or replaces target equal to a live slug", () => {
    expect(run("H1", base({ pages: [pub("one"), pub("two", { order: 20, aliases: ["one"] })] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [pub("one", { replaces: ["worship-planning"] }), plan("worship-planning")] }))).not.toEqual([]);
  });
  it("fails an alias or replaces target used twice", () => {
    const pages = [pub("one", { aliases: ["old"] }), pub("two", { order: 20, aliases: ["old"] })];
    expect(run("H1", base({ pages }))).not.toEqual([]);
    const pages2 = [pub("one", { replaces: ["old"] }), pub("two", { order: 20, replaces: ["old"] })];
    expect(run("H1", base({ pages: pages2 }))).not.toEqual([]);
  });
  it("fails a duplicate order within an audience, but not across audiences", () => {
    expect(run("H1", base({ pages: [pub("one"), pub("two")] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [pub("one"), pub("two", { audience: "administrator" })] }))).toEqual([]);
  });
  it("fails a published entry without verifiedIn", () => {
    expect(messages("H1", base({ pages: [pub("one", { verifiedIn: null })] })).join()).toMatch(/verifiedIn/);
  });
  it("fails a pending entry without requires", () => {
    expect(messages("H1", base({ pages: [pend("one", { requires: undefined })] })).join()).toMatch(/requires/);
  });
  it("fails a planned entry missing forWhom, today or an ISO confirmedOn", () => {
    expect(run("H1", base({ pages: [plan("x", { forWhom: "" })] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [plan("x", { today: "" })] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [plan("x", { confirmedOn: "26 Oct 2026" })] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [plan("x", { confirmedOn: "2026-13-40" })] }))).not.toEqual([]);
  });
  it("fails an empty title or summary", () => {
    expect(run("H1", base({ pages: [pub("one", { title: "" })] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [pub("one", { summary: "" })] }))).not.toEqual([]);
  });
  it("fails a malformed requires or limitationUntil token", () => {
    expect(run("H1", base({ pages: [pend("one", { requires: "Bad Token" })] }))).not.toEqual([]);
    expect(run("H1", base({ pages: [pub("one", { limitationUntil: "Bad Token" })] }))).not.toEqual([]);
  });
});

// ---- H2 -------------------------------------------------------------------

describe("H2 file parity", () => {
  it("passes when every published and pending entry has its file and nothing else does", () => {
    const input = base({
      pages: [pub("one"), pend("two", { order: 20 }), plan("worship-planning")],
      contentFiles: [md("one", "x"), md("two", "y")],
    });
    expect(run("H2", input)).toEqual([]);
  });
  it("fails an entry with no file", () => {
    expect(messages("H2", base({ pages: [pub("one")] })).join()).toMatch(/src\/content\/help\/one\.md/);
  });
  it("fails a file with no entry", () => {
    const v = run("H2", base({ contentFiles: [md("orphan", "x")] }));
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe("src/content/help/orphan.md");
  });
  it("fails a planned slug that has a file", () => {
    const v = run("H2", base({ pages: [plan("worship-planning")], contentFiles: [md("worship-planning", "x")] }));
    expect(messages("H2", base({ pages: [plan("worship-planning")], contentFiles: [md("worship-planning", "x")] })).join()).toMatch(/planned/);
    expect(v).not.toEqual([]);
  });
});

// ---- H3 -------------------------------------------------------------------

describe("H3 slug permanence", () => {
  it("passes when published and planned slugs are in the history and every historical slug is accounted for", () => {
    const input = base({
      pages: [pub("one", { aliases: ["uno"] }), plan("worship-planning"), pub("two", { order: 20, replaces: ["old-plan"] })],
      slugHistory: ["one", "uno", "worship-planning", "two", "old-plan"],
    });
    expect(run("H3", input)).toEqual([]);
  });
  it("fails a published slug that is missing from the history", () => {
    expect(messages("H3", base({ pages: [pub("one")] })).join()).toMatch(/slug-history/);
  });
  it("fails a planned slug that is missing from the history", () => {
    expect(run("H3", base({ pages: [plan("worship-planning")] }))).not.toEqual([]);
  });
  it("does not require a pending slug in the history (it has never been public)", () => {
    expect(run("H3", base({ pages: [pend("one")] }))).toEqual([]);
  });
  it("fails a historical slug that is neither current, an alias, nor a replaces target", () => {
    expect(messages("H3", base({ slugHistory: ["vanished"] })).join()).toMatch(/vanished/);
  });
});

// ---- H4 -------------------------------------------------------------------

describe("H4 headings", () => {
  it("passes ordered h2/h3 headings", () => {
    expect(run("H4", withBody("## A\n\n### B\n\n## C\n"))).toEqual([]);
  });
  it("fails a level-1 heading", () => {
    expect(messages("H4", withBody("# Title\n\n## A\n")).join()).toMatch(/level-1|h1/i);
  });
  it("fails a skipped level, and a first heading deeper than h2", () => {
    expect(run("H4", withBody("## A\n\n#### D\n"))).not.toEqual([]);
    expect(run("H4", withBody("### First\n"))).not.toEqual([]);
  });
  it("allows going back up more than one level", () => {
    expect(run("H4", withBody("## A\n### B\n#### C\n## D\n"))).toEqual([]);
  });
  it("fails an empty heading", () => {
    expect(messages("H4", withBody("## \n")).join()).toMatch(/empty/i);
  });
  it("fails a declared anchor no heading produces, and passes one it does", () => {
    expect(run("H4", withBody("## Forgot password?\n", { anchors: ["forgot-password"] }))).toEqual([]);
    expect(messages("H4", withBody("## Forgot password?\n", { anchors: ["no-such-heading"] })).join()).toMatch(/no-such-heading/);
  });
  it("checks pending pages too", () => {
    const input = base({ pages: [pend("one")], contentFiles: [md("one", "# Bad\n")] });
    expect(run("H4", input)).not.toEqual([]);
  });
});

// ---- H5 -------------------------------------------------------------------

describe("H5 closed markdown subset", () => {
  it("passes plain inline markdown with the one template token", () => {
    expect(run("H5", withBody("## A\n\nSee [x](/help) and {{contact}}.\n"))).toEqual([]);
  });
  const bad: Array<[string, string]> = [
    ["raw HTML", "a <b>x</b>"],
    ["a reference-style link", "see [a][b]"],
    ["an autolink", "go <https://x.invalid>"],
    ["a bare URL", "go https://x.invalid now"],
    ["an unknown template token", "hi {{name}}"],
    ["a leftover HTML entity", "Tom &amp; Jerry"],
    ["a setext heading", "Title\n=====\n"],
  ];
  for (const [what, body] of bad) {
    it(`fails ${what}`, () => {
      expect(run("H5", withBody(`## A\n\n${body}\n`)), what).not.toEqual([]);
    });
  }
  it("names the line", () => {
    const v = run("H5", withBody("## A\n\nok\n\n<div>\n"));
    expect(v[0].message).toMatch(/line 5/);
  });
  it("does not flag {{contact}} after it is expanded", () => {
    expect(run("H5", withBody("## A\n\n{{contact}}\n"))).toEqual([]);
  });
  it("does not flag {{privacyContact}} after it is expanded, and still flags a near miss", () => {
    expect(run("H5", withBody("## A\n\n{{privacyContact}}\n"))).toEqual([]);
    expect(run("H5", withBody("## A\n\n{{privacycontact}}\n"))).not.toEqual([]);
  });
});

// ---- H6 -------------------------------------------------------------------

describe("H6 links", () => {
  const two = (bodyA: string, aExtra = {}, bExtra = {}) =>
    base({
      pages: [pub("page-a", aExtra), pub("page-b", { order: 20, ...bExtra })],
      contentFiles: [md("page-a", bodyA), md("page-b", "## Forgot password?\n")],
      slugHistory: ["page-a", "page-b"],
      functionalityMap: "/help/page-a /help/page-b",
    });
  it("passes an admitted internal link, an anchor declared on the target, and a planned link", () => {
    expect(run("H6", two("## A\n\nSee [the other page](/help/page-b).\n"))).toEqual([]);
    expect(
      run("H6", two("## A\n\nSee [reset](/help/page-b#forgot-password).\n", {}, { anchors: ["forgot-password"] })),
    ).toEqual([]);
    const withPlan = { ...two("## A\n\nSee [the plans](/help/planned).\n"), pages: [pub("page-a"), pub("page-b", { order: 20 }), plan("worship-planning")] };
    expect(run("H6", withPlan)).toEqual([]);
  });
  it("fails a destination resolveLink does not admit", () => {
    expect(run("H6", two("## A\n\n[x](/help/nope)\n"))).not.toEqual([]);
    expect(run("H6", two("## A\n\n[x](https://example.invalid/)\n"))).not.toEqual([]);
    expect(run("H6", two("## A\n\n[x](javascript:alert(1))\n"))).not.toEqual([]);
  });
  it("fails an anchor the target does not declare", () => {
    expect(run("H6", two("## A\n\n[x](/help/page-b#forgot-password)\n"))).not.toEqual([]);
  });
  it("fails vague link text", () => {
    for (const text of ["here", "Click here", "this link", "link", "Read more", "read more."]) {
      expect(run("H6", two(`## A\n\n[${text}](/help/page-b)\n`)), text).not.toEqual([]);
    }
  });
  it("lets a pending page link a pending sibling, but a published page may not", () => {
    const pendingToPending = base({
      pages: [pend("p-one"), pend("p-two", { order: 20 })],
      contentFiles: [md("p-one", "## A\n\n[two](/help/p-two)\n"), md("p-two", "## B\n")],
    });
    expect(run("H6", pendingToPending)).toEqual([]);
    const publishedToPending = base({
      pages: [pub("one"), pend("p-two", { order: 20 })],
      contentFiles: [md("one", "## A\n\n[two](/help/p-two)\n"), md("p-two", "## B\n")],
      slugHistory: ["one"],
    });
    expect(run("H6", publishedToPending)).not.toEqual([]);
  });
});

// ---- H7 -------------------------------------------------------------------

describe("H7 images", () => {
  const shot: HelpShot = { id: "signin-form", alt: "The sign-in form", route: "/signin", user: "signed-out", viewport: 360, width: 720, height: 1200, capturedIn: "0.47.0" };
  const input = (body: string) => ({ ...withBody(body), shots: [shot] });
  it("passes a manifest image with alt text", () => {
    expect(run("H7", input("## A\n\n![The form](shot:signin-form)\n"))).toEqual([]);
  });
  it("fails a remote or tracking-pixel source", () => {
    expect(run("H7", input("## A\n\n![x](https://x.invalid/a.png)\n"))).not.toEqual([]);
    expect(run("H7", input("## A\n\n![x](/img/a.png)\n"))).not.toEqual([]);
  });
  it("fails empty alt and alt over 125 characters", () => {
    expect(run("H7", input("## A\n\n![](shot:signin-form)\n"))).not.toEqual([]);
    expect(run("H7", input(`## A\n\n![${"a".repeat(126)}](shot:signin-form)\n`))).not.toEqual([]);
    expect(run("H7", input(`## A\n\n![${"a".repeat(125)}](shot:signin-form)\n`))).toEqual([]);
  });
  it("fails an id that is not in screenshots-data", () => {
    expect(run("H7", input("## A\n\n![x](shot:unknown)\n"))).not.toEqual([]);
  });
});

// ---- H8 -------------------------------------------------------------------

describe("H8 banned phrases", () => {
  const phrases = [
    "coming soon",
    "will be able to",
    "planned",
    "in a future release",
    "in the future",
    "next release",
    "later this year",
    "stay tuned",
  ];
  for (const p of phrases) {
    it(`fails "${p}" in a published page (any case)`, () => {
      expect(run("H8", withBody(`## A\n\nThis is ${p.toUpperCase()} here.\n`)), p).not.toEqual([]);
    });
  }
  it("passes ordinary present-tense prose", () => {
    expect(run("H8", withBody("## A\n\nYou can add a person. Ask an administrator.\n"))).toEqual([]);
  });
  it("does not read a link destination such as /help/planned", () => {
    expect(run("H8", withBody("## A\n\nSee [what is missing](/help/planned).\n"))).toEqual([]);
  });
  it("does not match inside a longer word", () => {
    expect(run("H8", withBody("## A\n\nUnplanned outages are rare.\n"))).toEqual([]);
  });
  it("fails a banned phrase in a published registry string", () => {
    expect(run("H8", withBody("## A\n", { summary: "Coming soon to you." }))).not.toEqual([]);
    expect(run("H8", withBody("## A\n", { needs: { who: "Someone who will be able to sign in" } }))).not.toEqual([]);
  });
  it("exempts pending pages and planned entries", () => {
    expect(run("H8", base({ pages: [pend("one")], contentFiles: [md("one", "## A\n\nThis will be able to work.\n")] }))).toEqual([]);
    expect(run("H8", base({ pages: [plan("worship-planning", { today: "This is planned for later." })], slugHistory: ["worship-planning"] }))).toEqual([]);
  });
});

// ---- H9 -------------------------------------------------------------------

describe("H9 no real data", () => {
  const fails = (text: string) => run("H9", withBody(`## A\n\n${text}\n`));
  it("passes ordinary prose and a fictional example name", () => {
    expect(fails("Alder Creek Presbyterian Church is a made-up example.")).toEqual([]);
    expect(fails("PresbyPortal is for every Presbyterian Church.")).toEqual([]);
    expect(fails("Ask your Church office. The Church administrator can help.")).toEqual([]);
  });
  it("fails hostnames and project-identifier shapes", () => {
    expect(fails("db ep-quiet-forest-12345678.us-east-2.aws.neon.tech")).not.toEqual([]);
    expect(fails("host something.neon.tech")).not.toEqual([]);
    expect(fails("see my-app.vercel.app")).not.toEqual([]);
    expect(fails("branch br-cool-sea-12345678")).not.toEqual([]);
    expect(fails("snapshot snap-tidy-owl-1234")).not.toEqual([]);
    expect(fails("repo site-somechurch")).not.toEqual([]);
  });
  it("does not flag the ordinary word site-wide", () => {
    expect(fails("A site-wide change.")).toEqual([]);
  });
  it("fails an https host off the allowlist, in a link or anywhere in the text", () => {
    expect(fails("[x](https://example.invalid/page)")).not.toEqual([]);
    expect(fails("`https://other.invalid/x`")).not.toEqual([]);
  });
  it("passes an allowlisted https host", () => {
    expect(fails("[the project](https://github.com/chenson42/presby)")).toEqual([]);
  });
  it("fails a named-congregation shape that is not a fictional example, with advice", () => {
    const v = fails("We worship at Maple Grove Church every week.");
    expect(v).not.toEqual([]);
    expect(v[0].message).toMatch(/example-names/);
    expect(fails("The Hollow Creek Presbytery met.")).not.toEqual([]);
    expect(fails("First Valley Synod said.")).not.toEqual([]);
  });
  it("scans registry strings too", () => {
    expect(run("H9", withBody("## A\n", { summary: "For Maple Grove Church." }))).not.toEqual([]);
  });
  it("scans pending pages and planned entries", () => {
    expect(run("H9", base({ pages: [pend("one")], contentFiles: [md("one", "## A\n\nMaple Grove Church\n")] }))).not.toEqual([]);
    expect(run("H9", base({ pages: [plan("worship-planning", { forWhom: "Maple Grove Church" })] }))).not.toEqual([]);
  });
});

// ---- H10 ------------------------------------------------------------------

describe("H10 labels", () => {
  const labelled = (body: string, labels: string[], srcFiles: ReturnType<typeof src>[]) =>
    ({ ...withBody(body, { labels }), srcFiles });
  it("passes a label that is in a non-test src file and in the page's own text", () => {
    const input = labelled("## A\n\nPress \"Sign in with Google\".\n", ["Sign in with Google"], [
      src("src/app/(auth)/signin/form.tsx", "<button>Sign in with Google</button>"),
    ]);
    expect(run("H10", input)).toEqual([]);
  });
  it("fails a label no src file contains (it left the UI)", () => {
    const input = labelled("## A\n\nPress \"Old name\".\n", ["Old name"], [src("src/a.tsx", "<b>New name</b>")]);
    expect(messages("H10", input).join()).toMatch(/Old name/);
  });
  it("fails a label that only a test file, the content tree, or the help libraries contain", () => {
    for (const p of ["src/a.test.tsx", "src/content/help/other.md", "src/lib/help/registry.ts", "src/components/help/x.tsx"]) {
      const input = labelled("## A\n\nPress Verify.\n", ["Verify"], [src(p, "Verify")]);
      expect(run("H10", input), p).not.toEqual([]);
    }
  });
  it("fails a label the page itself never says (a stale label cannot hide)", () => {
    const input = labelled("## A\n\nNothing quoted here.\n", ["Verify"], [src("src/a.tsx", "Verify")]);
    expect(messages("H10", input).join()).toMatch(/page/);
  });
  it("normalises whitespace, quote entities and escapes on both sides", () => {
    const input = labelled(
      "## A\n\nThat code didn't match.\n",
      ["That code didn't match."],
      [src("src/a.tsx", "<p>\n  That code didn&apos;t\n  match.\n</p>")],
    );
    expect(run("H10", input)).toEqual([]);
    const input2 = labelled(
      "## A\n\nThat code didn’t match.\n",
      ["That code didn't match."],
      [src("src/a.tsx", "const m = 'That code didn\\'t match.';")],
    );
    expect(run("H10", input2)).toEqual([]);
  });
  it("lets a label be in the registry strings instead of the markdown", () => {
    const input = { ...withBody("## A\n", { labels: ["Verify"], summary: "Press Verify." }), srcFiles: [src("src/a.tsx", "Verify")] };
    expect(run("H10", input)).toEqual([]);
  });
  it("does not check pending pages", () => {
    const input = base({ pages: [pend("one", { labels: ["Not in the UI yet"] })], contentFiles: [md("one", "## A\n")] });
    expect(run("H10", input)).toEqual([]);
  });
});

// ---- H11 ------------------------------------------------------------------

describe("H11 needs", () => {
  it("passes a role in the UI's own words", () => {
    expect(run("H11", withBody("## A\n", { needs: { who: "A church administrator" } }))).toEqual([]);
  });
  it("fails an empty who", () => {
    expect(run("H11", withBody("## A\n", { needs: { who: " " } }))).not.toEqual([]);
  });
  it("fails a who that carries a permission key", () => {
    for (const who of ["Anyone with org_features.manage", "people.manage holders", "role_grants.manage"]) {
      expect(run("H11", withBody("## A\n", { needs: { who } })), who).not.toEqual([]);
    }
  });
  it("ignores pages with no needs block and pending pages", () => {
    expect(run("H11", withBody("## A\n"))).toEqual([]);
    expect(run("H11", base({ pages: [pend("one", { needs: { who: "people.manage" } })], contentFiles: [md("one", "x")] }))).toEqual([]);
  });
});

// ---- H12 ------------------------------------------------------------------

describe("H12 publication against docs/TODO.md", () => {
  const todoWith = (lines: string[]) => ["# TODO", "## In Flight", ...lines, "## Done", "- [x] shipped [help:shipped]"].join("\n");
  const pendingInput = (todo: string, extra: Record<string, unknown> = {}) =>
    base({ pages: [pend("one", extra)], contentFiles: [md("one", "x")], todo });

  it("passes with tokens no entry uses yet (the empty registry)", () => {
    expect(run("H12", base())).toEqual([]);
  });
  it("passes a pending page whose token line is open", () => {
    expect(run("H12", pendingInput(TODO_OK))).toEqual([]);
  });
  it("11b: fails a pending page whose line is Done, saying to publish it", () => {
    expect(messages("H12", pendingInput(TODO_OK, { requires: "shipped" })).join()).toMatch(/feature shipped: publish its page/);
  });
  it("11a: fails a published page with requires whose line is still open", () => {
    const input = base({ pages: [pub("one", { requires: "in-flight" })], contentFiles: [md("one", "x")], slugHistory: ["one"] });
    expect(run("H12", input)).not.toEqual([]);
  });
  it("passes a published page with requires whose line is Done", () => {
    const input = base({ pages: [pub("one", { requires: "shipped" })], contentFiles: [md("one", "x")], slugHistory: ["one"] });
    expect(run("H12", input)).toEqual([]);
  });
  it("11c: fails a planned entry whose line is Done or declined, saying to replace or remove it", () => {
    const done = base({ pages: [plan("shipped")] });
    expect(messages("H12", done).join()).toMatch(/replace or remove the placeholder/);
    const declined = base({
      pages: [plan("worship-planning")],
      todo: todoWith(["- [ ] Declined for now. [help:worship-planning]"]),
    });
    expect(messages("H12", declined).join()).toMatch(/replace or remove the placeholder/);
  });
  it("passes a planned entry whose line is open", () => {
    expect(run("H12", base({ pages: [plan("worship-planning")] }))).toEqual([]);
  });
  it("11d / f: fails a limitationUntil whose line is Done (names the page), passes while it is open", () => {
    const done = base({ pages: [pub("one", { limitationUntil: "shipped" })], contentFiles: [md("one", "x")], slugHistory: ["one"] });
    const v = run("H12", done);
    expect(v).not.toEqual([]);
    expect(v[0].message).toMatch(/remove the limitation sentence and the marker/);
    const open = base({ pages: [pub("one", { limitationUntil: "in-flight" })], contentFiles: [md("one", "x")], slugHistory: ["one"] });
    expect(run("H12", open)).toEqual([]);
  });
  it("(d): fails a token that is missing, or appears twice", () => {
    expect(run("H12", pendingInput(TODO_OK, { requires: "no-such-token" }))).not.toEqual([]);
    const twice = todoWith(["- [ ] a [help:in-flight]", "- [ ] b [help:in-flight]"]);
    expect(run("H12", pendingInput(twice))).not.toEqual([]);
  });
  it("(e): allows several pending pages to share a token", () => {
    const input = base({
      pages: [pend("one"), pend("two", { order: 20 })],
      contentFiles: [md("one", "x"), md("two", "x")],
    });
    expect(run("H12", input)).toEqual([]);
  });
  it("(e): a planned token belongs to one entry (a content page may not also use it)", () => {
    const input = base({
      pages: [plan("worship-planning"), pend("one", { requires: "worship-planning" })],
      contentFiles: [md("one", "x")],
    });
    expect(run("H12", input)).not.toEqual([]);
  });
  it("an ambiguous token line fails, with its line number, even when no entry uses the token", () => {
    const todo = ["# T", "## In Flight", "- [x] half-shipped [help:orphan]", "## Done"].join("\n");
    const v = run("H12", base({ todo }));
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/line 3/);
  });
  it("a duplicated token fails even when no entry uses it", () => {
    const todo = ["# T", "## In Flight", "- [ ] a [help:dup]", "- [ ] b [help:dup]", "## Done"].join("\n");
    expect(run("H12", base({ todo }))).not.toEqual([]);
  });
  it("fails the whole check when ## Done cannot be found", () => {
    const v = run("H12", base({ todo: "# T\n- [ ] a [help:x]\n" }));
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/cannot classify/i);
  });
  it("12: a near-miss token does not satisfy an entry", () => {
    const todo = ["# T", "## In Flight", "- [ ] a [help: in-flight]", "## Done"].join("\n");
    expect(run("H12", pendingInput(todo))).not.toEqual([]);
  });
});

// ---- H13 ------------------------------------------------------------------

describe("H13 verifiedIn", () => {
  it("passes a version at most package.json's", () => {
    expect(run("H13", withBody("x", { verifiedIn: "0.47.0" }))).toEqual([]);
    expect(run("H13", withBody("x", { verifiedIn: "0.46.3" }))).toEqual([]);
  });
  it("fails a version above package.json's (compared numerically, not as strings)", () => {
    expect(run("H13", withBody("x", { verifiedIn: "0.48.0" }))).not.toEqual([]);
    expect(run("H13", { ...withBody("x", { verifiedIn: "0.9.0" }), packageVersion: "0.10.0" })).toEqual([]);
    expect(run("H13", { ...withBody("x", { verifiedIn: "0.47.1" }), packageVersion: "0.47.0" })).not.toEqual([]);
  });
  it("fails a malformed version", () => {
    expect(run("H13", withBody("x", { verifiedIn: "latest" }))).not.toEqual([]);
  });
  it("ignores a null verifiedIn (pending)", () => {
    expect(run("H13", base({ pages: [pend("one")] }))).toEqual([]);
  });
});

// ---- H14 ------------------------------------------------------------------

describe("H14 covers syntax", () => {
  it("passes the four forms", () => {
    const covers = ["org_portal.calendar", "tile:giving-admin", "flag:ui.branded_signin", "route:/o/{slug}/admin", "route:/home"];
    expect(run("H14", withBody("x", { covers }))).toEqual([]);
  });
  it("fails anything else", () => {
    for (const c of ["calendar", "tile:", "tile:Bad Key", "org_portal.", "route:home", "flag:", "tile:a/b"]) {
      expect(run("H14", withBody("x", { covers: [c] })), c).not.toEqual([]);
    }
  });
  it("checks pending pages too", () => {
    expect(run("H14", base({ pages: [pend("one", { covers: ["nope"] })] }))).not.toEqual([]);
  });
});

// ---- H15 ------------------------------------------------------------------

describe("H15 functionality map", () => {
  it("passes when the map names every published slug", () => {
    expect(run("H15", withBody("x"))).toEqual([]);
  });
  it("fails a published slug the map does not name", () => {
    expect(run("H15", { ...withBody("x"), functionalityMap: "nothing here" })).not.toEqual([]);
  });
  it("does not accept a longer slug as the slug", () => {
    expect(run("H15", { ...withBody("x"), functionalityMap: "/help/a-page-two" })).not.toEqual([]);
    expect(run("H15", { ...withBody("x"), functionalityMap: "(/help/a-page)." })).toEqual([]);
  });
  it("does not require pending or planned slugs", () => {
    expect(run("H15", base({ pages: [pend("one"), plan("worship-planning")] }))).toEqual([]);
  });
});

// ---- H16 ------------------------------------------------------------------

describe("H16 hand-built /help literals", () => {
  const lit = (p: string, content: string) => run("H16", base({ srcFiles: [src(p, content)] }));
  it("fails a double-quoted, single-quoted and template literal beginning /help", () => {
    expect(lit("src/app/x.tsx", 'const a = "/help/signing-in";')).not.toEqual([]);
    expect(lit("src/app/x.tsx", "const a = '/help';")).not.toEqual([]);
    expect(lit("src/app/x.tsx", "const a = `/help/${slug}`;")).not.toEqual([]);
    expect(lit("src/app/x.tsx", '<a href="/help#x">')).not.toEqual([]);
  });
  it("passes helpHref use, look-alikes, and a /help that is not at the start of a literal", () => {
    expect(lit("src/app/x.tsx", "const a = helpHref(slug);")).toEqual([]);
    expect(lit("src/app/x.tsx", 'const a = "/helpdesk";')).toEqual([]);
    expect(lit("src/app/x.tsx", 'const a = "https://x.invalid/help";')).toEqual([]);
    expect(lit("src/app/x.tsx", 'const a = "/o/alder-creek/help";')).toEqual([]);
  });
  it("is exempt in src/lib/help, the proxy and the documentation route group", () => {
    for (const p of ["src/lib/help/urls.ts", "src/proxy.ts", "src/app/(documentation)/help/page.tsx"]) {
      expect(lit(p, 'const a = "/help/x";'), p).toEqual([]);
    }
  });
  it("is not fooled by a comment", () => {
    expect(lit("src/app/x.tsx", '// the link is "/help/x"\n/* "/help" */\n * "/help/y"\n')).toEqual([]);
  });
  it("names the file and line", () => {
    const v = lit("src/app/x.tsx", 'a\nb\nconst x = "/help/z";\n');
    expect(v[0].file).toBe("src/app/x.tsx");
    expect(v[0].message).toMatch(/line 3/);
  });
});

// ---- H17 ------------------------------------------------------------------

describe("H17 images on disk", () => {
  const shot = (over: Partial<HelpShot> = {}): HelpShot => ({
    id: "signin-form", alt: "a", route: "/signin", user: "signed-out", viewport: 360, width: 720, height: 1200, capturedIn: "0.47.0", ...over,
  });
  const file = (over = {}) => ({ name: "signin-form.png", size: 1000, width: 720, height: 1200, ...over });
  const good = (over: Partial<HelpCheckInput> = {}) =>
    base({
      shots: [shot()],
      imageFiles: [file()],
      pages: [pub("one")],
      contentFiles: [md("one", "## A\n\n![alt](shot:signin-form)\n")],
      slugHistory: ["one"],
      ...over,
    });
  it("passes a consistent image set", () => {
    expect(run("H17", good())).toEqual([]);
  });
  it("passes when there are no images at all", () => {
    expect(run("H17", base())).toEqual([]);
  });
  it("fails a file with no data entry, and an entry with no file", () => {
    expect(run("H17", good({ imageFiles: [file(), file({ name: "orphan.png" })] }))).not.toEqual([]);
    expect(run("H17", good({ imageFiles: [] }))).not.toEqual([]);
  });
  it("fails a non-png file", () => {
    expect(run("H17", good({ imageFiles: [file(), file({ name: "x.jpg" })] }))).not.toEqual([]);
  });
  it("fails width or height that differ from the entry, or an unreadable header", () => {
    expect(run("H17", good({ imageFiles: [file({ width: 100 })] }))).not.toEqual([]);
    expect(run("H17", good({ imageFiles: [file({ height: 5 })] }))).not.toEqual([]);
    expect(run("H17", good({ imageFiles: [file({ width: null, height: null })] }))).not.toEqual([]);
  });
  it("fails a file over 400 KB", () => {
    expect(run("H17", good({ imageFiles: [file({ size: 400 * 1024 + 1 })] }))).not.toEqual([]);
    expect(run("H17", good({ imageFiles: [file({ size: 400 * 1024 })] }))).toEqual([]);
  });
  it("fails capturedIn above package.json's version", () => {
    expect(run("H17", good({ shots: [shot({ capturedIn: "0.48.0" })] }))).not.toEqual([]);
  });
  it("fails an entry no published or pending page references", () => {
    expect(run("H17", good({ contentFiles: [md("one", "## A\n")] }))).not.toEqual([]);
  });
});

describe("readPngSize", () => {
  it("reads width and height from the IHDR chunk", () => {
    const b = new Uint8Array(32);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
    b.set([0, 0, 2, 208], 16); // 720
    b.set([0, 0, 4, 176], 20); // 1200
    expect(readPngSize(b)).toEqual({ width: 720, height: 1200 });
  });
  it("returns null for anything that is not a PNG", () => {
    expect(readPngSize(new Uint8Array(32))).toBeNull();
    expect(readPngSize(new Uint8Array(4))).toBeNull();
  });
});

// ---- H18 ------------------------------------------------------------------

describe("H18 screenshots.ts static imports", () => {
  const shot = (id: string): HelpShot => ({ id, alt: "a", route: "/", user: "u", viewport: 360, width: 1, height: 1, capturedIn: "0.47.0" });
  const imp = (n: string) => `import ${n.replace(/-/g, "_")} from "@/content/help/images/${n}.png";`;
  it("passes exactly one import per entry", () => {
    const input = base({ shots: [shot("a"), shot("b")], screenshotsSource: `${imp("a")}\n${imp("b")}\n` });
    expect(run("H18", input)).toEqual([]);
  });
  it("passes no entries and no file", () => {
    expect(run("H18", base())).toEqual([]);
  });
  it("fails a missing import, an extra import, and a duplicate", () => {
    expect(run("H18", base({ shots: [shot("a"), shot("b")], screenshotsSource: imp("a") }))).not.toEqual([]);
    expect(run("H18", base({ shots: [shot("a")], screenshotsSource: `${imp("a")}\n${imp("zzz")}` }))).not.toEqual([]);
    expect(run("H18", base({ shots: [shot("a")], screenshotsSource: `${imp("a")}\n${imp("a")}` }))).not.toEqual([]);
  });
  it("fails entries with no screenshots.ts at all", () => {
    expect(run("H18", base({ shots: [shot("a")], screenshotsSource: null }))).not.toEqual([]);
  });
});
