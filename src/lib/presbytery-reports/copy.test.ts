import { describe, expect, it } from "vitest";
import { CALL_TYPE_LABELS } from "@/app/(org)/o/[slug]/admin/credentials/credential-labels";
import { REPORTS } from "./contract";
import { VIABILITY_LABELS, VIABILITY_NOT_ASSESSED } from "./derive";
import {
  DASHBOARD_COPY,
  HUB_COPY,
  MAP_COPY,
  PER_CAPITA_COPY,
  ROUTE_COPY,
  SUPPLY_CALL_TYPE_LABELS,
  allCopyStrings,
  formatCount,
  formatDollars,
} from "./copy";

const strings = allCopyStrings();

describe("copy", () => {
  it("collects a meaningful set of strings", () => {
    expect(strings.length).toBeGreaterThan(60);
    for (const s of strings) expect(s.trim()).not.toBe("");
  });

  it("never claims two-factor (F445: the two tier-2 keys do not force it)", () => {
    for (const s of strings) expect(s).not.toMatch(/two.?factor|2FA|second factor|verification code/i);
  });

  it("contains nothing the e2e suite's 'don't have permission to manage' matcher would also hit", () => {
    for (const s of strings) expect(s).not.toMatch(/don't have permission to manage/i);
  });

  it("uses no phrase check:help bans (no future promises)", () => {
    for (const s of strings) {
      expect(s).not.toMatch(/\b(coming soon|will be able to|planned|in a future release|in the future|next release|later this year|stay tuned)\b/i);
    }
  });

  it("the locked reason names every report's permission phrase", async () => {
    const { HUB_COPY } = await import("./copy");
    for (const r of REPORTS) {
      const text = HUB_COPY.lockedReason(r.permissionPhrase);
      expect(text).toContain(r.permissionPhrase);
      expect(text).toMatch(/Roles/);
    }
  });

  it("the three supply labels equal the Credentials page's wording", () => {
    for (const [type, label] of Object.entries(SUPPLY_CALL_TYPE_LABELS)) {
      expect(label).toBe(CALL_TYPE_LABELS[type as keyof typeof CALL_TYPE_LABELS]);
    }
  });

  it("the route bodies are the contracted plain sentences", () => {
    expect(ROUTE_COPY.forbidden).toBe("You don't have permission to export this report.");
    expect(ROUTE_COPY.exportFailed).toBe("We can't prepare that file right now. Try again in a moment.");
    expect(ROUTE_COPY.nothingToExport).toBe("There is nothing to export yet. No pastoral appointments are recorded.");
  });
});

describe("dashboard copy (DECISION-342)", () => {
  it("the forbidden body names every report's permission phrase", () => {
    for (const r of REPORTS) expect(DASHBOARD_COPY.forbidden.body).toContain(r.permissionPhrase);
    expect(DASHBOARD_COPY.forbidden.body).toMatch(/Roles/);
  });

  it("the locked reason the cards reuse names each phrase (the hub's wording, not a second copy)", () => {
    for (const r of REPORTS) expect(HUB_COPY.lockedReason(r.permissionPhrase)).toContain(r.permissionPhrase);
  });

  it("the members note says what is excluded", () => {
    const note = DASHBOARD_COPY.members.note("Northern Reach");
    expect(note).toContain("Northern Reach");
    expect(note).toMatch(/New worshiping communities/);
    expect(note).toMatch(/left or closed/);
  });

  it("the dashboard strings are in the swept set, with the year, fraction and count templates sampled", () => {
    expect(strings).toContain(DASHBOARD_COPY.pageError);
    expect(strings).toContain(DASHBOARD_COPY.trend.yearLine(2025, 9, 12));
    expect(strings).toContain(DASHBOARD_COPY.perCapita.title(2025));
  });

  it("the plain dashboard strings name no section and give no instruction", () => {
    const plain = [
      DASHBOARD_COPY.perCapita.noRatePlain(2026),
      DASHBOARD_COPY.perCapita.rateSetPlain(2026),
      DASHBOARD_COPY.vacant.notRecordedNoLink,
    ];
    expect(plain).toEqual([
      "No rate is set for 2026.",
      "A rate is set for 2026. The bills have not been generated.",
      "So vacancies can't be worked out.",
    ]);
    for (const s of plain) expect(s).not.toMatch(/Credentials|Per-Capita section|Congregation Statistics|Oversight|Open |Set one|Record|Generate the/);
    // allCopyStrings samples year templates with 2025
    expect(strings).toContain(DASHBOARD_COPY.perCapita.noRatePlain(2025));
    expect(strings).toContain(DASHBOARD_COPY.perCapita.rateSetPlain(2025));
    expect(strings).toContain(DASHBOARD_COPY.vacant.notRecordedNoLink);
  });

  it("the templates read as drafted", () => {
    expect(DASHBOARD_COPY.trend.yearLine(2025, 9, 12)).toBe("2025: 9 of 12 reporting");
    expect(DASHBOARD_COPY.perCapita.countLine(1, 1)).toBe("1 of 1 congregation billed");
    expect(DASHBOARD_COPY.perCapita.countLine(8, 12)).toBe("8 of 12 congregations billed");
    expect(DASHBOARD_COPY.perCapita.departed(1)).toBe("Includes 1 congregation that is no longer a member.");
    expect(DASHBOARD_COPY.perCapita.departed(2)).toBe("Includes 2 congregations that are no longer members.");
    expect(DASHBOARD_COPY.perCapita.title(2026)).toBe("Per capita, 2026");
    expect(DASHBOARD_COPY.empty.body).toMatch(/PresbyPortal team/);
  });

  it("never prints a dollar zero where a figure is missing: no card string is a dollar amount", () => {
    for (const s of Object.values(DASHBOARD_COPY.perCapita)) {
      if (typeof s === "string") expect(s).not.toMatch(/\$0\.00/);
    }
  });
});

describe("formatCount", () => {
  it("groups thousands and refuses a non-integer", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(-4200)).toBe("-4,200");
    expect(() => formatCount(1.5)).toThrow(RangeError);
  });
});

