// @vitest-environment jsdom
/**
 * Tests for <BrandingForm> — tenant-branding-permission pipeline, Phase 4
 * commit 3/3.
 *
 * `./actions` is mocked: it is a "use server" module whose real
 * implementation pulls `@/lib/tenant-branding` (and, transitively, the Neon
 * pool) into the module graph, which a unit test has no business booting —
 * same reasoning as the platform's own `brand-form.test.tsx` header, which
 * this file mirrors.
 *
 * What this file pins, beyond the platform form's own coverage:
 *
 *   - `setOrgBrandAction` is called with `(slug, formData)` — the slug is
 *     CLOSED OVER, never read off the submitted FormData, and there is no
 *     hidden `organizationId` input anywhere in the form.
 *   - Every `PolicyResult` kind this pipeline's commit 2 defined surfaces
 *     the right user-facing copy: success, each validation-error string,
 *     forbidden, and the partial-save (E-c2) case.
 *   - THE STALENESS-BUG FIX: when the component re-renders with NEW
 *     `initial*` props (simulating a post-save `revalidatePath` re-fetch of
 *     the server tree, without a remount), the form's fields pick up the new
 *     values — the platform form's own known defect, named in
 *     `docs/TODO.md`, does not carry forward into this adaptation.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyResult } from "./actions";

const setOrgBrandAction =
  vi.fn<(slug: string, fd: FormData) => Promise<PolicyResult>>();

vi.mock("./actions", () => ({
  setOrgBrandAction: (slug: string, fd: FormData) =>
    setOrgBrandAction(slug, fd),
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

import { BrandingForm } from "./branding-form";

afterEach(() => {
  cleanup();
  setOrgBrandAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
});

function renderForm(overrides: {
  slug?: string;
  initialSeedHex?: string | null;
  initialTypePairing?: "classic" | "modern" | "warm";
  initialLightOnly?: boolean;
  initialMarkSrc?: string | null;
} = {}) {
  return render(
    <BrandingForm
      slug={overrides.slug ?? "alder-creek"}
      organizationName="Invented Fixture Congregation"
      initialSeedHex={overrides.initialSeedHex ?? "#2563eb"}
      initialTypePairing={overrides.initialTypePairing ?? "classic"}
      initialMarkSrc={overrides.initialMarkSrc ?? null}
      initialLightOnly={overrides.initialLightOnly ?? false}
    />,
  );
}

describe("BrandingForm — no hidden organizationId, slug closed over", () => {
  it("has no organizationId form field anywhere", () => {
    const { container } = renderForm();
    expect(
      container.querySelector('input[name="organizationId"]'),
    ).toBeNull();
  });

  it("calls setOrgBrandAction with the slug as the first argument", async () => {
    setOrgBrandAction.mockResolvedValue({ ok: true });
    renderForm({ slug: "bramblewood" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(setOrgBrandAction).toHaveBeenCalledTimes(1);
    expect(setOrgBrandAction.mock.calls[0]?.[0]).toBe("bramblewood");
    expect(setOrgBrandAction.mock.calls[0]?.[1]).toBeInstanceOf(FormData);
  });
});

describe("BrandingForm — live preview", () => {
  it("renders a light and a dark preview for the initial colour with no adjustments", () => {
    renderForm();
    expect(screen.getByText(/light preview/i)).toBeTruthy();
    expect(screen.getByText(/dark preview/i)).toBeTruthy();
    expect(screen.queryByText(/before you save/i)).toBeNull();
  });

  it("re-derives the preview when the hex code changes, entirely client-side", () => {
    renderForm();
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;

    fireEvent.change(hexInput, { target: { value: "#808080" } });

    expect(setOrgBrandAction).not.toHaveBeenCalled();
    expect(screen.getByText(/before you save/i)).toBeTruthy();
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

describe("BrandingForm — every PolicyResult kind surfaces the right copy", () => {
  it("shows a green, non-error banner and a success toast on ok:true", async () => {
    setOrgBrandAction.mockResolvedValue({ ok: true });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(screen.getByText("Brand saved.")).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith("Brand saved.");
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces the forbidden message inline and via toast.error", async () => {
    setOrgBrandAction.mockResolvedValue({
      ok: false,
      error: "You don't have permission to manage this organization's brand.",
    });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(
      screen.getByText(
        "You don't have permission to manage this organization's brand.",
      ),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage this organization's brand.",
    );
  });

  it("surfaces an invalid_hex-shaped error verbatim", async () => {
    setOrgBrandAction.mockResolvedValue({
      ok: false,
      error: "Enter a colour as a 6-digit hex code, like #7a1f2b.",
    });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(
      screen.getByText("Enter a colour as a 6-digit hex code, like #7a1f2b."),
    ).toBeTruthy();
  });

  it("surfaces a logo_rejected-shaped error verbatim, as a total failure (no prior colour change)", async () => {
    setOrgBrandAction.mockResolvedValue({
      ok: false,
      error:
        "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
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

  it("treats a partial save (E-c2, colour saved / logo failed) as distinct from a total failure — warning toast, amber banner", async () => {
    const partialError =
      "Colour and type pairing saved. The logo could not be stored: That file is 5 MB — we can take up to 2 MB.";
    setOrgBrandAction.mockResolvedValue({ ok: false, error: partialError });
    renderForm();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    const banner = screen.getByText(partialError);
    expect(banner).toBeTruthy();
    expect(banner.className).toMatch(/amber/);
    expect(banner.className).not.toMatch(/red/);
    expect(toastWarning).toHaveBeenCalledWith(partialError);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("BrandingForm — light mode only", () => {
  it("reflects the initial value and submits \"on\" when checked", async () => {
    setOrgBrandAction.mockResolvedValue({ ok: true });
    renderForm({ initialLightOnly: false });

    const checkbox = screen.getByLabelText("Light mode only") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    const submitted = setOrgBrandAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("lightOnly")).toBe("on");
  });

  it("starts checked when initialLightOnly is true, and omits the field from FormData when unchecked", async () => {
    setOrgBrandAction.mockResolvedValue({ ok: true });
    renderForm({ initialLightOnly: true });

    const checkbox = screen.getByLabelText("Light mode only") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    const submitted = setOrgBrandAction.mock.calls[0]?.[1] as FormData;
    expect(submitted.get("lightOnly")).toBeNull();
  });
});

describe("BrandingForm — staleness-bug fix (docs/TODO.md, carried forward as fixed, not reproduced)", () => {
  it("re-seeds the hex/pairing/lightOnly fields when the initial* props change value, without a remount", () => {
    const { rerender } = renderForm({
      initialSeedHex: "#2563eb",
      initialTypePairing: "classic",
      initialLightOnly: false,
    });

    let hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;
    expect(hexInput.value).toBe("#2563eb");
    let lightOnlyCheckbox = screen.getByLabelText(
      "Light mode only",
    ) as HTMLInputElement;
    expect(lightOnlyCheckbox.checked).toBe(false);

    // Simulate the server tree re-rendering this component with fresh props
    // after a successful save's revalidatePath() — the SAME component
    // instance (no key change, no unmount), which is exactly the case the
    // platform form's known bug fails on.
    rerender(
      <BrandingForm
        slug="alder-creek"
        organizationName="Invented Fixture Congregation"
        initialSeedHex="#7a1f2b"
        initialTypePairing="classic"
        initialMarkSrc={null}
        initialLightOnly={true}
      />,
    );

    hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;
    expect(hexInput.value).toBe("#7a1f2b");
    lightOnlyCheckbox = screen.getByLabelText(
      "Light mode only",
    ) as HTMLInputElement;
    expect(lightOnlyCheckbox.checked).toBe(true);
  });

  it("does not clobber a user's in-progress edit on the SAME render the props were already reflecting (no infinite re-seed loop)", () => {
    renderForm({ initialSeedHex: "#2563eb" });
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;

    fireEvent.change(hexInput, { target: { value: "#123abc" } });
    expect(hexInput.value).toBe("#123abc");

    // No re-render with new props happened — the user's own edit must
    // survive, proving the effect only re-seeds on an actual prop change,
    // not on every render.
    expect(hexInput.value).toBe("#123abc");
  });
});
