/**
 * The four worship notices, pure - docs/work-log/2026-11-04-worship-inc1.md,
 * Phase 3 Copy G7 and DECISION-320. The guarantee under test is the SIGNATURE:
 * the builders take an organization name, a position, a team, a date and a link,
 * and nothing through which a person's name or typed text could arrive. The
 * assertions run on the FULL rendered subject, html and text, not a fragment.
 */
import { describe, expect, it } from "vitest";
import {
  buildCancelledMessage,
  buildDeclinedMessage,
  buildReminderMessage,
  buildRequestMessage,
  formatServiceWhen,
  requestLine,
  worshipLinks,
} from "./messages";
import { WORSHIP_TEMPLATE_KEYS } from "./vocab";

const ORIGIN = "https://app.presby.example.invalid";
const A = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";
const everything = (m: { message: { subject: string; html: string; text: string } }) =>
  `${m.message.subject}\n${m.message.html}\n${m.message.text}`;

describe("formatServiceWhen", () => {
  it("is 'Sunday, November 15 at 9:00 AM' from wall-clock text, with no time zone applied", () => {
    expect(formatServiceWhen("2026-11-15T09:00")).toBe("Sunday, November 15 at 9:00 AM");
    expect(formatServiceWhen("2026-11-15T00:05")).toBe("Sunday, November 15 at 12:05 AM");
    expect(formatServiceWhen("2026-11-15T12:00")).toBe("Sunday, November 15 at 12:00 PM");
    expect(formatServiceWhen("2026-12-24T19:30")).toBe("Thursday, December 24 at 7:30 PM");
  });

  it("refuses text that is not wall-clock text", () => {
    expect(() => formatServiceWhen("Sunday")).toThrow();
  });
});

describe("links: plain GETs with no query string, next or callbackUrl", () => {
  it("builds the three paths from the origin, a path-safe slug and uuids", () => {
    expect(worshipLinks.home(ORIGIN, "alder-creek")).toBe(`${ORIGIN}/o/alder-creek/worship`);
    expect(worshipLinks.request(ORIGIN, "alder-creek", A)).toBe(`${ORIGIN}/o/alder-creek/worship/requests/${A}`);
    expect(worshipLinks.board(ORIGIN, "alder-creek", G, E)).toBe(`${ORIGIN}/o/alder-creek/worship/teams/${G}/services/${E}`);
    expect(worshipLinks.home(`${ORIGIN}/`, "alder-creek")).toBe(`${ORIGIN}/o/alder-creek/worship`);
  });

  it("throws on a slug or id that is not path-safe (a link must never be bent by what a row held)", () => {
    expect(() => worshipLinks.home(ORIGIN, "Alder Creek")).toThrow();
    expect(() => worshipLinks.home(ORIGIN, "a/../b")).toThrow();
    expect(() => worshipLinks.home(ORIGIN, "x?y=1")).toThrow();
    expect(() => worshipLinks.request(ORIGIN, "alder-creek", "not-a-uuid")).toThrow();
    expect(() => worshipLinks.request(ORIGIN, "alder-creek", `${A}?next=/x`)).toThrow();
    expect(() => worshipLinks.board(ORIGIN, "alder-creek", G, "../etc")).toThrow();
  });
});

