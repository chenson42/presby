import { describe, expect, it } from "vitest";
import { pageMetadata, plannedMetadata } from "./metadata";

describe("help page metadata", () => {
  it("a published page sets its own title, description and openGraph", () => {
    const m = pageMetadata({ title: "Signing in", summary: "How to sign in." });
    expect(m.title).toBe("Signing in");
    expect(m.description).toBe("How to sign in.");
    expect(m.openGraph).toMatchObject({ title: "Signing in", description: "How to sign in." });
    expect(m.robots).toBeUndefined();
  });
  it("a planned page is titled as planned and carries its own permanent noindex", () => {
    const m = plannedMetadata({ title: "Example plan", summary: "s" });
    expect(m.title).toBe("Example plan (planned, not available yet)");
    expect(m.openGraph).toMatchObject({ title: "Example plan (planned, not available yet)" });
    expect(m.robots).toEqual({ index: false, follow: false });
  });
});
