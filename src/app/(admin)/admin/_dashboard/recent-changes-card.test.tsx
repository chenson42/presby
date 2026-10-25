// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-portal/dashboard/recent-changes", () => ({ readRecentChangesCard: read }));

import { RecentChangesCard } from "./recent-changes-card";

afterEach(() => {
  cleanup();
  read.mockReset();
});

describe("RecentChangesCard", () => {
  it("labels each row, shows subject, actor (or System) and time, with no nested link", async () => {
    read.mockResolvedValue({
      kind: "ok",
      rows: [
        { action: "org.founding_administrator.revoked", subject: "Example Church", actorEmail: "ops@example.invalid", at: "2026-10-24T12:00:00.000Z" },
        { action: "feature_flag.toggled", subject: "ui.branded_signin", actorEmail: null, at: "2026-10-23T12:00:00.000Z" },
        { action: "user.deactivated", subject: null, actorEmail: "ops@example.invalid", at: "2026-10-22T12:00:00.000Z" },
      ],
    });
    render(await RecentChangesCard());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Founding administrator removed · Example Church")).toBeTruthy();
    expect(within(items[0]).getByText("ops@example.invalid")).toBeTruthy();
    expect(within(items[1]).getByText("Feature flag changed · ui.branded_signin")).toBeTruthy();
    expect(within(items[1]).getByText("System")).toBeTruthy();
    expect(within(items[2]).getByText("Account deactivated")).toBeTruthy();
    expect(within(items[0]).queryAllByRole("link")).toHaveLength(0);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/admin/audit");
    expect(links[0].textContent).toBe("View the audit log");
    expect(screen.getByText("Access, flag and account changes worth a second look.")).toBeTruthy();
  });

  it("says 'of this kind' when empty, and still offers the audit log", async () => {
    read.mockResolvedValue({ kind: "ok", rows: [] });
    render(await RecentChangesCard());
    expect(screen.getByText("No recent changes of this kind.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View the audit log" })).toBeTruthy();
  });

  it("a failed read is the error state, not the empty line (U2)", async () => {
    read.mockResolvedValue({ kind: "error" });
    render(await RecentChangesCard());
    expect(screen.getByText("We can't load this right now.")).toBeTruthy();
    expect(screen.queryByText("No recent changes of this kind.")).toBeNull();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/admin");
  });
});
