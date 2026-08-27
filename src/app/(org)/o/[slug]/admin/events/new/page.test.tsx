// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const cachedAuth = vi.fn();
vi.mock("@/lib/auth/cached-auth", () => ({
  cachedAuth: () => cachedAuth(),
}));

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
    resolveOrgContext: (...args: unknown[]) => resolveOrgContext(...args),
    assertOrgAccess: (...args: unknown[]) => assertOrgAccess(...args),
  };
});

const isFlagEnabled = vi.fn();
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: (...args: unknown[]) => isFlagEnabled(...args),
}));

const listEvents = vi.fn();
vi.mock("@/lib/events", () => ({
  listEvents: (...args: unknown[]) => listEvents(...args),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
  notFound: () => notFoundMock(),
}));

vi.mock("../new-event-form", () => ({
  NewEventForm: ({ slug }: { slug: string }) => <div>NewEventForm for {slug}</div>,
}));

import NewEventPage from "./page";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listEvents.mockReset();
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

const OK_RESOLVED = {
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

function makeParams(slug = "alder-creek") {
  return Promise.resolve({ slug });
}

describe("NewEventPage", () => {
  it("renders flag-off without calling listEvents()", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(false);

    const el = await NewEventPage({ params: makeParams() });
    render(el);

    expect(listEvents).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("renders EventsForbidden when listEvents() returns forbidden", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockResolvedValue({ kind: "forbidden" });

    const el = await NewEventPage({ params: makeParams() });
    render(el);

    expect(screen.getByText(/don.t have permission to manage events/i)).toBeTruthy();
  });

  it("renders NewEventForm when listEvents() resolves ok, discarding its data", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue(OK_RESOLVED);
    isFlagEnabled.mockResolvedValue(true);
    listEvents.mockResolvedValue({ kind: "ok", data: [{ eventId: "irrelevant" }] });

    const el = await NewEventPage({ params: makeParams() });
    render(el);

    expect(screen.getByRole("heading", { name: /new event/i })).toBeTruthy();
    expect(screen.getByText("NewEventForm for alder-creek")).toBeTruthy();
  });

  it("redirects to /signin when unauthenticated", async () => {
    cachedAuth.mockResolvedValue(null);

    await expect(NewEventPage({ params: makeParams() })).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fevents%2Fnew",
    );
  });
});
