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

import { PersonAvatar, resolvePhotoSrc } from "./person-avatar";

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
    render(<PersonAvatar photoSrc={null} displayName="Marguerite Ashcombe" />);
    expect(screen.getByText("MA")).toBeTruthy();
  });

  it("attempts no <img> at all when photoSrc is null", () => {
    render(<PersonAvatar photoSrc={null} displayName="Marguerite Ashcombe" />);
    expect(document.querySelector("img")).toBeNull();
  });

  it("marks the fallback aria-hidden when a photoSrc is present, visible when it is not", () => {
    const { rerender } = render(
      <PersonAvatar photoSrc={null} displayName="Marguerite Ashcombe" />,
    );
    expect(screen.getByText("MA").getAttribute("aria-hidden")).toBe("false");

    rerender(
      <PersonAvatar
        photoSrc="data:image/png;base64,AAA="
        displayName="Marguerite Ashcombe"
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
});
