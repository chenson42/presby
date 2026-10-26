/**
 * U12: the Features page's off-warning for `org_portal.person_photos`
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan U12; Copy
 * C1). No database: `withOrgContext` and the photo count are mocked. The real
 * count over a real database is `public-photo.db.test.ts`
 * ("countChosenPhotos").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const FakeOrgAccessError = vi.hoisted(() => class FakeOrgAccessError extends Error {});
vi.mock("@/lib/authz", () => ({
  OrgAccessError: FakeOrgAccessError,
  withOrgContext: vi.fn(async (_p: string, _o: string, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() })),
}));
const count = vi.hoisted(() => vi.fn());
vi.mock("@/lib/person-photos/reader", () => ({ countChosenPhotos: (...a: unknown[]) => count(...a) }));

import { loadOffWarnings, PERSON_PHOTOS_FEATURE_KEY } from "./org-feature-warnings";
import { withOrgContext } from "@/lib/authz";

const KEY = PERSON_PHOTOS_FEATURE_KEY;
const TAIL_BROWSER = "Browsers that already saved a photo can keep showing it for up to a day.";

beforeEach(() => {
  count.mockReset();
});

describe("loadOffWarnings for org_portal.person_photos", () => {
  it("names the key the catalog carries", () => {
    expect(KEY).toBe("org_portal.person_photos");
  });

  it("no warning at zero chosen photos", async () => {
    count.mockResolvedValue(0);
    expect(await loadOffWarnings("p", "o", [KEY])).toEqual({});
  });

  it("one chosen photo: the singular wording, saying nothing is deleted and naming the cached-copy residual", async () => {
    count.mockResolvedValue(1);
    const out = await loadOffWarnings("p", "o", [KEY]);
    expect(out[KEY]).toEqual({
      title: "Photos of people will be hidden",
      description:
        "1 photo is currently chosen for the directory or the website. Turning this off hides it everywhere, including on your public website. " +
        `Nothing is deleted, and turning it back on restores it. ${TAIL_BROWSER}`,
    });
  });

  it("several chosen photos: the count and the plural wording", async () => {
    count.mockResolvedValue(7);
    const out = await loadOffWarnings("p", "o", [KEY]);
    expect(out[KEY]!.description).toBe(
      "7 photos are currently chosen for the directory or the website. Turning this off hides them everywhere, including on your public website. " +
        `Nothing is deleted, and turning it back on restores them. ${TAIL_BROWSER}`,
    );
    expect(out[KEY]!.description).not.toMatch(/\bshown\b/); // "chosen for", never "shown": a minor or a hidden photo is withheld anyway
  });

  it("the warning asks for the DISTINCT-photo count: the Features page calls countChosenPhotos with the transaction (T9)", async () => {
    count.mockResolvedValue(1);
    await loadOffWarnings("p", "o", [KEY]);
    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]![0]).toBeDefined();
  });

  it("an unreadable count still warns, generically, and never claims a count", async () => {
    count.mockRejectedValue(new Error("connection reset"));
    const out = await loadOffWarnings("p", "o", [KEY]);
    expect(out[KEY]).toEqual({
      title: "Photos of people will be hidden",
      description:
        `Turning this off hides every photo of a person, including on your public website. Nothing is deleted. ${TAIL_BROWSER}`,
    });
  });

  it("an OrgAccessError propagates (the page rethrows it) instead of becoming a generic warning", async () => {
    vi.mocked(withOrgContext).mockRejectedValueOnce(new FakeOrgAccessError("no membership"));
    await expect(loadOffWarnings("p", "o", [KEY])).rejects.toBeInstanceOf(FakeOrgAccessError);
  });

  it("a toggle that is not in the enabled list gets no loader call at all", async () => {
    expect(await loadOffWarnings("p", "o", ["org_portal.calendar"])).toEqual({});
    expect(count).not.toHaveBeenCalled();
  });
});
