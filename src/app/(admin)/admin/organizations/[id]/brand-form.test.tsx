// @vitest-environment jsdom
/**
 * Tests for <BrandForm> — P0.5 slice c, commit `c3`.
 *
 * `./actions` is mocked: it is a "use server" module whose real
 * implementation pulls getPlatformDb() / @/auth into the module graph,
 * which a unit test has no business booting. What this file pins is the
 * SHAPE the Phase 3 design and this commit's edge cases require:
 *
 *   - the live preview re-derives from generateBrandTokens() on every hex
 *     change with NO call into the mocked action (client-side, zero
 *     round-trip);
 *   - Flow 3: a non-empty adjustments[] renders BEFORE Save is meaningful,
 *     unconditionally, no disclosure to open;
 *   - E-c1/E-c2: the server's returned `error` string is surfaced INLINE
 *     (not only as a toast — a toast can vanish), and a partial-save error
 *     (the "Colour and type pairing saved." prefix) gets a visually
 *     distinct, non-red treatment from a total failure.
 *
 * No jest-dom matchers — see org-mark.test.tsx's header for why.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyResult } from "./actions";

const setOrganizationBrandAction = vi.fn<(fd: FormData) => Promise<PolicyResult>>();

vi.mock("./actions", () => ({
  setOrganizationBrandAction: (fd: FormData) => setOrganizationBrandAction(fd),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

import { BrandForm } from "./brand-form";

afterEach(() => {
  cleanup();
  setOrganizationBrandAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
});

function renderForm(overrides: { initialLightOnly?: boolean } = {}) {
  return render(
    <BrandForm
      organizationId="22222222-2222-2222-2222-222222222222"
      organizationName="Invented Fixture Congregation"
      initialSeedHex="#2563eb"
      initialTypePairing="classic"
      initialMarkSrc={null}
      initialLightOnly={overrides.initialLightOnly ?? false}
    />,
  );
}

describe("BrandForm — live preview", () => {
  it("renders a light and a dark preview for the initial colour with no adjustments", () => {
    renderForm();
    expect(screen.getByText(/light preview/i)).toBeTruthy();
    expect(screen.getByText(/dark preview/i)).toBeTruthy();
    expect(screen.queryByText(/before you save/i)).toBeNull();
  });

  it("re-derives the preview when the hex code changes, entirely client-side (Flow 3)", () => {
    renderForm();
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;

    // A near-grey seed is the generator's documented near-grey path
    // (generate.ts's NEAR_GREY_CHROMA_THRESHOLD) — it always produces a
    // "brand" adjustment, so its message is a stable, deterministic thing to
    // assert on without depending on the mocked server action at all.
    fireEvent.change(hexInput, { target: { value: "#808080" } });

    expect(setOrganizationBrandAction).not.toHaveBeenCalled();
    expect(screen.getByText(/before you save/i)).toBeTruthy();
    // One adjustment per scheme (light + dark), both with the same message
    // for a near-grey seed — generate.ts derives each scheme independently
    // (D11), so this is two rows, not one.
    expect(screen.getAllByText(/very close to grey/i).length).toBe(2);
  });

  it("disables Save and hides the preview for an invalid hex code", () => {
    renderForm();
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;
    fireEvent.change(hexInput, { target: { value: "not-a-colour" } });

    const save = screen.getByRole("button", { name: /save brand/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/enter a valid colour to see a preview/i)).toBeTruthy();
  });
});

describe("BrandForm — submission outcomes (E-c1/E-c2)", () => {
  it("shows a green, non-error banner and a success toast on ok:true", async () => {
    setOrganizationBrandAction.mockResolvedValue({ ok: true });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(setOrganizationBrandAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Brand saved.")).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith("Brand saved.");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces a total failure's exact error string INLINE, not a generic message", async () => {
    setOrganizationBrandAction.mockResolvedValue({
      ok: false,
      error: "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
    });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(
      screen.getByText(
        "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
      ),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("treats a partial save (E-c2) as distinct from a total failure — warning toast, not error, and NOT the same banner colour", async () => {
    const partialError =
      "Colour and type pairing saved. The logo could not be stored: That file is 5 MB — we can take up to 2 MB.";
    setOrganizationBrandAction.mockResolvedValue({ ok: false, error: partialError });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    const banner = screen.getByText(partialError);
    expect(banner).toBeTruthy();
    // Distinct treatment: amber border, not the red total-failure border.
    expect(banner.className).toMatch(/amber/);
    expect(banner.className).not.toMatch(/red/);
    expect(toastWarning).toHaveBeenCalledWith(partialError);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("BrandForm — light mode only", () => {
  it("reflects the initial value and submits \"on\" when checked", async () => {
    setOrganizationBrandAction.mockResolvedValue({ ok: true });
    renderForm({ initialLightOnly: false });

    const checkbox = screen.getByLabelText("Light mode only") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    const submitted = setOrganizationBrandAction.mock.calls[0]?.[0] as FormData;
    expect(submitted.get("lightOnly")).toBe("on");
  });

  it("starts checked when initialLightOnly is true, and omits the field from FormData when unchecked", async () => {
    setOrganizationBrandAction.mockResolvedValue({ ok: true });
    renderForm({ initialLightOnly: true });

    const checkbox = screen.getByLabelText("Light mode only") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    const submitted = setOrganizationBrandAction.mock.calls[0]?.[0] as FormData;
    expect(submitted.get("lightOnly")).toBeNull();
  });
});
