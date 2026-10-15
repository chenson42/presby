import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIME_ZONES, useProcessTimeZone } from "@/lib/testing/time-zone";
import {
  buildMonthClipboard,
  copiedMessage,
  type ClipboardEntry,
} from "./clipboard";

const OCT = { year: 2026, month: 10 };

function entry(over: Partial<ClipboardEntry> & { startsAtWallClock: string; title: string }): ClipboardEntry {
  return {
    dayKey: over.startsAtWallClock.slice(0, 10),
    location: null,
    isPublic: true,
    ...over,
  };
}

describe.each(TEST_TIME_ZONES)("calendar/clipboard under process TZ=%s", (zone) => {
  useProcessTimeZone(zone, { beforeAll, afterAll });

  it("plain text: heading, a blank line, then one block per day that has entries", () => {
    const { text } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-04T10:00", title: "Sunday worship", location: "Sanctuary" }),
      entry({ startsAtWallClock: "2026-10-04T19:30", title: "Choir rehearsal" }),
      entry({ startsAtWallClock: "2026-10-07T12:00", title: "Lunch" }),
    ]);
    expect(text).toBe(
      [
        "October 2026",
        "",
        "Sun Oct 4",
        "  10a Sunday worship - Sanctuary",
        "  7:30p Choir rehearsal",
        "",
        "Wed Oct 7",
        "  12p Lunch",
        "",
      ].join("\n"),
    );
    // Ends with a single newline.
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("an empty month is the heading plus a blank line, and an empty table", () => {
    const { text, html, includedCount, leftOutCount } = buildMonthClipboard(OCT, []);
    expect(text).toBe("October 2026\n\n");
    expect(includedCount).toBe(0);
    expect(leftOutCount).toBe(0);
    expect(html).toContain("<h2>October 2026</h2>");
    // ui-ok: asserting on the clipboard's HTML string, not rendering a table
    expect(html).toContain("<table");
  });

  it("HTML: a heading, one table, seven weekday header cells, 35 day cells for October 2026", () => {
    const { html } = buildMonthClipboard(OCT, []);
    expect(html.startsWith("<h2>October 2026</h2>")).toBe(true);
    // ui-ok: asserting on the clipboard's HTML string, not rendering a table
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html.match(/<th /g)).toHaveLength(7);
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(html).toContain(`>${day}</th>`);
    }
    expect(html.match(/<td /g)).toHaveLength(35);
  });

  it("HTML carries no colour anywhere", () => {
    const { html } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-04T10:00", title: "Worship" }),
    ]);
    expect(html).not.toMatch(/color|background|#[0-9a-f]{3,6}\b|rgb|hsl|oklch/i);
  });

  it("escapes HTML in titles and locations (a <script> title, an & location)", () => {
    const { html, text } = buildMonthClipboard(OCT, [
      entry({
        startsAtWallClock: "2026-10-04T10:00",
        title: "<script>alert(1)</script>",
        location: "Fellowship & Fun \"Hall\"",
      }),
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Fellowship &amp; Fun &quot;Hall&quot;");
    // Plain text is not HTML: it carries the characters as typed.
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("drops non-public and cancelled entries, counting them in leftOutCount", () => {
    const result = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-04T10:00", title: "Public one" }),
      entry({ startsAtWallClock: "2026-10-05T10:00", title: "Members only secret", isPublic: false }),
      entry({ startsAtWallClock: "2026-10-06T10:00", title: "Cancelled thing", isCancelled: true }),
      entry({ startsAtWallClock: "2026-10-07T10:00", title: "Another members only", isPublic: false }),
    ]);
    expect(result.includedCount).toBe(1);
    expect(result.leftOutCount).toBe(3);
    for (const s of [result.html, result.text]) {
      expect(s).toContain("Public one");
      expect(s).not.toContain("Members only secret");
      expect(s).not.toContain("Cancelled thing");
      expect(s).not.toContain("Another members only");
    }
  });

  it("adjacent-month days are numbered but empty, and are not counted", () => {
    const result = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-09-28T10:00", title: "September thing" }),
      entry({ startsAtWallClock: "2026-11-01T10:00", title: "November thing" }),
      entry({ startsAtWallClock: "2026-09-29T10:00", title: "September secret", isPublic: false }),
    ]);
    expect(result.html).not.toContain("September thing");
    expect(result.html).not.toContain("November thing");
    expect(result.text).not.toContain("September thing");
    expect(result.includedCount).toBe(0);
    // Not counted as "left out": they belong to another month's copy.
    expect(result.leftOutCount).toBe(0);
    // The grid still numbers the adjacent days (27-30 of September, bare, no <strong>).
    for (const n of [27, 28, 29, 30]) {
      expect(result.html).toMatch(new RegExp(`<td [^>]*>${n}</td>`));
    }
    // ...and in-month days are bold.
    expect(result.html).toContain("<strong>1</strong>");
  });

  it("a multi-day event appears exactly once, on its start day", () => {
    const { html, text } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-09T18:00", title: "Retreat weekend" }),
    ]);
    expect(html.match(/Retreat weekend/g)).toHaveLength(1);
    expect(text.match(/Retreat weekend/g)).toHaveLength(1);
    expect(text).toContain("Fri Oct 9\n  6p Retreat weekend");
  });

  it("orders entries within a day by time, however they arrive", () => {
    const { text } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-04T19:00", title: "Evening" }),
      entry({ startsAtWallClock: "2026-10-04T09:00", title: "Morning" }),
    ]);
    expect(text.indexOf("Morning")).toBeLessThan(text.indexOf("Evening"));
  });

  it("collapses newlines in a title or location so the text layout holds", () => {
    const { text } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-04T10:00", title: "Line one\nline two", location: "Room\n3" }),
    ]);
    expect(text).toContain("  10a Line one line two - Room 3");
  });

  it("carries no org name, address, id, URL, path, description, creator, type name or colour", () => {
    const { html, text } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-04T10:00", title: "Worship", location: "Sanctuary" }),
    ]);
    for (const s of [html, text]) {
      expect(s).not.toMatch(/https?:|\/o\/|@|example|[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });

  it("is the same in every process zone for a late-evening event on the last day of the month", () => {
    const { text } = buildMonthClipboard(OCT, [
      entry({ startsAtWallClock: "2026-10-31T23:30", title: "Vigil" }),
    ]);
    expect(text).toContain("Sat Oct 31\n  11:30p Vigil");
  });
});

describe("copiedMessage", () => {
  it("covers the four shapes and the plural", () => {
    expect(copiedMessage(0, null)).toBe("Calendar copied");
    expect(copiedMessage(2, null)).toBe("Calendar copied (2 members-only events left out)");
    expect(copiedMessage(1, null)).toBe("Calendar copied (1 members-only event left out)");
    expect(copiedMessage(0, "Worship only")).toBe("Calendar copied (Worship only)");
    expect(copiedMessage(1, "Worship only")).toBe(
      "Calendar copied (1 members-only event left out; Worship only)",
    );
  });
});
