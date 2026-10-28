// @vitest-environment jsdom
/**
 * `/no-organization` (Community Increment 2b, Copy groups A to C, E-21). Mocked at
 * the page's boundaries: the session, the organizations list, the invitation
 * listing, the enrolment read and the actions. The pure composition is
 * `view.test.ts`'s; this pins what the page renders for each view, byte for byte
 * from the copy modules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mockAuth }));

const mockOrgs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  isEnterableOrganization: (o: { platformStatus: string; endedOn: string | null }) =>
    o.platformStatus === "managed" && o.endedOn === null,
  userOrganizations: (...a: unknown[]) => mockOrgs(...a),
}));

const mockList = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/in-place", () => ({ listInvitationsForAccount: (...a: unknown[]) => mockList(...a) }));

const mockTotp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { query: { userTotp: { findFirst: (...a: unknown[]) => mockTotp(...a) } } } }));

vi.mock("./actions", () => ({
  checkAgainAction: vi.fn(),
  acceptInPlaceAction: vi.fn(),
  switchAccountAction: vi.fn(),
}));

import NoOrganizationPage from "./page";
import { NO_ORG_COPY } from "@/lib/onboarding/no-organization-copy";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  mockOrgs.mockReset();
  mockList.mockReset();
  mockTotp.mockReset();
});

const EMAIL = "someone@example.invalid";

function signedIn(over: Record<string, unknown> = {}) {
  mockAuth.mockResolvedValue({ user: { id: "u1", email: EMAIL, twoFactorRequired: false, twoFactorVerified: false, ...over } });
}

function org(over: Record<string, unknown> = {}) {
  return { organizationId: "o1", name: "Alder Creek Presbyterian Church", platformStatus: "managed", endedOn: null, ...over };
}

function invitation(over: Record<string, unknown> = {}) {
  return {
    invitationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Alder Creek Presbyterian Church",
    purpose: "sign_in",
    expiresAt: new Date("2026-11-01T12:00:00Z"),
    personDisplayName: "Nora Ashgrove",
    ...over,
  };
}

function arrange({ orgs = [], invitations = [], enrolled = false }: { orgs?: unknown[]; invitations?: unknown[]; enrolled?: boolean } = {}) {
  signedIn();
  mockOrgs.mockResolvedValue(orgs);
  mockList.mockResolvedValue(invitations);
  mockTotp.mockResolvedValue(enrolled ? { userId: "u1" } : undefined);
}

async function renderPage() {
  return render(await NoOrganizationPage());
}

describe("/no-organization - N0, nothing connected and nothing waiting", () => {
  it("reads the Copy: heading, address, second line, the office, the invitation line and both buttons", async () => {
    arrange();
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "You're not connected to a congregation yet" })).toBeTruthy();
    expect(screen.getByText(NO_ORG_COPY.body(EMAIL))).toBeTruthy();
    expect(screen.getByText(NO_ORG_COPY.secondLine)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Ask the office that keeps your records" })).toBeTruthy();
    expect(screen.getByText(NO_ORG_COPY.officeBody(EMAIL))).toBeTruthy();
    expect(screen.getByText(NO_ORG_COPY.invitationLine)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with a different account" })).toBeTruthy();
  });

  it("the old copy is gone - regression for misleading no-organization copy", async () => {
    arrange();
    const { container } = await renderPage();
    expect(container.textContent).not.toMatch(/signing in doesn.t connect you to a congregation by itself/i);
    expect(container.textContent).not.toMatch(/only an invitation link does/i);
    expect(container.textContent).not.toMatch(/ask your church administrator/i);
    expect(container.textContent).not.toMatch(/arrange|can add you/i);
  });

  it("ends cleanly when the session has no address (no 'null', no empty 'Ask them to check that  is')", async () => {
    signedIn({ email: null });
    mockOrgs.mockResolvedValue([]);
    mockList.mockResolvedValue([]);
    mockTotp.mockResolvedValue(undefined);
    const { container } = await renderPage();
    expect(screen.getByText(NO_ORG_COPY.bodyNoAddress)).toBeTruthy();
    expect(container.textContent).not.toMatch(/null|undefined/);
    expect(screen.queryByText(/Ask them to check that/)).toBeNull();
  });

  it("names the product PresbyPortal, not presby", async () => {
    arrange();
    const { container } = await renderPage();
    expect(container.textContent).not.toMatch(/\bpresby\b/);
    expect(screen.getByRole("link", { name: /read about presbyportal/i })).toBeTruthy();
  });

  it("keeps 'Is your church not on PresbyPortal?' and 'Back to home'", async () => {
    arrange();
    await renderPage();
    expect(screen.getByRole("heading", { name: "Is your church not on PresbyPortal?" })).toBeTruthy();
    const back = screen.getByRole("link", { name: /back to home/i });
    expect(back.getAttribute("href")).toBe("/home");
    expect(back.className).toContain("min-h-11");
  });
});

describe("/no-organization - N1, open invitations", () => {
  it("one invitation: its heading and card stand in for the default heading, 'Ask the office' and Check again", async () => {
    arrange({ invitations: [invitation()] });
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "You're invited to Alder Creek Presbyterian Church" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept the invitation" })).toBeTruthy();
    expect(screen.queryByText("You're not connected to a congregation yet")).toBeNull();
    expect(screen.queryByText("Ask the office that keeps your records")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    // A different account is still a way out of a wrong-account situation.
    expect(screen.getByRole("button", { name: "Sign in with a different account" })).toBeTruthy();
  });

  it("several invitations: counted, one card each", async () => {
    arrange({ invitations: [invitation({ invitationId: "a" }), invitation({ invitationId: "b", organizationName: "Second" })] });
    await renderPage();
    expect(screen.getByRole("heading", { name: "You have 2 invitations" })).toBeTruthy();
    expect(screen.getAllByTestId("invitation-card")).toHaveLength(2);
  });

  it("a designation invitation shows the two-factor notice in place of Accept (enrolled)", async () => {
    arrange({ invitations: [invitation({ purpose: "treasurer", personDisplayName: null })], enrolled: true });
    await renderPage();
    expect(screen.getByRole("link", { name: "Continue to verification" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept the invitation" })).toBeNull();
  });

  it("not enrolled: 'Set up two-factor sign-in'", async () => {
    arrange({ invitations: [invitation({ purpose: "founding_administrator", personDisplayName: null })] });
    await renderPage();
    expect(screen.getByRole("link", { name: "Set up two-factor sign-in" })).toBeTruthy();
  });

  it("a sign_in invitation needs no second factor unless the account must use it", async () => {
    arrange({ invitations: [invitation()] });
    await renderPage();
    expect(screen.getByRole("button", { name: "Accept the invitation" })).toBeTruthy();
    cleanup();
    signedIn({ twoFactorRequired: true });
    await renderPage();
    expect(screen.queryByRole("button", { name: "Accept the invitation" })).toBeNull();
    expect(screen.getByRole("link", { name: "Set up two-factor sign-in" })).toBeTruthy();
  });

  it("a verified session lets a designation be accepted", async () => {
    arrange({ invitations: [invitation({ purpose: "treasurer", personDisplayName: null })] });
    signedIn({ twoFactorRequired: true, twoFactorVerified: true });
    await renderPage();
    expect(screen.getByRole("button", { name: "Accept the invitation" })).toBeTruthy();
  });
});

describe("/no-organization - the standing blocks keep their precedence, invitations below them", () => {
  it("pending", async () => {
    arrange({ orgs: [org({ platformStatus: "invited" })], invitations: [invitation()] });
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Your organization is being set up" })).toBeTruthy();
    expect(screen.getByText(/is being set up\. We.ll email you when it.s ready/)).toBeTruthy();
    expect(screen.getByTestId("invitation-card")).toBeTruthy();
    // The default view's pieces belong to N0 alone.
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    expect(screen.queryByText("Ask the office that keeps your records")).toBeNull();
  });

  it("not a tenant", async () => {
    arrange({ orgs: [org({ platformStatus: "unmanaged" })] });
    await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Your congregation isn't on PresbyPortal yet" })).toBeTruthy();
    expect(screen.queryByTestId("invitation-card")).toBeNull();
  });

  it("ended, with the date as a calendar date", async () => {
    arrange({ orgs: [org({ endedOn: "2026-03-31" })] });
    const { container } = await renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Your access has ended" })).toBeTruthy();
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-03-31");
  });

  it("a long congregation name wraps", async () => {
    arrange({ orgs: [org({ platformStatus: "invited", name: "A".repeat(80) })] });
    await renderPage();
    expect(screen.getByText(/A{80} is being set up/).className).toContain("break-words");
  });
});

describe("/no-organization - N5, the listing failed", () => {
  it("a line above the default view, which still renders with Check again (never 'nothing is waiting')", async () => {
    arrange();
    mockList.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(screen.getByRole("alert").textContent).toBe("We couldn't check for invitations just now. Reload the page.");
    expect(screen.getByRole("heading", { level: 1, name: "You're not connected to a congregation yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("and above a standing block", async () => {
    arrange({ orgs: [org({ endedOn: "2026-03-31" })] });
    mockList.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(screen.getByTestId("listing-failed")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Your access has ended" })).toBeTruthy();
  });
});

describe("/no-organization - the unchanged branches", () => {
  it("signed out redirects to sign-in", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(NoOrganizationPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("already have access: the sentence and the chooser link, and the listing is never read", async () => {
    arrange({ orgs: [org(), org({ organizationId: "o2" })] });
    await renderPage();
    expect(screen.getByRole("heading", { name: "You already have access" })).toBeTruthy();
    expect(screen.getByText("You have access to 2 organizations.")).toBeTruthy();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockTotp).not.toHaveBeenCalled();
  });

  it("a failed organizations read is the unavailable state, not a fall-through", async () => {
    signedIn();
    mockOrgs.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(screen.queryByText("You're not connected to a congregation yet")).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("a failed enrolment read falls back to 'not enrolled' and the page still renders", async () => {
    arrange({ invitations: [invitation({ purpose: "treasurer", personDisplayName: null })] });
    mockTotp.mockRejectedValue(new Error("db down"));
    await renderPage();
    expect(screen.getByRole("link", { name: "Set up two-factor sign-in" })).toBeTruthy();
  });

  it("reads the listing for the session's own user id and nothing else", async () => {
    arrange();
    await renderPage();
    expect(mockList).toHaveBeenCalledWith("u1");
  });
});

describe("/no-organization - the help link (user-help integration, P3-9)", () => {
  it.each([
    ["N0, nothing connected", () => arrange()],
    ["N1, an open invitation", () => arrange({ invitations: [invitation()] })],
    ["a standing block (being set up)", () => arrange({ orgs: [org({ platformStatus: "invited" })] })],
  ])("%s: 'Why can't I see this?' opens the not-connected section of why-cant-i-see-this, same tab", async (_label, setup) => {
    setup();
    await renderPage();
    const help = screen.getByRole("link", { name: "Why can't I see this?" });
    expect(help.getAttribute("href")).toBe("/help/why-cant-i-see-this#not-connected-to-a-congregation");
    expect(help.getAttribute("target")).toBeNull();
    expect(help.className).toContain("min-h-11");
  });
});
