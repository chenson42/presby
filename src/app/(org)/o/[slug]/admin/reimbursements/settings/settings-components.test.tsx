// @vitest-environment jsdom
/**
 * The settings page's controls (Copy C9, amendment S5): the chargeable switches,
 * the categories list with Rename and Retire, and the Add a category form. What is
 * pinned: the switch posts and puts itself back on a refusal, the category errors
 * are Copy's words beside the field, the entry stays through a failure, the two
 * form roots carry a HydrationGate, and no success toast is invented (Copy gives none).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
  setChargeableAction: vi.fn(),
  saveCategoryAction: vi.fn(),
  endCategoryAction: vi.fn(),
}));
vi.mock("../actions", () => actions);

import { COPY } from "@/lib/reimbursement/copy";
import { AddCategoryForm } from "./add-category-form";
import { CategoriesPanel } from "./categories-panel";
import { ChargeableGroups } from "./chargeable-groups";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const C1 = "33333333-3333-4333-8333-333333333333";
const groups = [
  { id: G1, name: "Property Committee", membershipSource: "managed", chargeable: true, approverCount: 2 },
  { id: G2, name: "Session", membershipSource: "derived", chargeable: false, approverCount: 0 },
];

beforeEach(() => {
  for (const m of [refresh, push, toast.success, toast.error, ...Object.values(actions)]) m.mockReset();
});
afterEach(cleanup);

describe("ChargeableGroups", () => {
  it("one switch per group, labelled 'Can receive requests', reflecting the database", () => {
    render(<ChargeableGroups slug="alder" groups={groups} />);
    const switches = screen.getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(screen.getByRole("switch", { name: COPY.settings.chargeableSwitch, checked: true })).toBeTruthy();
    expect(screen.getAllByText(COPY.settings.chargeableSwitch)).toHaveLength(2);
  });

  it("turning a group on posts the slug, the group and true, and re-reads the page with NO toast (Copy gives none)", async () => {
    actions.setChargeableAction.mockResolvedValue({ ok: true, data: { changed: true } });
    render(<ChargeableGroups slug="alder" groups={groups} />);
    fireEvent.click(screen.getAllByRole("switch")[1]!);
    await waitFor(() => expect(actions.setChargeableAction).toHaveBeenCalledWith("alder", { groupId: G2, chargeable: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getAllByRole("switch")[1]!.getAttribute("aria-checked")).toBe("true");
  });

  it("a refusal puts the switch back and says why", async () => {
    actions.setChargeableAction.mockResolvedValue({ ok: false, error: COPY.fieldErrors.groupUnavailable });
    render(<ChargeableGroups slug="alder" groups={groups} />);
    fireEvent.click(screen.getAllByRole("switch")[1]!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.fieldErrors.groupUnavailable));
    expect(screen.getAllByRole("switch")[1]!.getAttribute("aria-checked")).toBe("false");
  });

  it("a thrown call puts it back with the save-failed sentence", async () => {
    actions.setChargeableAction.mockRejectedValue(new Error("x"));
    render(<ChargeableGroups slug="alder" groups={groups} />);
    fireEvent.click(screen.getAllByRole("switch")[0]!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.form.saveFailed));
    expect(screen.getAllByRole("switch")[0]!.getAttribute("aria-checked")).toBe("true");
  });
});

describe("AddCategoryForm", () => {
  it("is rooted in a HydrationGate and has Copy's field and button", () => {
    const { container } = render(<AddCategoryForm slug="alder" />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect(screen.getByLabelText(COPY.settings.categoryName)).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.settings.addCategory })).toBeTruthy();
  });

  it("an empty or over-long name is 'Use 1 to 60 characters.' and nothing is sent", () => {
    render(<AddCategoryForm slug="alder" />);
    fireEvent.click(screen.getByTestId("add-category-submit"));
    expect(screen.getByText(COPY.settings.categoryNameInvalid)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(COPY.settings.categoryName), { target: { value: "x".repeat(61) } });
    fireEvent.click(screen.getByTestId("add-category-submit"));
    expect(screen.getByText(COPY.settings.categoryNameInvalid)).toBeTruthy();
    expect(actions.saveCategoryAction).not.toHaveBeenCalled();
  });

  it("creates (categoryId null), empties the box and re-reads the page", async () => {
    actions.saveCategoryAction.mockResolvedValue({ ok: true, data: { categoryId: C1, created: true } });
    render(<AddCategoryForm slug="alder" />);
    fireEvent.change(screen.getByLabelText(COPY.settings.categoryName), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByTestId("add-category-submit"));
    await waitFor(() => expect(actions.saveCategoryAction).toHaveBeenCalledWith("alder", { categoryId: null, name: "Supplies" }));
    await waitFor(() => expect((screen.getByLabelText(COPY.settings.categoryName) as HTMLInputElement).value).toBe(""));
    expect(refresh).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("a duplicate name is Copy's sentence under the box, and the name stays", async () => {
    actions.saveCategoryAction.mockResolvedValue({
      ok: false, error: COPY.settings.categoryNameTaken, fieldErrors: { name: COPY.settings.categoryNameTaken },
    });
    render(<AddCategoryForm slug="alder" />);
    fireEvent.change(screen.getByLabelText(COPY.settings.categoryName), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByTestId("add-category-submit"));
    expect(await screen.findByText(COPY.settings.categoryNameTaken)).toBeTruthy();
    expect((screen.getByLabelText(COPY.settings.categoryName) as HTMLInputElement).value).toBe("Supplies");
  });

  it("a thrown call is the save-failed sentence and the name stays", async () => {
    actions.saveCategoryAction.mockRejectedValue(new Error("x"));
    render(<AddCategoryForm slug="alder" />);
    fireEvent.change(screen.getByLabelText(COPY.settings.categoryName), { target: { value: "Supplies" } });
    fireEvent.click(screen.getByTestId("add-category-submit"));
    expect(await screen.findByText(COPY.form.saveFailed)).toBeTruthy();
    expect((screen.getByLabelText(COPY.settings.categoryName) as HTMLInputElement).value).toBe("Supplies");
  });
});

describe("CategoriesPanel", () => {
  const categories = [{ id: C1, name: "Supplies", sortOrder: 0 }];

  it("lists the categories with Rename and Retire that a screen reader hears with the name, and the hint", () => {
    render(<CategoriesPanel slug="alder" categories={categories} />);
    expect(screen.getByRole("button", { name: `${COPY.settings.retire} Supplies` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${COPY.settings.rename} Supplies` })).toBeTruthy();
    expect(screen.getByText(COPY.settings.categoriesHint)).toBeTruthy();
  });

  it("Retire asks first: cancel posts nothing; confirm posts and re-reads; a category already gone toasts Copy's sentence", async () => {
    actions.endCategoryAction.mockClear();
    actions.endCategoryAction.mockResolvedValueOnce({ ok: true, data: undefined });
    render(<CategoriesPanel slug="alder" categories={categories} />);
    fireEvent.click(screen.getByTestId("retire"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(COPY.settings.retireDialog.title("Supplies"))).toBeTruthy();
    expect(dialog.textContent).toContain(COPY.settings.retireDialog.body);
    expect(actions.endCategoryAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: COPY.settings.retireDialog.keep }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(actions.endCategoryAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("retire"));
    fireEvent.click(screen.getByTestId("retire-confirm"));
    await waitFor(() => expect(actions.endCategoryAction).toHaveBeenCalledWith("alder", { categoryId: C1 }));
    expect(actions.endCategoryAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
    actions.endCategoryAction.mockResolvedValueOnce({ ok: false, error: COPY.settings.categoryGone });
    await waitFor(() => expect((screen.getByTestId("retire") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("retire"));
    fireEvent.click(screen.getByTestId("retire-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.settings.categoryGone));
  });

  it("Rename opens a dialog holding the current name, and posts the category id with the new name", async () => {
    actions.saveCategoryAction.mockResolvedValue({ ok: true, data: { categoryId: C1, created: false } });
    render(<CategoriesPanel slug="alder" categories={categories} />);
    fireEvent.click(screen.getByTestId("rename-open"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    const field = within(dialog).getByLabelText(COPY.settings.categoryName) as HTMLInputElement;
    expect(field.value).toBe("Supplies");
    fireEvent.change(field, { target: { value: "Office supplies" } });
    fireEvent.click(screen.getByTestId("rename-confirm"));
    await waitFor(() => expect(actions.saveCategoryAction).toHaveBeenCalledWith("alder", { categoryId: C1, name: "Office supplies" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Rename to a taken name stays open with Copy's sentence; a vanished category closes and re-reads", async () => {
    actions.saveCategoryAction.mockResolvedValueOnce({
      ok: false, error: COPY.settings.categoryNameTaken, fieldErrors: { name: COPY.settings.categoryNameTaken },
    });
    render(<CategoriesPanel slug="alder" categories={categories} />);
    fireEvent.click(screen.getByTestId("rename-open"));
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText(COPY.settings.categoryName), { target: { value: "Taken" } });
    fireEvent.click(screen.getByTestId("rename-confirm"));
    expect(await screen.findByText(COPY.settings.categoryNameTaken)).toBeTruthy();
    actions.saveCategoryAction.mockResolvedValueOnce({ ok: false, error: COPY.settings.categoryGone });
    fireEvent.click(screen.getByTestId("rename-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.settings.categoryGone));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
