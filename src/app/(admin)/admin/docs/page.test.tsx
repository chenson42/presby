// @vitest-environment jsdom
/**
 * `/admin/docs` page-level gate (F281). The proxy already requires
 * `admin.release_notes` for this path (src/proxy.ts), but every other console
 * page also checks its own key, and a page that trusts the proxy alone is one
 * proxy edit away from being open. A viewer who holds the door key but not
 * `ADMIN_RELEASE_NOTES` gets `AdminForbidden` and the release files are never
 * read; a holder sees the notes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FEATURES } from "@/lib/permissions";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

const readdir = vi.fn(async () => ["v0.1.md"]);
const readFile = vi.fn(async () => "# Notes body");
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const promises = { readdir: () => readdir(), readFile: () => readFile() };
  return { ...actual, promises, default: { ...actual, promises } };
});
// react-markdown is ESM-only and not what is under test.
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-raw", () => ({ default: () => {} }));

import DocsPage from "./page";

afterEach(() => {
  cleanup();
  mockAuth.mockReset();
  readdir.mockClear();
  readFile.mockClear();
});

const props = { searchParams: Promise.resolve({}) };

describe("DocsPage gate", () => {
  it("renders AdminForbidden and reads no release file without ADMIN_RELEASE_NOTES — regression for /admin/docs relying on the proxy alone", async () => {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS] },
    });

    render(await DocsPage(props));

    expect(screen.getByRole("heading", { name: "Release notes" })).toBeTruthy();
    expect(screen.getByText(/doesn.t include release notes/i)).toBeTruthy();
    expect(readdir).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("renders the notes for a holder of ADMIN_RELEASE_NOTES", async () => {
    mockAuth.mockResolvedValue({
      user: { features: [FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_RELEASE_NOTES] },
    });

    render(await DocsPage(props));

    expect(screen.getByText("# Notes body")).toBeTruthy();
    expect(screen.queryByText(/doesn.t include release notes/i)).toBeNull();
  });
});
