// @vitest-environment jsdom
/**
 * Tests for the avatar menu.
 *
 * THE ENTITLEMENT MATRIX IS THE POINT. `canAccessAdmin` and `isPlatformAdmin`
 * are two different predicates over two different sources — a session claim the
 * Edge enforces on /admin, and a live-read column that gates /developer
 * (DECISION-044). They are held by the same people today BY ACCIDENT, so all
 * four combinations have to be pinned or the day they diverge is the day a user
 * is shown a link the Edge bounces to /access-pending, which reads as a broken
 * login rather than as a permissions boundary.
 *
 * `signOutAction` is mocked to a no-op: importing the real module pulls
 * `@/auth` and the whole NextAuth configuration into a unit test. What matters
 * here is the SHAPE — a real <form> with a real submit button — because that is
 * what has to keep working, not what the action does.
 */

import { describe, expect, it, afterEach, beforeAll, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const signOutAction = vi.fn(async (_redirectTo?: string) => {});
vi.mock("@/lib/auth/sign-out-action", () => ({
  signOutAction: (redirectTo?: string) => signOutAction(redirectTo),
}));

import { AvatarMenu } from "./avatar-menu";

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

afterEach(() => {
  cleanup();
  signOutAction.mockClear();
});

const ADA = { name: "Ada Lovelace", email: "ada@presby.invalid" };

function renderMenu({
  name = ADA.name as string | null,
  email = ADA.email as string | null,
  canAccessAdmin = false,
  isPlatformAdmin = false,
  signOutRedirectTo,
}: {
  name?: string | null;
  email?: string | null;
  canAccessAdmin?: boolean;
  isPlatformAdmin?: boolean;
  signOutRedirectTo?: string;
} = {}) {
  return render(
    <AvatarMenu
      name={name}
      email={email}
      canAccessAdmin={canAccessAdmin}
      isPlatformAdmin={isPlatformAdmin}
      signOutRedirectTo={signOutRedirectTo}
    />,
  );
}

async function open() {
  const trigger = screen.getByTestId("avatar-menu-trigger");
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  return trigger;
}

describe("AvatarMenu — the avatar itself", () => {
  it("shows initials derived from the name", () => {
    renderMenu();

    expect(screen.getByTestId("avatar-menu-trigger").textContent).toBe("AL");
  });

  it("falls back to the email when there is no name", () => {
    renderMenu({ name: null });

    expect(screen.getByTestId("avatar-menu-trigger").textContent).toBe("A");
  });

  it("names the account for a screen reader rather than reading the initials aloud", () => {
    renderMenu();

    expect(
      screen.getByTestId("avatar-menu-trigger").getAttribute("aria-label"),
    ).toBe("Account menu for Ada Lovelace");
  });

  it("uses the email in the accessible name when there is no display name", () => {
    renderMenu({ name: null });

    expect(
      screen.getByTestId("avatar-menu-trigger").getAttribute("aria-label"),
    ).toBe(`Account menu for ${ADA.email}`);
  });
});

describe("AvatarMenu — identity block", () => {
  it("shows the name and the email", async () => {
    renderMenu();

    await open();

    expect(screen.getByText(ADA.name)).toBeTruthy();
    expect(screen.getByText(ADA.email)).toBeTruthy();
  });

  it("omits the name line entirely rather than rendering a blank row", async () => {
    renderMenu({ name: "   " });

    await open();

    expect(screen.getByText(ADA.email)).toBeTruthy();
    expect(screen.getByRole("menu").textContent).not.toContain("  ");
  });
});

describe("AvatarMenu — the entitlement matrix (DECISION-044)", () => {
  it("neither entitlement: Account and Sign out, and nothing platform", async () => {
    renderMenu();

    await open();

    expect(screen.getByRole("menuitem", { name: "Account" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Platform admin" }),
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Developer" })).toBeNull();
  });

  it("canAccessAdmin only: Platform admin, but NOT Developer", async () => {
    // The common case a collapsed single predicate would get wrong in one
    // direction — /developer is gated on the column, not on the claim.
    renderMenu({ canAccessAdmin: true });

    await open();

    expect(
      screen.getByRole("menuitem", { name: "Platform admin" }).getAttribute("href"),
    ).toBe("/admin");
    expect(screen.queryByRole("menuitem", { name: "Developer" })).toBeNull();
  });

  it("isPlatformAdmin only: Developer, but NOT Platform admin", async () => {
    // And the other direction. Holding users.is_platform_admin grants nothing
    // at /admin, which the Edge enforces on session claims.
    renderMenu({ isPlatformAdmin: true });

    await open();

    expect(
      screen.getByRole("menuitem", { name: "Developer" }).getAttribute("href"),
    ).toBe("/developer");
    expect(
      screen.queryByRole("menuitem", { name: "Platform admin" }),
    ).toBeNull();
  });

  it("both: both items, in that order", async () => {
    renderMenu({ canAccessAdmin: true, isPlatformAdmin: true });

    await open();

    const labels = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(labels).toEqual([
      "Account",
      "Platform admin",
      "Developer",
      "Sign out",
    ]);
  });
});

describe("AvatarMenu — what is deliberately absent", () => {
  it("has no Organization admin item", async () => {
    // It has no destination until P9. An item that goes nowhere is worse than
    // an absent one, and it is also CONTEXT rather than identity — it would
    // move when you switched organizations, so it does not belong here even
    // once it exists.
    renderMenu({ canAccessAdmin: true, isPlatformAdmin: true });

    await open();

    expect(screen.getByRole("menu").textContent).not.toMatch(
      /organization admin/i,
    );
  });

  it("says nothing about which organization is on screen", async () => {
    renderMenu({ canAccessAdmin: true, isPlatformAdmin: true });

    await open();

    expect(screen.getByRole("menu").textContent).not.toMatch(
      /switch organization|all organizations/i,
    );
  });
});

describe("AvatarMenu — sign out", () => {
  it("is a submit button inside a real form, exactly as it was before", async () => {
    renderMenu();

    await open();

    const button = screen.getByRole("menuitem", { name: "Sign out" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.closest("form")).not.toBeNull();
  });

  it("does not let Radix close the menu out from under the form", async () => {
    // THE REGRESSION THIS GUARDS. Radix closes the menu from inside the item's
    // click handler and React flushes that update synchronously, so without
    // preventDefault on select the <form> can be detached from the document
    // BEFORE the browser dispatches submit — and a submit event is never fired
    // for a detached form. Sign-out would silently do nothing.
    renderMenu();

    await open();

    const button = screen.getByRole("menuitem", { name: "Sign out" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.queryByRole("menu")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeTruthy();
  });

  it("defaults to redirecting to \"/\" when no signOutRedirectTo is given", async () => {
    renderMenu();

    await open();
    const button = screen.getByRole("menuitem", { name: "Sign out" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(signOutAction).toHaveBeenCalledTimes(1);
    expect(signOutAction.mock.calls[0]?.[0]).toBe("/");
  });

  it("redirects to the given signOutRedirectTo — the (org) shell's own public site", async () => {
    renderMenu({ signOutRedirectTo: "/site/fpcw" });

    await open();
    const button = screen.getByRole("menuitem", { name: "Sign out" });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(signOutAction).toHaveBeenCalledTimes(1);
    expect(signOutAction.mock.calls[0]?.[0]).toBe("/site/fpcw");
  });
});
