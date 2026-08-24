// @vitest-environment jsdom
/**
 * Tests for <OrgPortalStub>'s P1 directory link, P9 administration link, the
 * support-tickets pipeline's Tickets / Give feedback links, and
 * <OrgAccessDenied> / <OrgAccessEnded>'s "Visit the public site" link.
 *
 * The DECISION-040 byte-identical-copy property (managed/invited/unmanaged
 * render the same string) is covered by e2e/post-login-routing.spec.ts test
 * 9, unaffected by the new link since it's identical for every status — not
 * duplicated here.
 *
 * No jest-dom matchers — see directory-states.test.tsx's header.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrgAccessDenied, OrgAccessEnded, OrgPortalStub } from "./org-states";

afterEach(cleanup);

describe("OrgAccessDenied — a way back to the public site", () => {
  it("links to /site/<slug> alongside the existing 'back to your organizations' link", () => {
    render(
      <OrgAccessDenied
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Back to your organizations" }).getAttribute("href"),
    ).toBe("/orgs");
    expect(
      screen.getByRole("link", { name: "Visit the public site" }).getAttribute("href"),
    ).toBe("/site/alder-creek");
  });
});

describe("OrgAccessEnded — a way back to the public site", () => {
  it("links to /site/<slug> alongside the existing 'back to your organizations' link", () => {
    render(
      <OrgAccessEnded
        name="Alder Creek Presbyterian Church"
        endedOn="2026-06-30"
        slug="alder-creek"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Back to your organizations" }).getAttribute("href"),
    ).toBe("/orgs");
    expect(
      screen.getByRole("link", { name: "Visit the public site" }).getAttribute("href"),
    ).toBe("/site/alder-creek");
  });
});

describe("OrgPortalStub — directory discoverability link", () => {
  it("shows a Directory link to /o/<slug>/directory when the flag is on", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={true}
        rolesEnabled={false}
        ticketsEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /directory/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/directory");
  });

  it("shows no Directory link when the flag is off — gated unconditionally on nothing but the flag", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={false}
        rolesEnabled={false}
        ticketsEnabled={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("no longer promises 'the directory' in the stub copy — it is real now", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={false}
        rolesEnabled={false}
        ticketsEnabled={false}
      />,
    );
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/the roll, the directory, and the officer register/i);
    expect(body).toMatch(/the roll and the officer register/i);
  });
});

describe("OrgPortalStub — P9 administration discoverability link", () => {
  it("shows an Administration link to /o/<slug>/admin/roles when the flag is on", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={false}
        rolesEnabled={true}
        ticketsEnabled={false}
      />,
    );
    const link = screen.getByRole("link", { name: /administration/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/roles");
  });

  it("shows no Administration link when the flag is off — gated unconditionally on nothing but the flag", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={false}
        rolesEnabled={false}
        ticketsEnabled={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows both links independently when both flags are on", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={true}
        rolesEnabled={true}
        ticketsEnabled={false}
      />,
    );
    expect(screen.getByRole("link", { name: /directory/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /administration/i })).toBeTruthy();
  });
});

describe("OrgPortalStub — support-tickets Tickets / Give feedback links", () => {
  it("shows Tickets and Give feedback links to /o/<slug>/tickets and /o/<slug>/feedback when the flag is on", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={false}
        rolesEnabled={false}
        ticketsEnabled={true}
      />,
    );
    const ticketsLink = screen.getByRole("link", { name: /^tickets/i });
    expect(ticketsLink.getAttribute("href")).toBe("/o/alder-creek/tickets");
    const feedbackLink = screen.getByRole("link", { name: /give feedback/i });
    expect(feedbackLink.getAttribute("href")).toBe("/o/alder-creek/feedback");
  });

  it("shows no Tickets/Give feedback links when the flag is off — gated unconditionally on nothing but the flag", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={false}
        rolesEnabled={false}
        ticketsEnabled={false}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows all four links independently when every flag is on", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={true}
        rolesEnabled={true}
        ticketsEnabled={true}
      />,
    );
    expect(screen.getByRole("link", { name: /directory/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /administration/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^tickets/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /give feedback/i })).toBeTruthy();
  });
});
