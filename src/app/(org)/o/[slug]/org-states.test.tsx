// @vitest-environment jsdom
/**
 * Tests for <OrgPortalStub>'s P1 discoverability link (commit 3/3).
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
      />,
    );
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/the roll, the directory, and the officer register/i);
    expect(body).toMatch(/the roll and the officer register/i);
  });
});
