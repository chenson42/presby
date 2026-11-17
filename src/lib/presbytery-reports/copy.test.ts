import { describe, expect, it } from "vitest";
import { CALL_TYPE_LABELS } from "@/app/(org)/o/[slug]/admin/credentials/credential-labels";
import { REPORTS } from "./contract";
import {
  DASHBOARD_COPY,
  HUB_COPY,
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
