import { describe, expect, it, vi } from "vitest";
import {
  CHANGE_CLASSES,
  TICKET_AREAS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  CHANGE_CLASS_LABELS,
  TICKET_AREA_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  PRIORITY_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
} from "./tickets-labels";

const LEGAL_BADGE_VARIANTS = new Set(["default", "secondary", "outline", "destructive"]);

describe("tickets-labels — every vocabulary value has a label and a legal Badge variant", () => {
  it("every change class has a label", () => {
    for (const value of CHANGE_CLASSES) {
      expect(CHANGE_CLASS_LABELS[value]).toBeTruthy();
    }
  });
  it("every area has a label", () => {
    for (const value of TICKET_AREAS) {
      expect(TICKET_AREA_LABELS[value]).toBeTruthy();
    }
  });
  it("every priority has a label and a Badge variant — no raw Tailwind palette literal", () => {
    for (const value of TICKET_PRIORITIES) {
      expect(TICKET_PRIORITY_LABELS[value]).toBeTruthy();
      expect(LEGAL_BADGE_VARIANTS.has(PRIORITY_BADGE_VARIANT[value])).toBe(true);
    }
  });
  it("every status has a label and a Badge variant — no raw Tailwind palette literal", () => {
    for (const value of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABELS[value]).toBeTruthy();
      expect(LEGAL_BADGE_VARIANTS.has(STATUS_BADGE_VARIANT[value])).toBe(true);
    }
  });
});

/**
 * `tickets-labels.ts` re-declares the four vocabulary arrays (a client
 * component can't import them from `tickets.ts` — see that file's own
 * header). This is the guardrail that catches drift, but importing the
 * real `./tickets` module reaches `@/lib/db`'s module-scope pool
 * construction before `DATABASE_URL` is confirmed set (same problem
 * `tickets.test.ts`'s own header names) — so, same fix: `server-only`
 * neutralized, a `hasDb` skip-guard, and a dynamic `import("./tickets")`
 * rather than a static one. SKIPPED, not failed, when `DATABASE_URL` is
 * unset (`npm test` in CI).
 */
vi.mock("server-only", () => ({}));

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)(
  "tickets-labels — arrays stay byte-identical to src/lib/tickets.ts",
  () => {
    it("CHANGE_CLASSES/TICKET_AREAS/TICKET_PRIORITIES/TICKET_STATUSES all match", async () => {
      const real = await import("./tickets");
      expect(CHANGE_CLASSES).toEqual(real.CHANGE_CLASSES);
      expect(TICKET_AREAS).toEqual(real.TICKET_AREAS);
      expect(TICKET_PRIORITIES).toEqual(real.TICKET_PRIORITIES);
      expect(TICKET_STATUSES).toEqual(real.TICKET_STATUSES);
    });
  },
);