describe("the request email", () => {
  const lines = [
    { startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Praise band" },
    { startsAt: "2026-11-22T09:00", positionName: "Vocals", teamName: "Praise band" },
  ];
  const built = buildRequestMessage({ organizationName: "Alder Creek Church", lines, link: worshipLinks.home(ORIGIN, "alder-creek") });

  it("is the request template, with the ruled subject, heading, intro, lines, button and footnote", () => {
    expect(built.templateKey).toBe(WORSHIP_TEMPLATE_KEYS.request);
    expect(built.message.subject).toBe("Alder Creek Church: a request to serve");
    const text = built.message.text;
    expect(text).toContain("You're asked to serve");
    expect(text).toContain("Alder Creek Church is asking you to serve:");
    expect(text).toContain("Sunday, November 15 at 9:00 AM: Drums, Praise band");
    expect(text).toContain("Sunday, November 22 at 9:00 AM: Vocals, Praise band");
    expect(text).toContain("Answer your requests");
    expect(text).toContain("You need to sign in to answer. If you can't, let whoever asked you know.");
    expect(text).toContain(`${ORIGIN}/o/alder-creek/worship`);
  });

  it("one request says 'Answer the request'; more than twelve lines are capped with 'and N more'", () => {
    const one = buildRequestMessage({ organizationName: "Alder Creek Church", lines: lines.slice(0, 1), link: worshipLinks.request(ORIGIN, "alder-creek", A) });
    expect(one.message.text).toContain("Answer the request");
    expect(one.message.text).not.toContain("Answer your requests");
    const many = Array.from({ length: 15 }, (_, i) => ({ startsAt: "2026-11-15T09:00", positionName: `Position ${i}`, teamName: "Band" }));
    const capped = buildRequestMessage({ organizationName: "Alder Creek Church", lines: many, link: worshipLinks.home(ORIGIN, "alder-creek") });
    expect(capped.message.text).toContain("Position 11");
    expect(capped.message.text).not.toContain("Position 12");
    expect(capped.message.text).toContain("and 3 more");
  });

  it("escapes the organization, position and team names in the HTML (a name is data, not markup)", () => {
    const evil = buildRequestMessage({
      organizationName: "<script>alert(1)</script> Church",
      lines: [{ startsAt: "2026-11-15T09:00", positionName: "<b>Drums</b>", teamName: "A&B" }],
      link: worshipLinks.home(ORIGIN, "alder-creek"),
    });
    expect(evil.message.html).not.toContain("<script>");
    expect(evil.message.html).not.toContain("<b>Drums</b>");
    expect(evil.message.html).toContain("&lt;script&gt;");
    expect(evil.message.html).toContain("A&amp;B");
  });
});

describe("the reminders", () => {
  const line = { startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Praise band" };

  it("still waiting: the ruled body asks for an answer", () => {
    const m = buildReminderMessage({ kind: "unanswered", organizationName: "Alder Creek Church", line, link: worshipLinks.request(ORIGIN, "alder-creek", A) });
    expect(m.templateKey).toBe(WORSHIP_TEMPLATE_KEYS.reminder);
    expect(m.message.subject).toBe("Alder Creek Church: please answer your request");
    expect(m.message.text).toContain("A request is waiting for your answer");
    expect(m.message.text).toContain("You were asked to serve on Sunday, November 15 at 9:00 AM: Drums, Praise band. Please answer so the team can plan.");
    expect(m.message.text).toContain("Answer the request");
    expect(m.message.text).toContain("You need to sign in to answer. If you can't, let whoever asked you know.");
  });

  it("confirmed: you're serving soon, with the decline-or-tell-your-leader footnote", () => {
    const m = buildReminderMessage({ kind: "confirmed", organizationName: "Alder Creek Church", line, link: worshipLinks.home(ORIGIN, "alder-creek") });
    expect(m.templateKey).toBe(WORSHIP_TEMPLATE_KEYS.reminder);
    expect(m.message.subject).toBe("Alder Creek Church: you're serving soon");
    expect(m.message.text).toContain("You're serving soon");
    expect(m.message.text).toContain(requestLine(line));
    expect(m.message.text).toContain("See your schedule");
    expect(m.message.text).toContain("Can't make it any more? Open your schedule and choose Decline, or tell your team leader.");
  });
});

describe("the cancel notice", () => {
  it("names the date, links to the schedule and has no footnote", () => {
    const m = buildCancelledMessage({ organizationName: "Alder Creek Church", startsAt: "2026-11-15T09:00", link: worshipLinks.home(ORIGIN, "alder-creek") });
    expect(m.templateKey).toBe(WORSHIP_TEMPLATE_KEYS.cancelled);
    expect(m.message.subject).toBe("Alder Creek Church: a service was cancelled");
    expect(m.message.text).toContain("The service on Sunday, November 15 at 9:00 AM was cancelled, so you are not serving that day.");
    expect(m.message.text).toContain("See your schedule");
  });
});

describe("the decline notice", () => {
  const m = buildDeclinedMessage({
    organizationName: "Alder Creek Church",
    positionName: "Drums",
    startsAt: "2026-11-15T09:00",
    link: worshipLinks.board(ORIGIN, "alder-creek", G, E),
  });

  it("says a position needs someone else, never who, and links to the board", () => {
    expect(m.templateKey).toBe(WORSHIP_TEMPLATE_KEYS.declined);
    expect(m.message.subject).toBe("Alder Creek Church: a position needs someone else");
    expect(m.message.text).toContain("Someone can't serve");
    expect(m.message.text).toContain("Someone you scheduled has declined Drums on Sunday, November 15 at 9:00 AM.");
    expect(m.message.text).toContain("This message doesn't include their name. Open the schedule to see who.");
    expect(m.message.text).toContain(`/worship/teams/${G}/services/${E}`);
  });
});

describe("no notice carries a person's name, a reason or a query string (F428: the body is retained)", () => {
  const all = [
    buildRequestMessage({ organizationName: "Alder Creek Church", lines: [{ startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Praise band" }], link: worshipLinks.request(ORIGIN, "alder-creek", A) }),
    buildReminderMessage({ kind: "unanswered", organizationName: "Alder Creek Church", line: { startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Praise band" }, link: worshipLinks.request(ORIGIN, "alder-creek", A) }),
    buildReminderMessage({ kind: "confirmed", organizationName: "Alder Creek Church", line: { startsAt: "2026-11-15T09:00", positionName: "Drums", teamName: "Praise band" }, link: worshipLinks.home(ORIGIN, "alder-creek") }),
    buildCancelledMessage({ organizationName: "Alder Creek Church", startsAt: "2026-11-15T09:00", link: worshipLinks.home(ORIGIN, "alder-creek") }),
    buildDeclinedMessage({ organizationName: "Alder Creek Church", positionName: "Drums", startsAt: "2026-11-15T09:00", link: worshipLinks.board(ORIGIN, "alder-creek", G, E) }),
  ];

  it("no link has a query string, next or callbackUrl", () => {
    for (const m of all) {
      const body = everything(m);
      expect(body).not.toMatch(/callbackUrl|[?&]next=|href="[^"]*\?/);
      for (const url of body.match(/https?:\/\/[^\s"<]+/g) ?? []) expect(url, url).not.toContain("?");
    }
  });

  it("none mentions the reasons a person may give, 'minor', 'under 18' or a guardian (a child's notice is never written)", () => {
    for (const m of all) {
      expect(everything(m)).not.toMatch(/\b(away|family|work)\b:?\s*(?:reason)|under 18|minor|guardian|parent/i);
    }
  });

  it("every message is one of the four template keys, all distinct per kind", () => {
    const keys = new Set(all.map((m) => m.templateKey));
    expect([...keys].sort()).toEqual(Object.values(WORSHIP_TEMPLATE_KEYS).sort());
  });
});
