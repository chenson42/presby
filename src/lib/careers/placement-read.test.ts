import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockResolveSite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({ resolveSite: mockResolveSite }));

import { readPlacement } from "./placement-read";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readPlacement", () => {
  it("returns the published bundle's pages, path and mdxAst only", async () => {
    mockResolveSite.mockResolvedValue({
      kind: "ok",
      mode: "slug",
      slug: "fernwood",
      urls: {},
      redirectHost: null,
      site: {
        organizationId: "secret-org-id",
        pages: [
          { path: "/", frontMatter: { title: "Home" }, mdxAst: { blocks: [] } },
          { path: "/employment", frontMatter: { title: "E" }, mdxAst: { blocks: [{ type: "liveSlot", props: { slot: "careers" } }] } },
        ],
      },
    });
    const result = await readPlacement("fernwood");
    expect(result).toEqual({
      kind: "known",
      pages: [
        { path: "/", mdxAst: { blocks: [] } },
        { path: "/employment", mdxAst: { blocks: [{ type: "liveSlot", props: { slot: "careers" } }] } },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret-org-id");
    expect(mockResolveSite).toHaveBeenCalledWith("fernwood");
  });

  it("every way the bundle cannot be read is unknown: not found, not live", async () => {
    mockResolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "fernwood", reason: "absent" });
    expect(await readPlacement("fernwood")).toEqual({ kind: "unknown" });
    mockResolveSite.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "fernwood", reason: "read_failed" });
    expect(await readPlacement("fernwood")).toEqual({ kind: "unknown" });
  });

  it("a thrown error is unknown, and the log carries the slug only", async () => {
    mockResolveSite.mockRejectedValue(new Error("select * from organization_sites SECRET password=hunter2"));
    expect(await readPlacement("fernwood")).toEqual({ kind: "unknown" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
    expect(logged).toContain("fernwood");
    expect(logged).not.toContain("SECRET");
    expect(logged).not.toContain("hunter2");
  });

  it("a string that is not a slug never reaches the resolver", async () => {
    for (const bad of ["", "church.example.invalid", "../x", "Not A Slug"]) {
      expect(await readPlacement(bad), bad).toEqual({ kind: "unknown" });
    }
    expect(mockResolveSite).not.toHaveBeenCalled();
  });
});
