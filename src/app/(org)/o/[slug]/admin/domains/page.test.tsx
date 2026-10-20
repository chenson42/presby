// @vitest-environment jsdom
/**
 * Orchestration test for `/o/<slug>/admin/domains`'s page.tsx: the (org) auth
 * pattern, the four-way miss, each honest non-data state, and every data state
 * the page renders (empty, a claim in progress, live, the exit, the
 * primary-address advisory, recent activity).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { buildActivity } from "@/lib/domains/activity";
import { FIXTURE_CTX, FIXTURE_TARGETS, fixtureGroups, fixturePair, fixtureRow, observation } from "@/lib/domains/checklist-fixtures";

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

const readDomainsView = vi.fn();
vi.mock("@/lib/domains/service", () => ({ readDomainsView: (...a: unknown[]) => readDomainsView(...a) }));
vi.mock("./actions", () => ({
  claimDomainAction: vi.fn(),
  checkDomainAction: vi.fn(),
  changeCanonicalAction: vi.fn(),
  removeClaimAction: vi.fn(),
  reconnectClaimAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { OrgAccessError } from "@/lib/authz";
import DomainsPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  readDomainsView.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

const OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};
const params = (slug = "alder-creek") => Promise.resolve({ slug });
const signedIn = () => cachedAuth.mockResolvedValue({ user: { id: "u1" } });
const view = (groups = fixtureGroups([]), extra: Record<string, unknown> = {}) =>
  readDomainsView.mockResolvedValue({ kind: "ok", groups, siteStatus: "live", activity: [], ...extra });
const renderPage = async () => render(await DomainsPage({ params: params() }));

describe("DomainsPage - the (org) pattern and the four-way miss", () => {
  it("an unauthenticated visitor is redirected to sign in with the deep link kept", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(DomainsPage({ params: params() })).rejects.toThrow("REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fdomains");
    expect(readDomainsView).not.toHaveBeenCalled();
  });

  it("an unknown slug is a 404 and nothing is read", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(DomainsPage({ params: params() })).rejects.toThrow("NOT_FOUND");
    expect(readDomainsView).not.toHaveBeenCalled();
  });

  it("no relationship: access denied naming the organization; an ended one is dated", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue({ kind: "forbidden", name: "Alder Creek Presbyterian Church", organizationType: "congregation" });
    await renderPage();
    expect(document.body.textContent).toMatch(/Alder Creek Presbyterian Church/);
    expect(readDomainsView).not.toHaveBeenCalled();
    cleanup();
    resolveOrgContext.mockResolvedValue({ kind: "ended", name: "Alder Creek Presbyterian Church", organizationType: "congregation", endedOn: "2029-12-31" });
    await renderPage();
    expect(document.body.textContent).toMatch(/Alder Creek Presbyterian Church/);
    expect(readDomainsView).not.toHaveBeenCalled();
  });

  it("runs assertOrgAccess before it reads, and reads with the org's own person and id", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view();
    await renderPage();
    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
    expect(readDomainsView).toHaveBeenCalledWith("person-1", "org-1", { platformSiteUrl: expect.stringContaining("/site/alder-creek") });
  });
});

describe("DomainsPage - the honest non-data states", () => {
  it("feature off", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    readDomainsView.mockResolvedValue({ kind: "feature_off" });
    await renderPage();
    expect(screen.getByTestId("domains-feature-off").textContent).toMatch(/isn.t turned on for Alder Creek/);
  });

  it("forbidden (no domains.manage)", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    readDomainsView.mockResolvedValue({ kind: "forbidden" });
    await renderPage();
    expect(screen.getByTestId("domains-forbidden")).toBeTruthy();
  });

  it("a database blip is 'unavailable' - never the empty Start screen", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    readDomainsView.mockRejectedValue(new Error("connection terminated"));
    await renderPage();
    expect(screen.getByTestId("domains-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("domains-empty")).toBeNull();
    expect(document.body.textContent).not.toMatch(/connection terminated/);
  });

  it("an OrgAccessError is re-thrown for [slug]/error.tsx", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    readDomainsView.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(DomainsPage({ params: params() })).rejects.toThrow("no active membership");
  });
});

describe("DomainsPage - the data states", () => {
  it("empty: the explanation and Start, with the platform site address; no cards, no activity", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    process.env.NEXT_PUBLIC_APP_URL = "https://presbyportal.invalid";
    view();
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Website domain" })).toBeTruthy();
    expect(screen.getByTestId("domains-empty").textContent).toMatch(/presbyportal\.invalid\/site\/alder-creek/);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByTestId("claim-card")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Recent activity" })).toBeNull();
  });

  it("a claim in progress: its card with Check now and Remove, the add-another form, no primary advisory", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(fixtureGroups(fixturePair("pending")));
    await renderPage();
    const card = screen.getByTestId("claim-card");
    expect(card.getAttribute("data-phase")).toBe("proving");
    expect(within(card).getByRole("button", { name: "Check now" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /^Remove/ })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Add another domain" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add domain" })).toBeTruthy();
    expect(screen.queryByTestId("primary-advisory")).toBeNull();
    expect(screen.getByRole("button", { name: /Why isn.t it working/ })).toBeTruthy();
    // the troubleshooting panel's support link goes to the tenant's own ticket form
    expect(screen.getByRole("link", { name: "Contact support", hidden: true }).getAttribute("href")).toBe("/o/alder-creek/tickets/new");
  });

  it("live: 'Make primary' appears on the live alias only", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(fixtureGroups(fixturePair("live", { observation: observation({ targets: FIXTURE_TARGETS }) })));
    await renderPage();
    const makes = screen.getAllByRole("button", { name: /^Make .* primary$/ });
    expect(makes).toHaveLength(1);
    expect(makes[0]!.getAttribute("aria-label")).toBe("Make church-one.invalid primary");
    expect(screen.getByRole("link", { name: /View your site/ })).toBeTruthy();
  });

  it("parked: Reconnect (not Remove or Check), and the exit checklist", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(fixtureGroups(fixturePair("parked", { graceEndsAt: new Date("2030-02-01T00:00:00Z") })));
    await renderPage();
    const card = screen.getByTestId("claim-card");
    expect(within(card).getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Check now" })).toBeNull();
    expect(within(card).getByTestId("offboarding-card")).toBeTruthy();
  });

  it("the primary address is not serving while a different domain is live: the advisory is shown with the remedy", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(
      fixtureGroups([
        fixtureRow({ hostname: "www.church-one.invalid", state: "lapsed", webRole: "canonical" }),
        fixtureRow({ hostname: "www.other.invalid", claimName: "other.invalid", state: "live", webRole: "alias" }),
      ]),
    );
    await renderPage();
    const banner = screen.getByTestId("primary-advisory");
    expect(banner.textContent).toMatch(/www\.church-one\.invalid, isn.t serving/);
    expect(within(banner).getByRole("button", { name: "Make www.other.invalid primary" })).toBeTruthy();
  });

  it("removing the primary domain asks for a replacement drawn from the OTHER domain's live hosts", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(
      fixtureGroups([
        ...fixturePair("live"),
        fixtureRow({ hostname: "www.other.invalid", claimName: "other.invalid", state: "live", webRole: "alias" }),
      ]),
    );
    await renderPage();
    const cards = screen.getAllByTestId("claim-card");
    const primaryCard = cards.find((c) => c.getAttribute("data-claim") === "church-one.invalid")!;
    const otherCard = cards.find((c) => c.getAttribute("data-claim") === "other.invalid")!;
    // the primary's dialog offers only the OTHER domain's live host
    fireEvent.click(within(primaryCard).getByRole("button", { name: /^Remove/ }));
    let dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Which address becomes your primary address?")).toBeTruthy();
    expect(within(dialog).getAllByRole("radio").map((r) => r.closest("label")!.textContent)).toEqual(["www.other.invalid"]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    // the other domain does not hold the primary, so removing it asks nothing
    fireEvent.click(within(otherCard).getByRole("button", { name: /^Remove/ }));
    dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByRole("radio")).toBeNull();
  });

  it("recent activity is shown when there is some", async () => {
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(fixtureGroups(fixturePair("pending")), {
      activity: buildActivity([{ id: "a", action: "domain.claimed", createdAt: new Date("2030-01-01T00:00:00Z"), metadata: { hostname: "church-one.invalid", actorKind: "tenant" } }]),
    });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeTruthy();
    expect(screen.getByText("church-one.invalid was added.")).toBeTruthy();
  });

  it("the pre-flight warning (site not published yet) reaches the card", async () => {
    // the banner text comes from the view-model; the page only passes the address in
    signedIn();
    resolveOrgContext.mockResolvedValue(OK);
    view(fixtureGroups(fixturePair("pending"), { ...FIXTURE_CTX, siteStatus: "provisioning" }));
    await renderPage();
    expect(screen.getByText("Your site isn't published yet. Point your domain here after it is.")).toBeTruthy();
  });
});
