// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildActivity } from "@/lib/domains/activity";
import { ActivityList } from "./activity-list";

afterEach(cleanup);

describe("ActivityList", () => {
  it("renders nothing when there is nothing to show", () => {
    const { container } = render(<ActivityList items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a plain line, who did it and when; an automatic promotion reads 'Primary address set automatically'", () => {
    const items = buildActivity([
      { id: "1", action: "domain.canonical_changed", createdAt: new Date("2030-01-02T00:00:00Z"), metadata: { reason: "no_canonical", toHostname: "www.church-one.invalid", actorKind: "machine" } },
      { id: "2", action: "domain.claimed", createdAt: new Date("2030-01-01T00:00:00Z"), metadata: { hostname: "church-one.invalid", actorKind: "tenant" } },
    ]);
    render(<ActivityList items={items} />);
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeTruthy();
    expect(screen.getByText("Primary address set automatically: www.church-one.invalid.")).toBeTruthy();
    expect(screen.getByText(/Automatic check/)).toBeTruthy();
    expect(screen.getByText(/Your team/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
