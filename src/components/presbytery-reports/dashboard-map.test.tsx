// @vitest-environment jsdom
/**
 * The congregation map's server section (DECISION-343): every state, the links that
 * follow the oversight flag, and the honesty rules (a failure never reads as "no
 * location"; the list failing hides the section).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { MapResult } from "@/lib/presbytery-reports/dashboard";
import { DashboardMap } from "./dashboard-map";

afterEach(cleanup);

const ORG = "Northern Reach";
const SLUG = "northern";
const RETRY = "/o/northern/admin/insights";
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const pin = (n: number, name: string) => ({ id: id(n), name, lat: 40, lng: -83, score: 2 as const, label: "Fair" });

const mapOk = (pins: ReturnType<typeof pin>[], unplaced: { id: string; name: string }[], total: number): MapResult => ({
  kind: "ok",
  data: { total, pins, unplaced },
});

function view(map: MapResult, over: { viabilityOk?: boolean; oversightOn?: boolean; slot?: React.ReactNode } = {}) {
  return render(
    <DashboardMap
      map={map}
      viabilityOk={over.viabilityOk ?? true}
      org={ORG}
      slug={SLUG}
      oversightOn={over.oversightOn ?? true}
      retryHref={RETRY}
      slot={"slot" in over ? over.slot : <div data-testid="the-slot" />}
    />,
  );
}

describe("DashboardMap", () => {
  it.each([{ kind: "off" }, { kind: "locked" }] as MapResult[])("renders nothing for %j", (map) => {
    const { container } = view(map);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the viability list is not ok, whatever the map says", () => {
    for (const map of [mapOk([pin(1, "A")], [], 1), { kind: "error" } as MapResult]) {
      const { container } = view(map, { viabilityOk: false });
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("an error is the read-error line and a retry link, never the empty prompt", () => {
    view({ kind: "error" });
    expect(screen.getByRole("heading", { level: 2, name: "Congregation map" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("We couldn't load the map. The list below has every congregation.");
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(RETRY);
    expect(document.body.textContent).not.toMatch(/usable location/);
    expect(screen.queryByTestId("the-slot")).toBeNull();
  });

  it("zero pins is the prompt: latitude first, a link to Congregation Oversight, and no map slot", () => {
    view(mapOk([], [{ id: id(1), name: "A" }], 1));
    const empty = within(screen.getByTestId("dashboard-map-empty"));
    expect(empty.getByText("No congregation has a usable location yet.")).toBeTruthy();
    expect(empty.getByText(/Latitude comes first\./)).toBeTruthy();
    expect(empty.getByRole("link", { name: "Open Congregation Oversight" }).getAttribute("href")).toBe("/o/northern/admin/oversight");
    expect(screen.queryByTestId("the-slot")).toBeNull();
  });

  it("zero pins with oversight off states the fact and has no link or instruction", () => {
    view(mapOk([], [], 3), { oversightOn: false });
    expect(screen.getByText("Locations are entered on Congregation Oversight, which isn't turned on for Northern Reach yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Add a latitude/);
  });

  it("with pins: the heading, the intro, the slot, the caption and the unplaced list in that order", () => {
    view(mapOk([pin(1, "Alder Creek")], [{ id: id(2), name: "Birch Hollow" }, { id: id(3), name: "Cedar Ford" }], 3));
    const section = screen.getByTestId("dashboard-map");
    const text = section.textContent ?? "";
    expect(text.indexOf("Congregation map")).toBeLessThan(text.indexOf("Each pin is a member congregation of Northern Reach"));
    expect(screen.getByTestId("the-slot")).toBeTruthy();
    expect(screen.getByTestId("dashboard-map-caption").textContent).toBe("1 of 3 congregations has a location.");
    const unplaced = within(screen.getByTestId("dashboard-map-unplaced"));
    expect(unplaced.getByRole("heading", { level: 3, name: "Not on the map" })).toBeTruthy();
    expect(unplaced.getByRole("link", { name: "Birch Hollow" }).getAttribute("href")).toBe(`/o/northern/admin/oversight/${id(2)}`);
    expect(unplaced.getByText(/Latitude comes first\./)).toBeTruthy();
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Congregation map", "Not on the map"]);
  });

  it("pluralises the caption for several pins and a one-congregation presbytery", () => {
    view(mapOk([pin(1, "A"), pin(2, "B")], [], 12));
    expect(screen.getByTestId("dashboard-map-caption").textContent).toBe("2 of 12 congregations have a location.");
    cleanup();
    view(mapOk([pin(1, "A")], [], 1));
    expect(screen.getByTestId("dashboard-map-caption").textContent).toBe("1 of 1 congregation has a location.");
  });

  it("every congregation placed: no 'Not on the map' list", () => {
    view(mapOk([pin(1, "A")], [], 1));
    expect(screen.queryByTestId("dashboard-map-unplaced")).toBeNull();
    expect(screen.queryByText("Not on the map")).toBeNull();
  });

  it("with oversight off the unplaced names are plain text and the entry sentence is the fact, not an instruction", () => {
    view(mapOk([pin(1, "A")], [{ id: id(2), name: "Birch Hollow" }], 2), { oversightOn: false });
    const unplaced = within(screen.getByTestId("dashboard-map-unplaced"));
    expect(unplaced.queryByRole("link")).toBeNull();
    expect(unplaced.getByText("Birch Hollow")).toBeTruthy();
    expect(unplaced.getByText(/isn't turned on for Northern Reach yet/)).toBeTruthy();
    expect(unplaced.queryByText(/Open a congregation/)).toBeNull();
  });

  it("renders a tenant-entered name as text, never as HTML", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    view(mapOk([pin(1, "A")], [{ id: id(2), name: hostile }], 2));
    expect(screen.getByTestId("dashboard-map-unplaced").querySelector("img")).toBeNull();
    expect(screen.getByText(hostile)).toBeTruthy();
  });

  it("pins with no client map (no tile key) show nothing rather than a caption for a map that is not there", () => {
    const { container } = view(mapOk([pin(1, "A")], [], 1), { slot: null });
    expect(container.innerHTML).toBe("");
  });

  it("no heading contains a phrase the dashboard's other headings are matched by", () => {
    view(mapOk([pin(1, "A")], [{ id: id(2), name: "B" }], 2));
    for (const h of screen.getAllByRole("heading")) {
      expect(h.textContent).not.toMatch(/member congregations|viability|vacant pulpits|ending active members|per capita|insights & analytics/i);
    }
  });
});
