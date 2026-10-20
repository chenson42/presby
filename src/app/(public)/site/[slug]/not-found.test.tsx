// @vitest-environment jsdom
/**
 * The neutral 404 of the public site tree (Phase 3 section 4, suggestion 3). It
 * must say nothing that distinguishes one non-serving state from another, and
 * nothing that names the product.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PublicSiteNotFound, { metadata } from "./not-found";

afterEach(cleanup);

describe("PublicSiteNotFound", () => {
  it("names no product, organization, state or link", () => {
    const { container } = render(<PublicSiteNotFound />);
    const text = container.textContent ?? "";
    expect(text).toBe("Page not foundThe page you were looking for does not exist.");
    expect(text).not.toMatch(/presby|portal|sign in|church|domain|suspend|publish/i);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders identically every time (nothing varies with the request)", () => {
    const a = render(<PublicSiteNotFound />).container.innerHTML;
    cleanup();
    const b = render(<PublicSiteNotFound />).container.innerHTML;
    expect(a).toBe(b);
  });

  it("titles the page neutrally, overriding the root layout's product title, and keeps it out of search", () => {
    expect(metadata.title).toEqual({ absolute: "Page not found" });
    expect(JSON.stringify(metadata)).not.toMatch(/presby/i);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    // The root layout's openGraph / twitter are replaced wholesale, so no social tag names the product.
    expect(JSON.stringify([metadata.openGraph, metadata.twitter])).not.toMatch(/presby|portal/i);
  });
});
