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
});
