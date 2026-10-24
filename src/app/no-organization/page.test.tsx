// @vitest-environment jsdom
/**
 * `/no-organization` copy for an invited person (account-invitations S7): a
 * signed-in user with no congregation is told to open the link in their
 * invitation email. Mocked at the page's two boundaries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mockAuth }));
vi.mock("@/lib/authz", () => ({
  isEnterableOrganization: () => false,
  userOrganizations: async () => [],
}));

import NoOrganizationPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
});

describe("/no-organization", () => {
  it("tells an invited person to open the link in their invitation email", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "someone@example.invalid" } });
    render(await NoOrganizationPage());
    expect(screen.getByText(/if you were invited, open the link in your invitation email/i)).toBeTruthy();
  });

  it("says signing in alone does not connect you, and never promises an administrator can add you by email — regression for misleading no-organization copy", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "someone@example.invalid" } });
    render(await NoOrganizationPage());
    expect(screen.getByText(/signing in doesn.t connect you to a congregation by itself/i)).toBeTruthy();
    expect(screen.queryByText(/arrange|can add you/i)).toBeNull();
    expect(screen.queryByText(/someone there with administrator access can add you/i)).toBeNull();
    expect(screen.getByText("someone@example.invalid")).toBeTruthy();
  });

  it("names the product PresbyPortal, not presby", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "someone@example.invalid" } });
    const { container } = render(await NoOrganizationPage());
    expect(container.textContent).not.toMatch(/\bpresby\b/);
    expect(screen.getByRole("link", { name: /read about presbyportal/i })).toBeTruthy();
  });

  it("ends the sentence cleanly when the session has no email", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", email: null } });
    const { container } = render(await NoOrganizationPage());
    expect(container.textContent).toMatch(/address it was sent to\./);
  });
});
