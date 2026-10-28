// @vitest-environment jsdom
/**
 * /access-pending: the help link (user-help Inc 1, Copy C3). The page already wrote an audit
 * row and said who to ask; this pins the one added link and that the existing "Back to home"
 * is still there.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/audit", () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: { ACCESS_DENIED: "access.denied" },
}));

import AccessPending from "./page";

afterEach(cleanup);

describe("/access-pending", () => {
  it("links to the access-pending section of why-cant-i-see-this, above Back to home", async () => {
    render(await AccessPending({ searchParams: Promise.resolve({ from: "/admin" }) }));

    const help = screen.getByRole("link", { name: "Why can't I see this?" });
    expect(help.getAttribute("href")).toBe("/help/why-cant-i-see-this#access-pending");
    expect(help.getAttribute("target")).toBeNull();

    const links = screen.getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Why can't I see this?", "← Back to home"]);
  });
});
