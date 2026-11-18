// @vitest-environment jsdom
/**
 * The oversight edit form's "Map location" group (DECISION-343): the copy, the
 * paste-split, the inline pair rules, the conversion to numbers and the save
 * toast's description. The schema's own messages are pinned in
 * `oversight-schema.golden.test.ts`; the server's in `presbytery.coordinates.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const setAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setCongregationOversightAction: (...args: unknown[]) => setAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { OversightRow } from "@/lib/presbytery";
import { OversightEditForm } from "./edit-form";

afterEach(() => {
  cleanup();
  setAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  refresh.mockReset();
});

const ROW: OversightRow = {
  organizationId: "cong-1",
  name: "Alder Creek Presbyterian Church",
  platformStatus: "managed",
  hasData: false,
  viabilityScore: null,
  redevelopmentNotes: null,
  buildingsNotes: null,
  latitude: null,
  longitude: null,
  updatedAt: null,
};

const lat = () => screen.getByLabelText("Latitude") as HTMLInputElement;
const lng = () => screen.getByLabelText("Longitude") as HTMLInputElement;
const paste = (el: HTMLElement, text: string) =>
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

describe("OversightEditForm — Map location", () => {
  it("says what the group is for, with a hint on each box (and no 'future' map)", () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    expect(screen.getByText("Map location")).toBeTruthy();
    expect(screen.queryByText(/future viability map/i)).toBeNull();
    expect(screen.getByText(/Optional\. Enter both numbers, or leave both blank\./)).toBeTruthy();
    expect(lat().getAttribute("aria-describedby")).toBe("oversight-latitude-hint");
    expect(lng().getAttribute("aria-describedby")).toBe("oversight-longitude-hint");
    expect(document.getElementById("oversight-latitude-hint")?.textContent).toBe(
      "Decimal degrees between -90 and 90, for example 39.9612. Enter this first.",
    );
    expect(document.getElementById("oversight-longitude-hint")?.textContent).toMatch(
      /^Decimal degrees between -180 and 180\. Congregations in the United States have a negative\s+longitude, for example -82\.9988\.$/,
    );
  });

  it("uses text inputs (a number input discards a pasted pair), with no inputMode (the iOS keypad has no minus key)", () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    for (const el of [lat(), lng()]) {
      expect(el.type).toBe("text");
      expect(el.getAttribute("inputmode")).toBeNull();
      expect(el.getAttribute("autocomplete")).toBe("off");
    }
  });

  it("splits a pasted pair into both boxes, and says so", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    expect(screen.queryByRole("status")?.textContent).toBe("");
    const notPrevented = paste(lat(), "39.9612, -82.9988");
    expect(notPrevented).toBe(false); // default prevented: the raw paste did not land
    await waitFor(() => expect(lng().value).toBe("-82.9988"));
    expect(lat().value).toBe("39.9612");
    expect(screen.getByRole("status").textContent).toBe(
      "Filled latitude and longitude from the pasted pair. Check them before you save.",
    );
  });

  it("splits a pair pasted into the longitude box too", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    paste(lng(), "(39.9612°, -82.9988°)");
    await waitFor(() => expect(lat().value).toBe("39.9612"));
    expect(lng().value).toBe("-82.9988");
  });

  it("leaves an ordinary paste alone", () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    const notPrevented = paste(lat(), "39.9612");
    expect(notPrevented).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(lng().value).toBe("");
  });

  it("clears the paste note once either box is edited", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    paste(lat(), "39.9612, -82.9988");
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(""));
    type(lat(), "40");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
  });

  it("refuses a half-set pair inline with the server's sentence, and does not call the action", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    type(lat(), "39.9612");
    save();
    expect(await screen.findByText("Enter both latitude and longitude, or leave both blank.")).toBeTruthy();
    expect(setAction).not.toHaveBeenCalled();
  });

  it("refuses 0 and 0 inline", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    type(lat(), "0");
    type(lng(), "0");
    save();
    expect(await screen.findByText(/^0 and 0 is a point in the ocean/)).toBeTruthy();
    expect(setAction).not.toHaveBeenCalled();
  });

  it("refuses a non-decimal value inline ('Must be a number')", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    type(lat(), "1e5");
    type(lng(), "-82");
    save();
    expect(await screen.findByText("Must be a number")).toBeTruthy();
    expect(setAction).not.toHaveBeenCalled();
  });

  it("sends numbers (not strings) for a valid pair, and null for both blank", async () => {
    setAction.mockResolvedValue({ ok: true });
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} />);
    type(lat(), "39.9612");
    type(lng(), "-82.9988");
    save();
    await waitFor(() => expect(setAction).toHaveBeenCalledTimes(1));
    expect(setAction.mock.calls[0]![2]).toMatchObject({ latitude: 39.9612, longitude: -82.9988 });
    cleanup();

    setAction.mockReset().mockResolvedValue({ ok: true });
    render(<OversightEditForm slug="s" aboutOrgId="a" row={{ ...ROW, latitude: "39.9612", longitude: "-82.9988" }} />);
    type(lat(), "");
    type(lng(), "");
    save();
    await waitFor(() => expect(setAction).toHaveBeenCalledTimes(1));
    expect(setAction.mock.calls[0]![2]).toMatchObject({ latitude: null, longitude: null });
  });

  it("shows a stored legacy half-set value so the clerk can fix it, and refuses to save it unchanged", async () => {
    render(<OversightEditForm slug="s" aboutOrgId="a" row={{ ...ROW, latitude: "39.9612", longitude: null }} />);
    expect(lat().value).toBe("39.9612");
    save();
    expect(await screen.findByText("Enter both latitude and longitude, or leave both blank.")).toBeTruthy();
    expect(setAction).not.toHaveBeenCalled();
  });
});

describe("OversightEditForm — the save toast", () => {
  const DESCRIPTION = "Congregations with a location are shown on the map in Insights & Analytics.";

  async function saveWith(mapOn: boolean, latitude: string, longitude: string) {
    setAction.mockResolvedValue({ ok: true });
    render(<OversightEditForm slug="s" aboutOrgId="a" row={ROW} mapOn={mapOn} />);
    if (latitude) type(lat(), latitude);
    if (longitude) type(lng(), longitude);
    await act(async () => {
      save();
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    return toastSuccess.mock.calls[0]!;
  }

  it("keeps its title and adds the description only for a saved location when the map is on", async () => {
    expect(await saveWith(true, "39.9612", "-82.9988")).toEqual([
      "Oversight record saved.",
      { description: DESCRIPTION },
    ]);
  });

  it("adds no description when the map is off", async () => {
    expect(await saveWith(false, "39.9612", "-82.9988")).toEqual(["Oversight record saved.", undefined]);
  });

  it("adds no description when the pair is cleared (nothing to see on the map)", async () => {
    expect(await saveWith(true, "", "")).toEqual(["Oversight record saved.", undefined]);
  });
});

describe("OversightEditForm — touch targets", () => {
  it("the viability select and both coordinate boxes are 44px controls (min-h-11) — regression for the assessment form at 360px", () => {
    render(<OversightEditForm slug="northern-reach" aboutOrgId="cong-1" row={ROW} mapOn={false} />);
    for (const control of [screen.getByLabelText("Viability"), lat(), lng()]) {
      expect(control.className, control.id).toContain("min-h-11");
    }
  });
});
