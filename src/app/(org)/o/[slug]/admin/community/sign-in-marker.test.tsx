// @vitest-environment jsdom
/**
 * The sign-in marker (Community Increment 2b, Copy group E as amended by
 * amendment 3): icon AND word, never colour alone, the person's name in the
 * accessible name, a link to the card, a 44px target, and every word from the
 * copy module.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SignInMarker } from "./sign-in-marker";
import { SIGN_IN_MARKER_NO_EMAIL, signInMarkerLabel } from "@/lib/onboarding/sign-in-copy";
import type { SignInMarker as Marker } from "@/lib/onboarding/sign-in-types";

afterEach(cleanup);

const SENT = new Date("2026-10-20T12:00:00Z");

function renderMarker(marker: Marker | undefined) {
  return render(<SignInMarker marker={marker} slug="alder-creek" personId="p-1" personName="Nora Ashgrove" />);
}

describe("SignInMarker", () => {
  it("renders nothing without a marker", () => {
    const { container } = renderMarker(undefined);
    expect(container.firstChild).toBeNull();
  });

  it.each([
    [{ kind: "expired" } as Marker, "Invitation expired. Send again"],
    [{ kind: "bounced" } as Marker, "Email bounced. Check the address"],
    [{ kind: "blocked" } as Marker, "Invitation couldn't be completed"],
    [{ kind: "not_connected", noEmail: false } as Marker, "Not connected yet"],
  ])("%j reads %s", (marker, words) => {
    renderMarker(marker);
    const link = screen.getByTestId("sign-in-marker");
    expect(link.textContent).toContain(words);
    // The label is the copy module's, not retyped here.
    expect(link.textContent).toContain(signInMarkerLabel(marker, () => ""));
  });

  it("pending reads 'Invitation sent {date}' with the date in a timezone-safe <time>", () => {
    renderMarker({ kind: "pending", sentAt: SENT });
    const link = screen.getByTestId("sign-in-marker");
    expect(link.textContent).toMatch(/^Invitation sent .+ Nora Ashgrove$/);
    expect(link.querySelector("time")?.getAttribute("datetime")).toBe(SENT.toISOString());
  });

  it("'Not connected yet' appends 'No email on file' only when true", () => {
    const { unmount } = renderMarker({ kind: "not_connected", noEmail: true });
    expect(screen.getByTestId("sign-in-marker").textContent).toContain(`Not connected yet. ${SIGN_IN_MARKER_NO_EMAIL}`);
    unmount();
    renderMarker({ kind: "not_connected", noEmail: false });
    expect(screen.getByTestId("sign-in-marker").textContent).not.toContain(SIGN_IN_MARKER_NO_EMAIL);
  });

  it("links to the person's card and names whose marker it is", () => {
    renderMarker({ kind: "expired" });
    const link = screen.getByRole("link", { name: /invitation expired\. send again\s*nora ashgrove/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/community/p-1/edit#sign-in");
  });

  it("has an icon beside the word (never colour alone), hidden from assistive tech", () => {
    renderMarker({ kind: "bounced" });
    const svg = screen.getByTestId("sign-in-marker").querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is a 44px target and its pill wraps (a long label never runs off a 360px screen)", () => {
    renderMarker({ kind: "bounced" });
    expect(screen.getByTestId("sign-in-marker").className).toContain("min-h-11");
    expect(screen.getByTestId("sign-in-marker").querySelector(".break-words")).not.toBeNull();
  });

  it("amber for an invitation in motion, neutral for 'not connected'", () => {
    const { unmount } = renderMarker({ kind: "expired" });
    expect(screen.getByTestId("sign-in-marker").innerHTML).toContain("border-amber-300");
    unmount();
    renderMarker({ kind: "not_connected", noEmail: false });
    expect(screen.getByTestId("sign-in-marker").innerHTML).not.toContain("amber");
  });
});
