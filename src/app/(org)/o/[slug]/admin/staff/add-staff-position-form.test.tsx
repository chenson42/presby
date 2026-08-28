// @vitest-environment jsdom
/**
 * Tests for <AddStaffPositionForm> — staff-and-personnel Phase 3,
 * ux-developer slice.
 *
 * `./actions` is mocked: it is a "use server" module whose real
 * implementation pulls `@/lib/staff`/`@/lib/people` (and, transitively, the
 * Neon pool) into the module graph — same reasoning as
 * `admin/officers/add-officer-term-form.test.tsx`'s header.
 *
 * What this file exists to pin, per Phase 3's design and the architect's
 * ruling that the People-domain gap must be VISIBLE, not just silently
 * enforced server-side:
 *
 *   - `canCreatePeople={false}` with zero current members renders an
 *     explanatory message and no form controls at all;
 *   - `canCreatePeople={false}` with existing members renders the picker but
 *     NEVER the "Can't find them? Add a new person" affordance — the
 *     visible half of the architect's Phase 2/3 permission-split ruling;
 *   - `canCreatePeople={true}` with zero current members renders the
 *     new-person sub-form directly, no picker;
 *   - `canCreatePeople={true}` with existing members renders the picker AND
 *     the "Add a new person" link, which reveals the sub-form;
 *   - the person-search input filters the picker's `<option>` list
 *     client-side (never a live server call);
 *   - creating a new person calls `createStaffPersonAction` with
 *     `rollAction: { kind: "none" }` and `household: { mode: "none" }`, then
 *     the newly created person is selected in the (now-visible-again)
 *     picker and the sub-form closes;
 *   - submit composes `StartStaffPositionInput` correctly (empty optional
 *     fields become `undefined`, not empty strings);
 *   - every mapped `ActionResult` denial surfaces via `toast.error`
 *     verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockStartStaffPositionAction = vi.hoisted(() => vi.fn());
const mockCreateStaffPersonAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  startStaffPositionAction: (...args: unknown[]) =>
    mockStartStaffPositionAction(...args),
  createStaffPersonAction: (...args: unknown[]) =>
    mockCreateStaffPersonAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterRefresh = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: mockRouterPush }),
}));

import { AddStaffPositionForm } from "./add-staff-position-form";
import type { StaffFormOptions } from "@/lib/staff";

afterEach(() => {
  cleanup();
  mockStartStaffPositionAction.mockReset();
  mockCreateStaffPersonAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
  mockRouterPush.mockReset();
});

const OPTIONS: StaffFormOptions = {
  people: [
    { personId: "person-1", displayName: "Tobias Renwick" },
    { personId: "person-2", displayName: "Marguerite Ashcombe" },
  ],
};

describe("AddStaffPositionForm — zero-people, no create permission", () => {
  it("renders an explanatory message and no controls", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={{ people: [] }}
        canCreatePeople={false}
      />,
    );
    expect(
      screen.getByText(/nobody has a current membership/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/don.t have permission to add a new person/i),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("AddStaffPositionForm — zero-people, WITH create permission", () => {
  it("renders the new-person sub-form directly, with no picker", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={{ people: [] }}
        canCreatePeople={true}
      />,
    );
    expect(screen.getByLabelText(/first name/i)).toBeTruthy();
    expect(screen.getByLabelText(/last name/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^person/i)).toBeNull();
  });
});

describe("AddStaffPositionForm — the visible permission split (architect's Phase 2/3 ruling)", () => {
  it("shows the picker but NOT the 'add a new person' affordance when canCreatePeople is false", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={false}
      />,
    );
    expect(screen.getByLabelText(/^person/i)).toBeTruthy();
    expect(
      screen.queryByText(/can.t find them\? add a new person/i),
    ).toBeNull();
    expect(
      screen.getByText(/ask someone who manages people/i),
    ).toBeTruthy();
  });

  it("shows both the picker AND the 'add a new person' affordance when canCreatePeople is true", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    expect(screen.getByLabelText(/^person/i)).toBeTruthy();
    expect(
      screen.getByText(/can.t find them\? add a new person/i),
    ).toBeTruthy();
  });
});

describe("AddStaffPositionForm — the person picker's client-side filter", () => {
  it("filters the <select>'s options by the search text, live, with no server call", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(screen.getByText("Marguerite Ashcombe")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/find person/i), {
      target: { value: "tobias" },
    });

    expect(screen.getByText("Tobias Renwick")).toBeTruthy();
    expect(screen.queryByText("Marguerite Ashcombe")).toBeNull();
  });
});

describe("AddStaffPositionForm — the inline 'add a new person' flow", () => {
  it("creates a person, then pre-selects them in the picker and closes the sub-form", async () => {
    mockCreateStaffPersonAction.mockResolvedValueOnce({
      ok: true,
      data: { personId: "person-3" },
    });

    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );

    fireEvent.click(
      screen.getByText(/can.t find them\? add a new person/i),
    );

    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: "Marisol" },
    });
    fireEvent.change(screen.getByLabelText(/last name/i), {
      target: { value: "Windham" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add person$/i }));
    });

    expect(mockCreateStaffPersonAction).toHaveBeenCalledWith("alder-creek", {
      identity: { mode: "new", firstName: "Marisol", lastName: "Windham" },
      contact: { email: undefined, phone: undefined },
      household: { mode: "none" },
      rollAction: { kind: "none" },
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Marisol Windham added — now record their position below.",
    );

    // The sub-form closes and the picker reappears with the new person
    // selected.
    expect(screen.queryByLabelText(/^first name/i)).toBeNull();
    const select = screen.getByLabelText(/^person/i) as HTMLSelectElement;
    expect(select.value).toBe("person-3");
    expect(screen.getByText("Marisol Windham")).toBeTruthy();
  });

  it("surfaces a createStaffPersonAction denial via toast.error, verbatim, and keeps the sub-form open", async () => {
    mockCreateStaffPersonAction.mockResolvedValueOnce({
      ok: false,
      error:
        "You don't have permission to add a new person. Ask someone who manages People to add them first.",
    });

    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    fireEvent.click(
      screen.getByText(/can.t find them\? add a new person/i),
    );
    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: "Marisol" },
    });
    fireEvent.change(screen.getByLabelText(/last name/i), {
      target: { value: "Windham" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^add person$/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to add a new person. Ask someone who manages People to add them first.",
    );
    // Sub-form stays open on failure — nothing to switch back to.
    expect(screen.getByLabelText(/first name/i)).toBeTruthy();
  });
});

describe("AddStaffPositionForm — submit and error surfacing", () => {
  it("submits with optional fields converted (blank → undefined)", async () => {
    mockStartStaffPositionAction.mockResolvedValueOnce({
      ok: true,
      data: { positionId: "position-1" },
    });

    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^position/i), {
      target: { value: "Church Secretary" },
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add staff position/i }),
      );
    });

    expect(mockStartStaffPositionAction).toHaveBeenCalledWith("alder-creek", {
      personId: "person-1",
      position: "Church Secretary",
      department: undefined,
      startsOn: "2026-01-08",
      minuteReference: undefined,
    });
    expect(toastSuccess).toHaveBeenCalledWith("Staff position recorded.");
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("includes department and minuteReference when populated", async () => {
    mockStartStaffPositionAction.mockResolvedValueOnce({
      ok: true,
      data: { positionId: "position-1" },
    });

    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );

    fireEvent.change(screen.getByLabelText(/^position/i), {
      target: { value: "Custodian" },
    });
    fireEvent.change(screen.getByLabelText(/department/i), {
      target: { value: "Facilities" },
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });
    fireEvent.change(screen.getByLabelText(/minute reference/i), {
      target: { value: "Session minutes, 12 Jan 2026" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add staff position/i }),
      );
    });

    expect(mockStartStaffPositionAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({
        department: "Facilities",
        minuteReference: "Session minutes, 12 Jan 2026",
      }),
    );
  });

  it("surfaces the composed overlap message via toast.error, verbatim", async () => {
    mockStartStaffPositionAction.mockResolvedValueOnce({
      ok: false,
      error:
        "Tobias Renwick already has an open position as Church Secretary — end it first.",
    });

    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^position/i), {
      target: { value: "Church Secretary" },
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add staff position/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "Tobias Renwick already has an open position as Church Secretary — end it first.",
    );
  });

  it("surfaces a forbidden message via toast.error, verbatim", async () => {
    mockStartStaffPositionAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage staff here.",
    });

    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^position/i), {
      target: { value: "Church Secretary" },
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add staff position/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage staff here.",
    );
  });
});

describe("AddStaffPositionForm — required-field markers", () => {
  it("marks Person and Position and Start date as required", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    expect(
      screen.getByLabelText(/^person/i).getAttribute("aria-required"),
    ).toBe("true");
    expect(
      screen.getByLabelText(/^position/i).getAttribute("aria-required"),
    ).toBe("true");
    expect(
      screen.getByLabelText(/start date/i).getAttribute("aria-required"),
    ).toBe("true");
  });

  it("does NOT mark an optional field (minute reference) as required", () => {
    render(
      <AddStaffPositionForm
        slug="alder-creek"
        options={OPTIONS}
        canCreatePeople={true}
      />,
    );
    expect(
      screen.getByLabelText(/minute reference/i).getAttribute("aria-required"),
    ).toBeNull();
  });
});
