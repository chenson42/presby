// @vitest-environment jsdom
/**
 * Tests for the organization switcher.
 *
 * THE FOUR RENDERINGS ARE THE FEATURE, and three of them are about restraint:
 * a user with no organizations gets no control, a user with one gets a name and
 * not a menu, and a failed read gets a name or nothing but NEVER an empty
 * dropdown. The last one is the important one — a picker that opens onto
 * nothing reads to a user as "my access was revoked", which is a worse lie than
 * an outage and generates a support ticket from someone who did nothing wrong.
 *
 * The menu is opened with a keydown rather than a click: Radix's trigger opens
 * on Enter/Space/ArrowDown, and going through the keyboard path also asserts
 * that the keyboard path works at all.
 */

import { describe, expect, it, afterEach, beforeAll } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { OrganizationType } from "@/lib/authz";
import { OrgSwitcher, type SwitchableOrganization } from "./org-switcher";

// jsdom implements none of these, and Radix's popper needs all of them. They
// are stubs, not shims: nothing in this file asserts on position.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

// Explicit, because this project does not enable Vitest's `globals`, and
// @testing-library/react only registers its automatic cleanup when it can see
// a global `afterEach`. Without this every render accumulates in the same
// document and the second test in a file fails on "found multiple elements".
afterEach(cleanup);

function org(
  slug: string,
  name: string,
  organizationType: OrganizationType = "congregation",
): SwitchableOrganization {
  return { slug, name, organizationType };
}

const WRENFIELD = org("e2e-alpha", "Wrenfield Presbyterian Church");
const FELLS = org(
  "e2e-presbytery",
  "Presbytery of the Eastern Fells",
  "presbytery",
);

async function open() {
  const trigger = screen.getByTestId("org-switcher-trigger");
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  return trigger;
}

describe("OrgSwitcher — how many organizations", () => {
  it("renders nothing at all for a user with no organizations", () => {
    // Nothing to name. A control naming nothing is an invitation to click on
    // an outage.
    const { container } = render(<OrgSwitcher organizations={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("renders the one congregation as plain text, with no menu, inside it", () => {
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[WRENFIELD]}
      />,
    );

    expect(screen.getByTestId("org-switcher-static").textContent).toContain(
      WRENFIELD.name,
    );
    // It is the ambient "where am I" indicator; it has nowhere to switch to.
    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("truncates the current organization name rather than wrapping the header", () => {
    // 360px is the width this is about: "Presbytery of the Eastern Fells" would
    // otherwise push the header onto two lines and shove the avatar off the row.
    render(
      <OrgSwitcher
        currentName={FELLS.name}
        currentSlug={FELLS.slug}
        organizations={[FELLS]}
      />,
    );

    const label = screen.getByTestId("org-switcher-static");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
  });

  it("offers a menu when the user has somewhere else to go", async () => {
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[WRENFIELD, FELLS]}
      />,
    );

    const trigger = await open();

    expect(trigger.textContent).toContain(WRENFIELD.name);
    expect(
      screen.getByRole("menuitem", { name: new RegExp(FELLS.name) }),
    ).toBeTruthy();
    // The organization you are already in is not somewhere to switch to.
    expect(
      screen.queryByRole("menuitem", { name: new RegExp(WRENFIELD.name) }),
    ).toBeNull();
  });

  it("names the type under each organization, and no membership language", async () => {
    // DECISION-039: a relationship is not a roll status. The elder on a
    // presbytery committee and the secretary who worships elsewhere both appear
    // here, and "member of" is wrong for both.
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[WRENFIELD, FELLS]}
      />,
    );

    await open();

    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("Presbytery");
    expect(menu.textContent).not.toMatch(/\bmember\b/i);
    expect(menu.textContent).not.toMatch(/\broll\b/i);
  });

  it("always offers the full chooser as the last item", async () => {
    // The picker is a shortcut to /orgs, not a replacement for it: /orgs is the
    // only surface that names the organizations still being set up.
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[WRENFIELD, FELLS]}
      />,
    );

    await open();

    const all = screen.getByRole("menuitem", { name: "All organizations" });
    expect(all.getAttribute("href")).toBe("/orgs");
  });

  it("links each organization at its own portal", async () => {
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[WRENFIELD, FELLS]}
      />,
    );

    await open();

    expect(
      screen
        .getByRole("menuitem", { name: new RegExp(FELLS.name) })
        .getAttribute("href"),
    ).toBe(`/o/${FELLS.slug}`);
  });
});

describe("OrgSwitcher — no organization context", () => {
  it("labels itself 'Organizations' and lists everything on a page with no org", async () => {
    // /home, /orgs, /whats-new: the user is inside no congregation, so naming
    // one as current would be a lie.
    render(<OrgSwitcher organizations={[WRENFIELD, FELLS]} />);

    const trigger = await open();

    expect(trigger.textContent).toContain("Organizations");
    expect(
      screen.getByRole("menuitem", { name: new RegExp(WRENFIELD.name) }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: new RegExp(FELLS.name) }),
    ).toBeTruthy();
  });

  it("still offers a menu to a single-organization user outside their organization", async () => {
    // Rendering 2 is about being INSIDE your only congregation. On /home there
    // is somewhere to go — into it — so plain text would be a dead control.
    render(<OrgSwitcher organizations={[WRENFIELD]} />);

    await open();

    expect(
      screen.getByRole("menuitem", { name: new RegExp(WRENFIELD.name) }),
    ).toBeTruthy();
  });

  it("does not claim a slug the user has no relationship with is current", async () => {
    // The access-denied page renders inside the org shell. The slug is in the
    // URL but not in the user's list, so the switcher must fall back rather
    // than label an organization they were just denied as "current".
    render(
      <OrgSwitcher
        currentName={null}
        currentSlug="e2e-gamma"
        organizations={[WRENFIELD, FELLS]}
      />,
    );

    const trigger = await open();

    expect(trigger.textContent).toContain("Organizations");
    expect(screen.getByRole("menu").textContent).not.toContain("gamma");
  });
});

describe("OrgSwitcher — the list could not be read", () => {
  it("renders the current organization name as plain text, never an empty dropdown", () => {
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[]}
        unavailable
      />,
    );

    expect(screen.getByTestId("org-switcher-static").textContent).toContain(
      WRENFIELD.name,
    );
    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
  });

  it("renders nothing when it does not even know where the user is", () => {
    const { container } = render(
      <OrgSwitcher organizations={[]} unavailable />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("does not silently show an empty menu when a list arrives with the failure flag", () => {
    // Belt and braces: `unavailable` wins over whatever is in `organizations`,
    // so a caller that forgets to clear the array cannot produce a menu built
    // from a partial read.
    render(
      <OrgSwitcher
        currentName={WRENFIELD.name}
        currentSlug={WRENFIELD.slug}
        organizations={[WRENFIELD, FELLS]}
        unavailable
      />,
    );

    expect(screen.queryByTestId("org-switcher-trigger")).toBeNull();
    expect(screen.getByTestId("org-switcher-static")).toBeTruthy();
  });
});
