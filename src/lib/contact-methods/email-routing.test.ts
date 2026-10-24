import { describe, expect, it } from "vitest";
import {
  EMAIL_DISPLAY_ORDER_SQL,
  EMAIL_PROMOTION_ORDER_SQL,
  EMAIL_PURPOSES,
  chooseEmail,
  nextPrimaryAfterRemoval,
  sortEmailRows,
} from "./email-routing";
import { row } from "./test-rows";
import type { ActiveEmailRow, EmailPurpose } from "./types";

const ids = (r: ActiveEmailRow | null) => (r ? r.id : null);

describe("chooseEmail — the ER12 table", () => {
  it("returns null for no rows, for every purpose", () => {
    for (const p of EMAIL_PURPOSES) expect(chooseEmail([], p)).toBeNull();
  });

  describe("credential: the active main, even when do_not_contact", () => {
    it("is the main whatever its label", () => {
      const rows = [row("w", { subtype: "work", main: true }), row("p", { subtype: "personal" })];
      expect(ids(chooseEmail(rows, "credential"))).toBe("w");
    });
    it("returns a do_not_contact main (the caller acknowledges it)", () => {
      const rows = [row("m", { main: true, dnc: true }), row("o")];
      expect(chooseEmail(rows, "credential")).toMatchObject({ id: "m", doNotContact: true });
    });
    it("is null when no row is main (the database makes this impossible; the function does not guess)", () => {
      expect(chooseEmail([row("a"), row("b")], "credential")).toBeNull();
    });
  });

  describe("role: a Work address first, then canonical order, skipping do_not_contact", () => {
    it("prefers an active Work address over a Personal main", () => {
      const rows = [row("p", { subtype: "personal", main: true }), row("w", { subtype: "work" })];
      expect(ids(chooseEmail(rows, "role"))).toBe("w");
    });
    it("takes the first Work row in canonical order when several", () => {
      const rows = [
        row("m", { subtype: "personal", main: true }),
        row("w1", { subtype: "work" }),
        row("w2", { subtype: "work" }),
      ];
      expect(ids(chooseEmail(rows, "role"))).toBe("w1");
    });
    it("falls back to the main when there is no Work address", () => {
      const rows = [row("m", { subtype: "personal", main: true }), row("o", { subtype: "other" })];
      expect(ids(chooseEmail(rows, "role"))).toBe("m");
    });
    it("skips a do_not_contact Work address and uses the next", () => {
      const rows = [
        row("m", { subtype: "personal", main: true }),
        row("w", { subtype: "work", dnc: true }),
      ];
      expect(ids(chooseEmail(rows, "role"))).toBe("m");
    });
    it("is null when everything is do_not_contact", () => {
      expect(chooseEmail([row("m", { main: true, dnc: true })], "role")).toBeNull();
    });
    it("a single Work main is the answer", () => {
      expect(ids(chooseEmail([row("w", { subtype: "work", main: true })], "role"))).toBe("w");
    });
  });

  describe("personal: never a Work address; a null label counts as non-Work", () => {
    it("uses the main when it is not Work", () => {
      const rows = [row("m", { subtype: "personal", main: true }), row("w", { subtype: "work" })];
      expect(ids(chooseEmail(rows, "personal"))).toBe("m");
    });
    it("a null-labelled main is non-Work", () => {
      expect(ids(chooseEmail([row("m", { subtype: null, main: true })], "personal"))).toBe("m");
    });
    it("skips a Work main for the first Personal or Other address", () => {
      const rows = [
        row("w", { subtype: "work", main: true }),
        row("o", { subtype: "other" }),
        row("p", { subtype: "personal" }),
      ];
      expect(ids(chooseEmail(rows, "personal"))).toBe("o");
    });
    it("is null when the only address is Work (no send)", () => {
      expect(chooseEmail([row("w", { subtype: "work", main: true })], "personal")).toBeNull();
    });
    it("skips do_not_contact", () => {
      const rows = [row("m", { main: true, dnc: true }), row("o", { subtype: "other" })];
      expect(ids(chooseEmail(rows, "personal"))).toBe("o");
    });
  });

  it("an unknown purpose throws, never falls back (R35)", () => {
    expect(() => chooseEmail([row("a", { main: true })], "marketing" as EmailPurpose)).toThrow(/unknown purpose/);
  });

  it("never re-sorts: it trusts the order it was given", () => {
    const rows = [row("late", { subtype: "work" }), row("early", { subtype: "work" })];
    expect(ids(chooseEmail(rows, "role"))).toBe("late");
  });
});

describe("nextPrimaryAfterRemoval", () => {
  const rows = [
    row("main", { main: true }),
    row("older", { subtype: "work" }),
    row("newer", { subtype: "personal" }),
  ];
  it("is the first remaining row in canonical order, whatever its label", () => {
    expect(ids(nextPrimaryAfterRemoval(rows, new Set(["main"])))).toBe("older");
    expect(ids(nextPrimaryAfterRemoval(rows, ["main", "older"]))).toBe("newer");
  });
  it("is null when nothing is left", () => {
    expect(nextPrimaryAfterRemoval(rows, ["main", "older", "newer"])).toBeNull();
    expect(nextPrimaryAfterRemoval([], [])).toBeNull();
  });
});

describe("sortEmailRows (unsaved rows on the client)", () => {
  it("puts the main first, then oldest by epoch milliseconds, then id", () => {
    const sorted = sortEmailRows([
      { id: "b", isPrimary: false, createdAt: "2026-01-01T00:00:02.000000Z" },
      { id: "a", isPrimary: false, createdAt: "2026-01-01T00:00:02.000000Z" },
      { id: "m", isPrimary: true, createdAt: "2026-01-01T00:00:09.000000Z" },
      { id: "o", isPrimary: false, createdAt: "2026-01-01T00:00:01.000000Z" },
      { isPrimary: false },
    ]);
    expect(sorted.map((r) => r.id ?? "(new)")).toEqual(["m", "o", "a", "b", "(new)"]);
  });
  it("does not mutate its input", () => {
    const input = [
      { id: "b", isPrimary: false },
      { id: "a", isPrimary: true },
    ];
    sortEmailRows(input);
    expect(input.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("the shared order constants (ER1a)", () => {
  it("are the documented text the SQL mirrors", () => {
    expect(EMAIL_DISPLAY_ORDER_SQL).toBe("is_primary desc, created_at, id");
    expect(EMAIL_PROMOTION_ORDER_SQL).toBe("created_at, id");
  });
});
