// @vitest-environment jsdom
/**
 * Orchestration tests for `/o/<slug>/admin/events/types`'s page.tsx: the flag
 * check before any read, `event_types.manage` as the only gate, and the
 * list / empty / error states.
 */
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

const listEventTypes = vi.fn();
vi.mock("@/lib/event-types", () => ({
  listEventTypes: (...args: unknown[]) => listEventTypes(...args),
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

vi.mock("./event-type-list", () => ({
  EventTypeList: ({ types }: { types: unknown[] }) => <div>EventTypeList {types.length}</div>,
}));
vi.mock("./event-type-form", () => ({
  EventTypeForm: ({ mode }: { mode: string }) => <div>EventTypeForm {mode}</div>,
}));
vi.mock("./seed-standard-types-button", () => ({
  SeedStandardTypesButton: () => <button type="button">Add the standard event types</button>,
}));

import EventTypesPage from "./page";
import { OrgAccessError } from "@/lib/authz";

afterEach(() => {
  cleanup();
  cachedAuth.mockReset();
  resolveOrgContext.mockReset();
  assertOrgAccess.mockReset().mockResolvedValue(undefined);
  isFlagEnabled.mockReset();
  listEventTypes.mockReset();
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

function signedIn() {
  cachedAuth.mockResolvedValue({ user: { id: "u1" } });
  resolveOrgContext.mockResolvedValue(OK_RESOLVED);
}

async function renderPage() {
  return render(await EventTypesPage({ params: Promise.resolve({ slug: "alder-creek" }) }));
}

describe("EventTypesPage — gates", () => {
  it("redirects a signed-out visitor to /signin with a callback to this page", async () => {
    cachedAuth.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(
      "REDIRECT:/signin?callbackUrl=%2Fo%2Falder-creek%2Fadmin%2Fevents%2Ftypes",
    );
  });

  it("calls notFound() for an unknown slug", async () => {
    cachedAuth.mockResolvedValue({ user: { id: "u1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    await expect(renderPage()).rejects.toThrow("NOT_FOUND");
  });

  it("checks org_portal.events and renders flag-off WITHOUT ever calling listEventTypes()", async () => {
    signedIn();
    isFlagEnabled.mockResolvedValue(false);
    await renderPage();
    expect(isFlagEnabled).toHaveBeenCalledWith("org_portal.events");
    expect(listEventTypes).not.toHaveBeenCalled();
    expect(screen.getByText(/isn.t turned on for Alder Creek/i)).toBeTruthy();
  });

  it("calls assertOrgAccess before the flag", async () => {
    signedIn();
    isFlagEnabled.mockResolvedValue(false);
    await renderPage();
    expect(assertOrgAccess).toHaveBeenCalledWith("person-1", "org-1");
  });

  it("renders EventTypesForbidden when the viewer lacks event_types.manage", async () => {
    signedIn();
    isFlagEnabled.mockResolvedValue(true);
    listEventTypes.mockResolvedValue({ kind: "forbidden" });
    await renderPage();
    expect(screen.getByText(/don.t have permission to manage event types at Alder Creek/i)).toBeTruthy();
    expect(screen.queryByText(/EventTypeList/)).toBeNull();
  });

  it("re-throws OrgAccessError and renders the load error for anything else", async () => {
    signedIn();
    isFlagEnabled.mockResolvedValue(true);
    listEventTypes.mockRejectedValue(new OrgAccessError("person-1", "org-1"));
    await expect(renderPage()).rejects.toThrow("mock: no active membership");

    listEventTypes.mockRejectedValue(new Error("connection reset"));
    await renderPage();
    expect(screen.getByText(/couldn.t load event types right now/i)).toBeTruthy();
  });
});

describe("EventTypesPage — content", () => {
  it("renders the header, the retired-types hint, the list and the add form", async () => {
    signedIn();
    isFlagEnabled.mockResolvedValue(true);
    listEventTypes.mockResolvedValue({ kind: "ok", data: [{ id: "a" }, { id: "b" }] });
    await renderPage();

    expect(listEventTypes).toHaveBeenCalledWith("person-1", "org-1");
    expect(screen.getByRole("heading", { level: 1, name: "Event types" })).toBeTruthy();
    expect(
      screen.getByText("Colors and icons used on the calendar for Alder Creek Presbyterian Church."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Retired types stay on the events that already use them\. They won.t be offered for new events or shown as a filter\./),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to events/i }).getAttribute("href")).toBe(
      "/o/alder-creek/admin/events",
    );
    expect(screen.getByText("EventTypeList 2")).toBeTruthy();
    expect(screen.getByText("EventTypeForm create")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Add an event type" })).toBeTruthy();
  });

  it("with zero types shows the empty state with the seed button and still the add form", async () => {
    signedIn();
    isFlagEnabled.mockResolvedValue(true);
    listEventTypes.mockResolvedValue({ kind: "ok", data: [] });
    await renderPage();
    expect(screen.getByText("No event types yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add the standard event types" })).toBeTruthy();
    expect(screen.queryByText(/EventTypeList/)).toBeNull();
    expect(screen.getByText("EventTypeForm create")).toBeTruthy();
  });
});
