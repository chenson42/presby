// @vitest-environment jsdom
/**
 * `AddDistrictForm` (Copy C1; tag CMP). A `useForm` root inside `<HydrationGate>`
 * (the static tripwire is `npm run check:hydration-gate`; the browser proof is
 * e2e/hydration/parishes-controls.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const defineAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  defineDistrictAction: (...args: unknown[]) => defineAction(...args),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

import { AddDistrictForm } from "./add-district-form";

beforeEach(() => {
  defineAction.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
});
afterEach(cleanup);

async function submit(name: string) {
  fireEvent.change(screen.getByLabelText("District name"), { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add district" }));
  });
}

describe("AddDistrictForm", () => {
  it("is a labelled field with the 80-character hint and a full-width-on-mobile 44px button, inside a hydration gate", () => {
    const { container } = render(<AddDistrictForm slug="alder-creek" />);
    expect(screen.getByLabelText("District name")).toBeTruthy();
    expect(screen.getByText("Up to 80 characters.")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Add district" });
    expect(button.className).toContain("min-h-11");
    expect(button.className).toContain("w-full");
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
  });

  it("submits the typed name, toasts `District added.`, clears the field and refreshes", async () => {
    defineAction.mockResolvedValue({ ok: true, data: { orgUnitId: "u1", name: "North District" } });
    render(<AddDistrictForm slug="alder-creek" />);
    await submit("North District");
    await waitFor(() => expect(defineAction).toHaveBeenCalled());
    expect(defineAction).toHaveBeenCalledWith("alder-creek", { name: "North District" });
    expect(toastSuccess).toHaveBeenCalledWith("District added.");
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByLabelText("District name") as HTMLInputElement).value).toBe("");
  });

  it("an empty name is refused client-side with `Enter a name for the district.`", async () => {
    render(<AddDistrictForm slug="alder-creek" />);
    await submit("   ");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Enter a name for the district."),
    );
    expect(defineAction).not.toHaveBeenCalled();
  });

  it("an 81-character name is refused client-side with `Use 80 characters or fewer.`", async () => {
    render(<AddDistrictForm slug="alder-creek" />);
    await submit("x".repeat(81));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Use 80 characters or fewer."));
    expect(defineAction).not.toHaveBeenCalled();
  });

  it("a duplicate name is the server's copy, inline, and nothing is cleared or refreshed", async () => {
    defineAction.mockResolvedValue({ ok: false, error: "A district with that name already exists." });
    render(<AddDistrictForm slug="alder-creek" />);
    await submit("North District");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("A district with that name already exists."),
    );
    expect((screen.getByLabelText("District name") as HTMLInputElement).value).toBe("North District");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a thrown error is `We couldn't save that. Nothing was changed.`", async () => {
    defineAction.mockRejectedValue(new Error("network down"));
    render(<AddDistrictForm slug="alder-creek" />);
    await submit("North District");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("We couldn't save that. Nothing was changed."),
    );
  });
});
