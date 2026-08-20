// @vitest-environment jsdom
/**
 * Tests for <OrgPortalStub>'s P1 directory link and P9 administration link.
 *
 * `<OrgAccessDenied>` / `<OrgAccessEnded>` are UNCHANGED by this commit and
 * are covered by e2e/post-login-routing.spec.ts test 9 (the DECISION-040
 * byte-identical-copy regression) — not duplicated here.
 *
 * No jest-dom matchers — see directory-states.test.tsx's header.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrgPortalStub } from "./org-states";

afterEach(cleanup);

describe("OrgPortalStub — directory discoverability link", () => {
  it("shows a Directory link to /o/<slug>/directory when the flag is on", () => {
    render(
      <OrgPortalStub
        name="Alder Creek Presbyterian Church"
        organizationType="congregation"
        slug="alder-creek"
        directoryEnabled={true}
        rolesEnabled={false}
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
      />,
    );
    expect(screen.getByRole("link", { name: /directory/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /administration/i })).toBeTruthy();
  });
});
