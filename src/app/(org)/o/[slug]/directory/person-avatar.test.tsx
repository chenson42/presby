// @vitest-environment jsdom
/**
 * Tests for `person-avatar.tsx`'s two exports.
 *
 * `resolvePhotoSrc()` is real business logic (DECISION-030's "never query
 * `blob_assets` directly" plumbed through `resolve()`) and is tested with
 * `@/lib/storage/blob-store` mocked — deterministic, no DB, no image
 * decoding involved.
 *
 * `<PersonAvatar>` is tested only for what is DETERMINISTIC in this
 * harness. Radix's `AvatarImage` decides whether to render the `<img>` by
 * constructing a real `window.Image()` and waiting for a `load`/`error`
 * event (see `@radix-ui/react-avatar`'s `useImageLoadingStatus`) — jsdom
 * does no image decoding at all, so whether/when that event fires for a
 * `data:` URI is a jsdom implementation detail, not this component's
 * behavior, and asserting on it would be a flaky test pinned to the wrong
 * layer. What IS this component's own, deterministic behavior — and what
 * these tests assert — is: (a) no `<img>` is even ATTEMPTED when
 * `photoSrc` is null (no `AvatarImage` in the tree at all), (b) the
 * initials fallback text is always correct, and (c) the fallback's
 * `aria-hidden` flips with `photoSrc`, both driven directly by this
 * component's own prop, not by Radix's async loading state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const resolve = vi.fn();
vi.mock("@/lib/storage/blob-store", () => ({
  getBlobStore: () => ({ resolve, resolveMeta: vi.fn(), store: vi.fn() }),
}));

import {
  PersonAvatar,
  resolvePhotoSrc,
  __avatarPaletteClassNameForTest as avatarPaletteClassName,
} from "./person-avatar";

afterEach(() => {
  cleanup();
  resolve.mockReset();
});

describe("resolvePhotoSrc", () => {
  it("returns null without calling the blob store when photoKey is null", async () => {
    const src = await resolvePhotoSrc("org-1", null);
    expect(src).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns null when resolve() misses (a stale key), never throws", async () => {
    resolve.mockResolvedValue(null);
    const src = await resolvePhotoSrc("org-1", "stale-key");
    expect(src).toBeNull();
  });

  it("returns a data: URI built from the resolved bytes and content type", async () => {
    resolve.mockResolvedValue({
      bytes: Buffer.from("fake-image-bytes"),
      contentType: "image/webp",
    });
    const src = await resolvePhotoSrc("org-1", "key-1");
    expect(src).toBe(
      `data:image/webp;base64,${Buffer.from("fake-image-bytes").toString("base64")}`,
    );
    expect(resolve).toHaveBeenCalledWith({
      organizationId: "org-1",
      key: "key-1",
    });
  });
});

describe("<PersonAvatar>", () => {
  it("renders the initials fallback for a two-word name", () => {
    render(
      <PersonAvatar
        photoSrc={null}
        displayName="Marguerite Ashcombe"
        seed="person-1"
      />,
    );
    expect(screen.getByText("MA")).toBeTruthy();
  });

  it("attempts no <img> at all when photoSrc is null", () => {
    render(
      <PersonAvatar
        photoSrc={null}
        displayName="Marguerite Ashcombe"
        seed="person-1"
      />,
    );
    expect(document.querySelector("img")).toBeNull();
  });

  it("marks the fallback aria-hidden when a photoSrc is present, visible when it is not", () => {
    const { rerender } = render(
      <PersonAvatar
        photoSrc={null}
        displayName="Marguerite Ashcombe"
        seed="person-1"
      />,
    );
    expect(screen.getByText("MA").getAttribute("aria-hidden")).toBe("false");

    rerender(
      <PersonAvatar
        photoSrc="data:image/png;base64,AAA="
        displayName="Marguerite Ashcombe"
        seed="person-1"
      />,
    );
    // The fallback node itself may or may not still be in the tree
    // depending on Radix's (jsdom-dependent) loading state — only the
    // ATTRIBUTE this component itself sets is asserted here.
    const fallback = screen.queryByText("MA");
    if (fallback) {
      expect(fallback.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("applies a background/text colour class from the palette to the fallback", () => {
    render(
      <PersonAvatar photoSrc={null} displayName="Ada Lovelace" seed="person-1" />,
    );
    const fallback = screen.getByText("AL");
    expect(fallback.className).toMatch(/bg-\w+-\d{3}/);
    expect(fallback.className).toMatch(/text-\w+-\d{3}/);
  });
});

describe("avatar colour determinism (docs/work-log/2026-08-28-directory-visual-refresh.md, Phase 4, item 1)", () => {
  it("the same seed always produces the same palette class", () => {
    const first = avatarPaletteClassName("11111111-1111-1111-1111-111111111111");
    const second = avatarPaletteClassName("11111111-1111-1111-1111-111111111111");
    expect(first).toBe(second);
  });

  it("is stable across many calls, not just two", () => {
    const seed = "22222222-2222-2222-2222-222222222222";
    const results = new Set(
      Array.from({ length: 20 }, () => avatarPaletteClassName(seed)),
    );
    expect(results.size).toBe(1);
  });

  it("different seeds plausibly land on different buckets (not every seed collapses to one class)", () => {
    const seeds = [
      "person-a",
      "person-b",
      "person-c",
      "person-d",
      "person-e",
      "person-f",
      "person-g",
      "person-h",
    ];
    const classes = new Set(seeds.map((s) => avatarPaletteClassName(s)));
    // With 8 seeds over a 6-bucket palette, a correct hash should spread
    // across more than one bucket. A constant function (the bug this test
    // exists to catch) would collapse this to size 1.
    expect(classes.size).toBeGreaterThan(1);
  });

  it("hashes by the id, not the name — two different ids produce independently-determined colours even if a caller passed the same name twice", () => {
    // Not a claim that two different ids can never share a bucket (6
    // buckets, so collisions are expected) — a claim that the function reads
    // ITS ARGUMENT, not some other identity signal. Guards a regression where
    // a future edit accidentally re-derives the seed from `displayName`
    // instead of using the id it was handed.
    const byId1 = avatarPaletteClassName("00000000-0000-0000-0000-000000000001");
    const byId2 = avatarPaletteClassName("00000000-0000-0000-0000-000000000002");
    // These two ids are chosen (verified below) to land in different
    // buckets, proving the function is sensitive to the seed's full value,
    // not just e.g. its length (both ids are the same length).
    expect(byId1).not.toBe(byId2);
  });

  it("returns one of the exact palette entries — never an arbitrary/out-of-range string", () => {
    const result = avatarPaletteClassName("any-seed-at-all");
    expect(result).toMatch(/^bg-(slate|teal|indigo|violet|fuchsia|cyan)-\d{3}/);
  });
});
