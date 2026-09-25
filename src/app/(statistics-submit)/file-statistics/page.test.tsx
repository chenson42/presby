// @vitest-environment jsdom
/**
 * Orchestration tests for `/file-statistics`'s page.tsx — increment 6
 * (D16/DECISION-147), `docs/work-log/2026-09-25-submission-grants.md`
 * Phase 4 batch C.
 *
 * What this file exists to pin, per Phase 2's BINDING enumeration rule
 * ("Flag-off on the public page must render the same generic copy as an
 * invalid token — otherwise flag state is an enumeration oracle"):
 *
 *   1. No `?token=` at all → the generic notice, no DB call.
 *   2. A live, flag-ON token → the real form, with the organization's name.
 *   3. A live token but the flag OFF → the SAME generic notice as an
 *      invalid token — `previewGrantedReturn()` itself does NOT check the
 *      flag (only the write boundary does), so this page must, and this
 *      test is what catches a regression of that fact.
 *   4. `previewGrantedReturn()` returning `null` (dead token, any cause) →
 *      the generic notice.
 *   5. Both the flag check and the preview lookup always run — a flag-off
 *      response performs the SAME preview lookup a live one does, so it
 *      cannot be measurably cheaper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const previewGrantedReturn = vi.fn();
vi.mock("@/lib/statistics-grants", () => ({
  previewGrantedReturn: (...args: unknown[]) => previewGrantedReturn(...args),
}));

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

// The live-token success path renders `<StatisticsSubmitForm>`, which
// imports `../actions` (`"use server"`) — a real load pulls `@/lib/audit`
// (also `server-only`) in transitively. Mocked the same way `statistics-
// submit-form.test.tsx` mocks it, for the identical reason.
vi.mock("../actions", () => ({
  submitGrantedReturnAction: vi.fn(),
}));

// `db.select().from().where().limit()` — the field-bounds read. Never
// reached unless the flag is on AND the token is live.
const fieldSpecLimitMock = vi.hoisted(() =>
  vi.fn((..._args: unknown[]) =>
    Promise.resolve([{ fieldSpec: { fields: {} } }] as { fieldSpec: unknown }[]),
  ),
);
vi.mock("@/lib/db", async () => {
  // Circular-import-avoidance shape (`(member)/home/page.test.tsx`'s own
  // precedent): force the real platform schema module to load FIRST, before
  // this mock factory returns — `@/lib/db/domain/returns` (which `page.tsx`
  // imports directly for `sasrFormVersions`, not through this mocked
  // module) transitively reaches `@/lib/db/domain/authz.ts`'s
  // `organizationType(...)` pgEnum call, and importing that chain before
  // `@/lib/db/schema` has finished initializing throws
  // "organizationType is not a function" — measured directly, not assumed.
  await import("@/lib/db/schema");
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: (...args: unknown[]) => fieldSpecLimitMock(...args),
          }),
        }),
      }),
    },
  };
});

import FileStatisticsPage from "./page";

afterEach(() => {
  cleanup();
  previewGrantedReturn.mockReset();
  isFlagEnabled.mockReset();
  fieldSpecLimitMock.mockClear();
});

function searchParams(token?: string) {
  return Promise.resolve(token ? { token } : {});
}

describe("FileStatisticsPage — no token", () => {
  it("renders the generic notice, with no DB call at all", async () => {
    const el = await FileStatisticsPage({ searchParams: searchParams() });
    render(el);
    expect(screen.getByText(/this link is no longer active/i)).toBeTruthy();
    expect(previewGrantedReturn).not.toHaveBeenCalled();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });
});

describe("FileStatisticsPage — live token, flag ON", () => {
  it("renders the real form, naming the organization", async () => {
    isFlagEnabled.mockResolvedValue(true);
    previewGrantedReturn.mockResolvedValue({
      aboutOrgName: "Quillhaven Presbyterian Church",
      reportYear: 2026,
      formVersionKey: "2024",
    });

    const el = await FileStatisticsPage({ searchParams: searchParams("dev-token") });
    render(el);

    expect(screen.getByText("Quillhaven Presbyterian Church")).toBeTruthy();
    expect(screen.queryByText(/this link is no longer active/i)).toBeNull();
  });
});

describe("FileStatisticsPage — live token, flag OFF (the enumeration-safety regression)", () => {
  it("renders the SAME generic notice as a dead token, never the form", async () => {
    isFlagEnabled.mockResolvedValue(false);
    previewGrantedReturn.mockResolvedValue({
      aboutOrgName: "Quillhaven Presbyterian Church",
      reportYear: 2026,
      formVersionKey: "2024",
    });

    const el = await FileStatisticsPage({ searchParams: searchParams("dev-token") });
    render(el);

    expect(screen.getByText(/this link is no longer active/i)).toBeTruthy();
    expect(screen.queryByText("Quillhaven Presbyterian Church")).toBeNull();
  });

  it("still performs the real preview lookup — a flag-off response is not cheaper", async () => {
    isFlagEnabled.mockResolvedValue(false);
    previewGrantedReturn.mockResolvedValue(null);

    await FileStatisticsPage({ searchParams: searchParams("dev-token") });

    expect(previewGrantedReturn).toHaveBeenCalledWith("dev-token");
    expect(isFlagEnabled).toHaveBeenCalledWith("statistics.submission_grants");
  });
});

describe("FileStatisticsPage — dead token (nonexistent/expired/revoked/spent), flag ON", () => {
  it("renders the generic notice", async () => {
    isFlagEnabled.mockResolvedValue(true);
    previewGrantedReturn.mockResolvedValue(null);

    const el = await FileStatisticsPage({ searchParams: searchParams("garbage-token") });
    render(el);

    expect(screen.getByText(/this link is no longer active/i)).toBeTruthy();
  });
});