describe("formatDollars", () => {
  it("groups thousands, keeps cents, and reads a negative as a credit", () => {
    expect(formatDollars(262500)).toBe("$2,625.00");
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars(5)).toBe("$0.05");
    expect(formatDollars(-1200)).toBe("$12.00 credit");
    expect(formatDollars(123456789)).toBe("$1,234,567.89");
  });

  it("refuses a non-integer", () => {
    expect(() => formatDollars(1.5)).toThrow(RangeError);
  });

  it("the per-capita statuses and reasons read as contracted", () => {
    expect(PER_CAPITA_COPY.status).toEqual({ unpaid: "Unpaid", partly_paid: "Partly paid", paid: "Paid", not_billed: "Not billed" });
    expect(PER_CAPITA_COPY.notBilled.no_statistics(2023)).toBe("No statistics on file for 2023");
    expect(PER_CAPITA_COPY.notBilled.not_generated).toBe("Not generated yet");
  });
});

describe("map copy (DECISION-343)", () => {
  it("is in the swept set (so the two-factor, permission and future-tense bans cover it)", () => {
    expect(strings).toContain(MAP_COPY.title);
    expect(strings).toContain(MAP_COPY.tilesError);
    expect(strings).toContain(MAP_COPY.caption(3, 9));
    expect(strings).toContain(MAP_COPY.popup.rating("Northern Reach"));
  });

  it("the caption reads as drafted for one, several and a single-congregation presbytery", () => {
    expect(MAP_COPY.caption(1, 12)).toBe("1 of 12 congregations has a location.");
    expect(MAP_COPY.caption(2, 12)).toBe("2 of 12 congregations have a location.");
    expect(MAP_COPY.caption(1, 1)).toBe("1 of 1 congregation has a location.");
  });

  it("the legend labels equal the list's labels, one per score plus 'not yet assessed', each with its own shape", () => {
    const labels = MAP_COPY.legend.items.map((i) => i.label);
    expect(labels).toEqual([VIABILITY_LABELS[1], VIABILITY_LABELS[2], VIABILITY_LABELS[3], VIABILITY_NOT_ASSESSED]);
    expect(new Set(MAP_COPY.legend.items.map((i) => i.shape)).size).toBe(4);
  });

  it("no heading contains a phrase the dashboard's other headings are found by (the e2e matches substrings)", () => {
    const headings = [MAP_COPY.title, MAP_COPY.unplaced.heading, MAP_COPY.legend.heading];
    for (const h of headings) {
      expect(h).not.toMatch(/member congregations|viability|vacant pulpits|ending active members|per capita|insights & analytics/i);
    }
  });

  it("the oversight-off sentence states the fact and gives no instruction to use the page", () => {
    expect(MAP_COPY.oversightOff("Northern Reach")).toBe(
      "Locations are entered on Congregation Oversight, which isn't turned on for Northern Reach yet.",
    );
    expect(MAP_COPY.oversightOff("Northern Reach")).not.toMatch(/Open |Add |Enter /);
  });

  it("a failed read and a failed tile never read as an empty state, and both point at the list", () => {
    for (const s of [MAP_COPY.readError, MAP_COPY.tilesError]) {
      expect(s).toMatch(/list below has every congregation/);
      expect(s).not.toMatch(/no congregation|usable location|has a location/i);
    }
  });

  it("is import-free (the client files import it)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./copy.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/^import /m);
  });

  it("attribution links are the providers' own pages on https", () => {
    const a = MAP_COPY.attribution;
    expect(a.maptilerHref).toBe("https://www.maptiler.com/copyright/");
    expect(a.osmHref).toBe("https://www.openstreetmap.org/copyright");
    expect(a.logoHref).toBe("https://www.maptiler.com/");
    expect(a.logoSrc).toBe("https://api.maptiler.com/resources/logo.svg");
  });
});
