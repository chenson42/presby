// @vitest-environment jsdom
/**
 * Component tests for `<DeaconCard>` — the two states Increment 4's design
 * calls for: a populated deacon (name + initials-fallback avatar) and the
 * SAME neutral "no deacon assigned" copy for both causes `deaconName ===
 * null` covers (no district assigned, and a vacant district) — see the
 * component's own header for why those two causes are deliberately
 * indistinguishable here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// `DeaconCard` imports `<PersonAvatar>` from the directory subtree, which
// imports `resolvePhotoSrc()` from the SAME file — that file imports
// `@/lib/storage/blob-store`, which opens a real `@/lib/db` pool at
// module-import time (the same reason `directory-grid.test.tsx` mocks this
// one hop before `@/lib/db`). `DeaconCard` never calls `resolve()` itself
// (it always passes `photoSrc={null}`), so an unconfigured mock is enough.
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({
    resolve: vi.fn(),
    resolveMeta: vi.fn(),
    store: vi.fn(),
  }),
}));

import { DeaconCard } from "./deacon-card";

afterEach(cleanup);

describe("DeaconCard — a populated deacon", () => {
  it("renders the deacon's name under a 'Deacon' label", () => {
    render(<DeaconCard deaconName="Priya Balakrishnan" />);
    expect(screen.getByText("Deacon")).toBeTruthy();
    expect(screen.getByText("Priya Balakrishnan")).toBeTruthy();
  });

  it("renders an initials-fallback avatar for the deacon's name", () => {
    render(<DeaconCard deaconName="Priya Balakrishnan" />);
    // AvatarFallback renders the initials text node when no photoSrc is
    // given — DeaconCard never has a photo to resolve (see its own header).
    expect(screen.getByText("PB")).toBeTruthy();
  });

  it("does not render the neutral vacant/no-district copy", () => {
    render(<DeaconCard deaconName="Priya Balakrishnan" />);
    expect(screen.queryByText(/no deacon is currently assigned/i)).toBeNull();
  });
});

describe("DeaconCard — deaconName === null (vacant OR no district — indistinguishable)", () => {
  it("renders the neutral 'no deacon is currently assigned' copy", () => {
    render(<DeaconCard deaconName={null} />);
    expect(
      screen.getByText(/no deacon is currently assigned/i),
    ).toBeTruthy();
    expect(screen.getByText("Deacon")).toBeTruthy();
  });

  it("never renders a broken/empty card — the label and a placeholder icon are always present", () => {
    const { container } = render(<DeaconCard deaconName={null} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("DeaconCard — hover treatment is cosmetic only (Phase 3 Edge Cases)", () => {
  it("applies the shadow-lift class but introduces no tabindex or interactive role", () => {
    const { container } = render(<DeaconCard deaconName="Priya Balakrishnan" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("hover:shadow-md");
    expect(card.className).toContain("transition-shadow");
    expect(card.getAttribute("tabindex")).toBeNull();
    expect(card.getAttribute("role")).not.toBe("button");
    expect(container.querySelector("a")).toBeNull();
  });
});
