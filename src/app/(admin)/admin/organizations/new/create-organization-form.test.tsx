// @vitest-environment jsdom
/**
 * Tests for <CreateOrganizationForm> —
 * docs/work-log/2026-09-28-organization-parent-picker.md Phase 3/4.
 * `./actions` is mocked (a "use server" module whose real implementation
 * pulls the DB layer into the module graph — same reasoning the sibling
 * `[id]` component tests give for their own mocks).
 *
 * Pins:
 *   - the Parent organization <select> lists ONLY the parent type the chosen
 *     organization type may sit under (polity pairing, a courtesy filter —
 *     the server trigger stays the enforcement boundary);
 *   - changing the organization type ALWAYS clears a chosen parent (Flow 5);
 *   - the relationship type is derived and submitted as a hidden field;
 *   - the SENTINEL TRANSLATION: "None" submits an EMPTY `parentOrganizationId`
 *     (never the literal "none", which would fail the action's UUID check on
 *     every ordinary root-organization create);
 *   - general_assembly has no parent field; empty-list and fetch-failure copy;
 *   - the minute reference input only exists while a parent is chosen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CreateOrgPolicyResult } from "./actions";

const mockCreateAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createOrganizationAction: (fd: FormData) => mockCreateAction(fd),
}));

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateOrganizationForm } from "./create-organization-form";

afterEach(() => {
  cleanup();
  mockCreateAction.mockReset();
  mockPush.mockReset();
});

const PRESBYTERY_A = "11111111-1111-4111-8111-111111111111";
const PRESBYTERY_B = "22222222-2222-4222-8222-222222222222";
const SYNOD_A = "33333333-3333-4333-8333-333333333333";

const PARENTS = {
  presbytery: [
    { id: PRESBYTERY_A, name: "Presbytery Alpha" },
    { id: PRESBYTERY_B, name: "Presbytery Beta" },
  ],
  synod: [{ id: SYNOD_A, name: "Synod One" }],
  general_assembly: [],
};

function parentSelect(): HTMLSelectElement {
  return screen.getByLabelText(/parent organization/i) as HTMLSelectElement;
}
function typeSelect(): HTMLSelectElement {
  return screen.getByLabelText("Organization type") as HTMLSelectElement;
}
function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.textContent ?? "");
}
function hidden(container: HTMLElement, name: string): HTMLInputElement {
  return container.querySelector(
    `input[type="hidden"][name="${name}"]`,
  ) as HTMLInputElement;
}
function chooseType(value: string) {
  fireEvent.change(typeSelect(), { target: { value } });
}

describe("CreateOrganizationForm — parent filtering by organization type", () => {
  it("congregation (the default) lists presbyteries only, after the None option", () => {
    render(<CreateOrganizationForm eligibleParents={PARENTS} />);
    expect(optionLabels(parentSelect())).toEqual([
      "None — this will be a root organization",
      "Presbytery Alpha",
      "Presbytery Beta",
    ]);
  });

  it("presbytery lists synods only", () => {
    render(<CreateOrganizationForm eligibleParents={PARENTS} />);
    chooseType("presbytery");
    expect(optionLabels(parentSelect())).toEqual([
      "None — this will be a root organization",
      "Synod One",
    ]);
  });

  it("new_worshiping_community lists presbyteries", () => {
    render(<CreateOrganizationForm eligibleParents={PARENTS} />);
    chooseType("new_worshiping_community");
    expect(optionLabels(parentSelect())).toContain("Presbytery Alpha");
    expect(optionLabels(parentSelect())).not.toContain("Synod One");
  });
});

describe("CreateOrganizationForm — clear parent on type change (Flow 5)", () => {
  it("resets a chosen parent when the organization type changes", () => {
    const { container } = render(
      <CreateOrganizationForm eligibleParents={PARENTS} />,
    );
    fireEvent.change(parentSelect(), { target: { value: PRESBYTERY_A } });
    expect(parentSelect().value).toBe(PRESBYTERY_A);
    expect(hidden(container, "parentOrganizationId").value).toBe(PRESBYTERY_A);

    chooseType("presbytery");
    expect(parentSelect().value).toBe("none");
    expect(hidden(container, "parentOrganizationId").value).toBe("");
    expect(hidden(container, "relationshipType").value).toBe("");
  });

  it("clears even between congregation and new_worshiping_community (same parent type)", () => {
    const { container } = render(
      <CreateOrganizationForm eligibleParents={PARENTS} />,
    );
    fireEvent.change(parentSelect(), { target: { value: PRESBYTERY_B } });
    chooseType("new_worshiping_community");
    expect(parentSelect().value).toBe("none");
    expect(hidden(container, "parentOrganizationId").value).toBe("");
  });
});

describe("CreateOrganizationForm — derived relationship type", () => {
  it.each([
    ["congregation", PRESBYTERY_A, "member_congregation"],
    ["new_worshiping_community", PRESBYTERY_A, "member_nwc"],
    ["presbytery", SYNOD_A, "member_presbytery"],
  ])("%s under a parent submits %s", (type, parentId, expected) => {
    const { container } = render(
      <CreateOrganizationForm eligibleParents={PARENTS} />,
    );
    chooseType(type);
    fireEvent.change(parentSelect(), { target: { value: parentId } });
    expect(hidden(container, "relationshipType").value).toBe(expected);
    expect(hidden(container, "parentOrganizationId").value).toBe(parentId);
  });

  it("synod under a general assembly submits member_synod", () => {
    const GA = "44444444-4444-4444-8444-444444444444";
    const { container } = render(
      <CreateOrganizationForm
        eligibleParents={{
          ...PARENTS,
          general_assembly: [{ id: GA, name: "The General Assembly" }],
        }}
      />,
    );
    chooseType("synod");
    fireEvent.change(parentSelect(), { target: { value: GA } });
    expect(hidden(container, "relationshipType").value).toBe("member_synod");
  });
});

describe("CreateOrganizationForm — sentinel translation", () => {
  it("the visible select is NOT named parentOrganizationId (so 'none' can never be submitted as the id)", () => {
    render(<CreateOrganizationForm eligibleParents={PARENTS} />);
    expect(parentSelect().name).toBe("parentOrganizationChoice");
    expect(parentSelect().value).toBe("none");
  });

  it("submitting with None sends an EMPTY parentOrganizationId and relationshipType", async () => {
    mockCreateAction.mockResolvedValue({
      ok: true,
      organizationId: "aaaaaaaa-0000-4000-8000-000000000000",
    } satisfies CreateOrgPolicyResult);
    const { container } = render(
      <CreateOrganizationForm eligibleParents={PARENTS} />,
    );
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(mockCreateAction).toHaveBeenCalledTimes(1);
    const fd: FormData = mockCreateAction.mock.calls[0][0];
    expect(fd.get("parentOrganizationId")).toBe("");
    expect(fd.get("relationshipType")).toBe("");
    expect(fd.get("parentOrganizationId")).not.toBe("none");
  });

  it("submitting with a parent sends the real id, derived relationship and minute reference", async () => {
    mockCreateAction.mockResolvedValue({
      ok: true,
      organizationId: "aaaaaaaa-0000-4000-8000-000000000000",
    } satisfies CreateOrgPolicyResult);
    const { container } = render(
      <CreateOrganizationForm eligibleParents={PARENTS} />,
    );
    fireEvent.change(parentSelect(), { target: { value: PRESBYTERY_A } });
    fireEvent.change(screen.getByLabelText(/minute reference/i), {
      target: { value: "Minutes 2026-05, item 7" },
    });
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    const fd: FormData = mockCreateAction.mock.calls[0][0];
    expect(fd.get("parentOrganizationId")).toBe(PRESBYTERY_A);
    expect(fd.get("relationshipType")).toBe("member_congregation");
    expect(fd.get("minuteReference")).toBe("Minutes 2026-05, item 7");
    expect(fd.get("organizationType")).toBe("congregation");
  });
});

describe("CreateOrganizationForm — minute reference", () => {
  it("is absent with no parent, present (maxLength 500) once a parent is chosen", () => {
    render(<CreateOrganizationForm eligibleParents={PARENTS} />);
    expect(screen.queryByLabelText(/minute reference/i)).toBeNull();
    fireEvent.change(parentSelect(), { target: { value: PRESBYTERY_A } });
    const input = screen.getByLabelText(/minute reference/i) as HTMLInputElement;
    expect(input.maxLength).toBe(500);
    expect(input.name).toBe("minuteReference");
  });
});

describe("CreateOrganizationForm — general_assembly and degraded states", () => {
  it("general_assembly renders no parent field and says why", () => {
    const { container } = render(
      <CreateOrganizationForm eligibleParents={PARENTS} />,
    );
    chooseType("general_assembly");
    expect(screen.queryByLabelText(/parent organization/i)).toBeNull();
    expect(
      screen.getByText(
        "The General Assembly is the top of the hierarchy — it has no parent.",
      ),
    ).toBeTruthy();
    expect(hidden(container, "parentOrganizationId").value).toBe("");
    expect(hidden(container, "relationshipType").value).toBe("");
  });

  it("an empty eligible list shows the create-one-first copy, with only the None option", () => {
    render(
      <CreateOrganizationForm
        eligibleParents={{ presbytery: [], synod: [], general_assembly: [] }}
      />,
    );
    expect(optionLabels(parentSelect())).toEqual([
      "None — this will be a root organization",
    ]);
    expect(
      screen.getByText("No presbyteries exist yet — create one first."),
    ).toBeTruthy();
  });

  it("a presbytery with no synods available reads as a legitimate root, not an error", () => {
    render(
      <CreateOrganizationForm
        eligibleParents={{ presbytery: [], synod: [], general_assembly: [] }}
      />,
    );
    chooseType("presbytery");
    expect(screen.getByText("No synods exist yet — create one first.")).toBeTruthy();
    expect(parentSelect().value).toBe("none");
  });

  it("a failed parent fetch (null) degrades with retry copy and the rest of the form still submits", async () => {
    mockCreateAction.mockResolvedValue({
      ok: true,
      organizationId: "aaaaaaaa-0000-4000-8000-000000000000",
    } satisfies CreateOrgPolicyResult);
    const { container } = render(<CreateOrganizationForm eligibleParents={null} />);
    expect(
      screen.getByText(
        "We couldn't load the list of presbyteries — try again.",
      ),
    ).toBeTruthy();
    expect(optionLabels(parentSelect())).toEqual([
      "None — this will be a root organization",
    ]);
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(mockCreateAction).toHaveBeenCalledTimes(1);
  });
});
