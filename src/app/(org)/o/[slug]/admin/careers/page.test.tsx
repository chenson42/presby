// @vitest-environment jsdom
/**
 * Orchestration tests for the three careers staff pages (docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 T20): the auth ladder, the four lib states (feature off with and without the Features
 * link, forbidden, load error), the empty state, the list with its placement line, the new page's
 * gate, and the edit page's not-found, malformed-id and status paths. The gate itself is proven
 * in `postings.db.test.ts`; this pins what each page does with each answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PostingRow } from "@/lib/careers/postings";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: () => cachedAuth() }));

const resolveOrgContext = vi.fn();
const assertOrgAccess = vi.fn();
vi.mock("@/lib/authz", () => {
  class MockOrgAccessError extends Error {
    constructor() {
      super("mock: no active membership");
      this.name = "OrgAccessError";
    }
  }
  return {
    OrgAccessError: MockOrgAccessError,
    resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a),
    assertOrgAccess: (...a: unknown[]) => assertOrgAccess(...a),
  };
});

const listPostings = vi.fn();
const getPosting = vi.fn();
vi.mock("@/lib/careers/postings", () => ({
  listPostings: (...a: unknown[]) => listPostings(...a),
  getPosting: (...a: unknown[]) => getPosting(...a),
}));
const readPlacement = vi.fn();
vi.mock("@/lib/careers/placement-read", () => ({ readPlacement: (...a: unknown[]) => readPlacement(...a) }));

vi.mock("./actions", () => ({
  createPostingAction: vi.fn(),
  updatePostingAction: vi.fn(),
  setPostingStatusAction: vi.fn(),
  movePostingAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrgAccessError } from "@/lib/authz";
import CareersAdminPage from "./page";
import NewPostingPage from "./new/page";
import EditPostingPage from "./[postingId]/page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  listPostings.mockReset();
  getPosting.mockReset();
  readPlacement.mockReset();
});

const OK_RESOLVED = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "person-1", name: "Alder Creek Presbyterian Church", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const params = (): Promise<{ slug: string }> => Promise.resolve({ slug: "alder-creek" });
const signedIn = () => {
  cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
};

const POSTING_ID = "11111111-1111-4111-8111-111111111111";
function posting(overrides: Partial<PostingRow> = {}): PostingRow {
  return {
    id: POSTING_ID,
    slug: "custodian",
    title: "Custodian",
    summary: "s",
    location: "Main campus",
    employmentType: "full_time",
    payMinCents: null,
    payMaxCents: null,
    payUnit: null,
    descriptionMd: "d",
    closingDate: null,
    status: "published",
    sortOrder: 0,
    version: 2,
    postedOn: "2026-10-30",
    firstPublishedAt: "2026-10-30T00:00:00Z",
    closedAt: null,
    updatedAt: "2026-10-30T00:00:00Z",
    visibleToPublic: true,
    ...overrides,
  };
}

describe("CareersAdminPage - T20", () => {
  it("sends a signed-out visitor to sign in, keeping the deep link", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(CareersAdminPage({ params: params() })).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fcareers");
  });

  it("an unknown organization is notFound(); a non-member sees the access-denied state and nothing is read", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(CareersAdminPage({ params: params() })).rejects.toThrow("NOT_FOUND");
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder Creek", organizationType: "congregation" });
    render(await CareersAdminPage({ params: params() }));
    expect(listPostings).not.toHaveBeenCalled();
  });

  it("toggle off, viewer can manage features: the S1 state with the Features link", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "feature_off", canManageFeatures: true });
    render(await CareersAdminPage({ params: params() }));
    expect(screen.getByTestId("careers-feature-off").textContent).toContain("Job openings aren't turned on for Alder Creek Presbyterian Church yet.");
    expect(screen.getByRole("link", { name: "Turn them on under Features" })).toBeTruthy();
    expect(readPlacement).not.toHaveBeenCalled();
  });

  it("toggle off, viewer cannot: the ask-someone sentence and no link", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "feature_off", canManageFeatures: false });
    render(await CareersAdminPage({ params: params() }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("careers-feature-off").textContent).toContain("Ask someone who manages");
  });

  it("forbidden is S2, and a load failure is S3 with a retry - an OrgAccessError is re-thrown", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "forbidden" });
    render(await CareersAdminPage({ params: params() }));
    expect(screen.getByTestId("careers-forbidden")).toBeTruthy();
    cleanup();
    listPostings.mockRejectedValue(new Error("db down"));
    render(await CareersAdminPage({ params: params() }));
    expect(screen.getByTestId("careers-load-error")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" })).toBeTruthy();
    listPostings.mockRejectedValue(new (OrgAccessError as unknown as new () => Error)());
    await expect(CareersAdminPage({ params: params() })).rejects.toThrow("no active membership");
  });

  it("an unexpected result kind is the load error, never an empty list", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "stale" });
    render(await CareersAdminPage({ params: params() }));
    expect(screen.getByTestId("careers-load-error")).toBeTruthy();
    expect(screen.queryByText("You haven't created any job openings yet.")).toBeNull();
  });

  it("empty: the heading, the organization, the New button, the placement line and the first-opening action", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "ok", data: { postings: [], orgToday: "2026-11-03" } });
    readPlacement.mockResolvedValue({ kind: "known", pages: [] });
    render(await CareersAdminPage({ params: params() }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Job openings");
    expect(screen.getByRole("link", { name: "New job opening" }).getAttribute("href")).toBe("/o/alder-creek/admin/careers/new");
    expect(screen.getByRole("link", { name: "Create your first job opening" })).toBeTruthy();
    expect(screen.getByTestId("careers-placement").textContent).toContain("Your openings are listed at ");
    expect(readPlacement).toHaveBeenCalledWith("alder-creek");
  });

  it("with postings: sections, and an unreadable bundle is reported honestly", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "ok", data: { postings: [posting()], orgToday: "2026-11-03" } });
    readPlacement.mockResolvedValue({ kind: "unknown" });
    render(await CareersAdminPage({ params: params() }));
    expect(screen.getByRole("heading", { level: 2, name: "Published (1)" })).toBeTruthy();
    expect(screen.getByTestId("careers-placement").textContent).toBe(
      "We couldn't check your published website, so we can't say where your openings appear.",
    );
  });
});

describe("NewPostingPage - T20", () => {
  it("runs the lib's gate (toggle, then permission) before showing any form", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "feature_off", canManageFeatures: false });
    render(await NewPostingPage({ params: params() }));
    expect(screen.getByTestId("careers-feature-off")).toBeTruthy();
    expect(screen.queryByLabelText(/^Title/)).toBeNull();
    cleanup();
    listPostings.mockResolvedValue({ kind: "forbidden" });
    render(await NewPostingPage({ params: params() }));
    expect(screen.getByTestId("careers-forbidden")).toBeTruthy();
  });

  it("allowed: the New heading, a way back and the form", async () => {
    signedIn();
    listPostings.mockResolvedValue({ kind: "ok", data: { postings: [], orgToday: "2026-11-03" } });
    render(await NewPostingPage({ params: params() }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("New job opening");
    expect(screen.getByRole("link", { name: /Back to job openings/ }).getAttribute("href")).toBe("/o/alder-creek/admin/careers");
    expect(screen.getByLabelText(/^Title/)).toBeTruthy();
  });
});

describe("EditPostingPage - T20", () => {
  const editParams = (postingId: string) => Promise.resolve({ slug: "alder-creek", postingId });

  it("a malformed id is the not-found state and never reaches the database", async () => {
    signedIn();
    render(await EditPostingPage({ params: editParams("not-a-guid") }));
    expect(screen.getByTestId("careers-not-found")).toBeTruthy();
    expect(getPosting).not.toHaveBeenCalled();
  });

  it("an unknown or other-organization id is the not-found state", async () => {
    signedIn();
    getPosting.mockResolvedValue({ kind: "not_found" });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByText("That job opening couldn't be found.")).toBeTruthy();
  });

  it("feature off and forbidden carry through from the lib", async () => {
    signedIn();
    getPosting.mockResolvedValue({ kind: "feature_off", canManageFeatures: true });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByRole("link", { name: "Turn them on under Features" })).toBeTruthy();
    cleanup();
    getPosting.mockResolvedValue({ kind: "forbidden" });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByTestId("careers-forbidden")).toBeTruthy();
  });

  it("published and open: title heading, badge, View on your website, a read-only slug and Close", async () => {
    signedIn();
    getPosting.mockResolvedValue({ kind: "ok", data: { posting: posting(), orgToday: "2026-11-03" } });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Custodian");
    expect(screen.getByText("Published")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View on your website" }).getAttribute("href")).toBe("/site/alder-creek/careers/custodian");
    expect((screen.getByLabelText("Web address") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: "Close this opening" })).toBeTruthy();
    expect(getPosting).toHaveBeenCalledWith("person-1", "org-1", POSTING_ID);
  });

  it("a draft has an editable slug, Publish and Discard, and no website link", async () => {
    signedIn();
    getPosting.mockResolvedValue({
      kind: "ok",
      data: { posting: posting({ status: "draft", firstPublishedAt: null, postedOn: null, visibleToPublic: false }), orgToday: "2026-11-03" },
    });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByText("Draft")).toBeTruthy();
    expect((screen.getByLabelText("Web address") as HTMLInputElement).readOnly).toBe(false);
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard this draft" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View on your website" })).toBeNull();
  });

  it("a discarded draft is 'Never published' and offers no Reopen", async () => {
    signedIn();
    getPosting.mockResolvedValue({
      kind: "ok",
      data: { posting: posting({ status: "closed", firstPublishedAt: null, postedOn: null, visibleToPublic: false }), orgToday: "2026-11-03" },
    });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByText("Never published")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("a closed posting after publishing offers Reopen, with the passed-date note when it applies", async () => {
    signedIn();
    getPosting.mockResolvedValue({
      kind: "ok",
      data: { posting: posting({ status: "closed", visibleToPublic: false, closingDate: "2026-10-31" }), orgToday: "2026-11-03" },
    });
    render(await EditPostingPage({ params: editParams(POSTING_ID) }));
    expect(screen.getByRole("button", { name: "Reopen" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Its closing date has passed. Change the closing date, save, then reopen.")).toBeTruthy();
  });
});
