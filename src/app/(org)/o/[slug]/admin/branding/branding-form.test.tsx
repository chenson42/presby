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
 *   - THE STALENESS-BUG FIX: when this SAME component instance (no `key`,
 *     no remount) re-renders with NEW `initial*` props (simulating a
 *     post-save `revalidatePath` re-fetch of the server tree), the form's
 *     fields pick up the new values by adjusting state during render — the
 *     platform form's own known defect, named in `docs/TODO.md`, does not
 *     carry forward into this adaptation. A `key`-forced remount was tried
 *     and reverted (Phase 5 Finding 1, docs/work-log/2026-09-26-lint-gate.md)
 *     because it destroyed the save banner on every write path — see this
 *     file's own "save banner survives a post-save prop refresh" describe
 *     block below for the regression test that guards against it.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import type { PolicyResult } from "./actions";

const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

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
  mockRouterPush.mockReset();
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

describe("BrandingForm — staleness-bug fix (docs/TODO.md, fixed by adjusting state during render, not a remount)", () => {
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
    // instance (no key, no unmount). This is what actually exercises the
    // `if (initial* !== prevInitial*) {...}` render-time-adjust blocks in
    // branding-form.tsx: delete them and this assertion fails, because the
    // fields would never pick up the new props without either that
    // mechanism or a remount (which this fix deliberately does not use —
    // see Phase 5 Finding 1, docs/work-log/2026-09-26-lint-gate.md).
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

  it("does not clobber a user's in-progress edit when the initial* props are re-rendered unchanged (no infinite re-seed loop)", () => {
    const { rerender } = renderForm({ initialSeedHex: "#2563eb" });
    const hexInput = screen.getByLabelText(/brand colour/i) as HTMLInputElement;

    fireEvent.change(hexInput, { target: { value: "#123abc" } });
    expect(hexInput.value).toBe("#123abc");

    // Re-render with the SAME initial* props the component already has —
    // `prevInitialSeedHex === initialSeedHex` on this render, so the
    // render-time-adjust `if` guard does not fire and setSeedHex is never
    // called. The user's in-progress edit must survive this re-render;
    // if the guard were unconditional (or keyed on the wrong condition),
    // this would clobber the dirty value back to "#2563eb".
    rerender(
      <BrandingForm
        slug="alder-creek"
        organizationName="Invented Fixture Congregation"
        initialSeedHex="#2563eb"
        initialTypePairing="classic"
        initialMarkSrc={null}
        initialLightOnly={false}
      />,
    );

    expect(hexInput.value).toBe("#123abc");
  });
});

describe("BrandingForm — the save banner survives a post-save prop refresh (Phase 5 Finding 1 regression, docs/work-log/2026-09-26-lint-gate.md)", () => {
  it("keeps the green 'Brand saved.' banner visible after the component re-renders with new initial* props following a successful save", async () => {
    setOrgBrandAction.mockResolvedValue({ ok: true });
    const { rerender } = render(
      <BrandingForm
        slug="alder-creek"
        organizationName="Invented Fixture Congregation"
        initialSeedHex="#2563eb"
        initialTypePairing="classic"
        initialMarkSrc={null}
        initialLightOnly={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(screen.getByText("Brand saved.")).toBeTruthy();

    // The real page re-renders this SAME component with fresh initial*
    // props once revalidatePath() resolves. A key-forced remount here would
    // reset useActionState's `result` to null and silently drop the banner
    // — this is the exact failure a browser-only check would have missed
    // and a rerender()-with-a-different-key test could not catch (it would
    // pass "successfully" against the very defect it should have caught).
    rerender(
      <BrandingForm
        slug="alder-creek"
        organizationName="Invented Fixture Congregation"
        initialSeedHex="#2563eb"
        initialTypePairing="classic"
        initialMarkSrc={null}
        initialLightOnly={false}
      />,
    );

    expect(screen.getByText("Brand saved.")).toBeTruthy();
  });

  it("keeps the amber partial-save banner visible after the same post-save prop refresh (E-c2)", async () => {
    const partialError =
      "Colour and type pairing saved. The logo could not be saved.";
    setOrgBrandAction.mockResolvedValue({ ok: false, error: partialError });
    const { rerender } = render(
      <BrandingForm
        slug="alder-creek"
        organizationName="Invented Fixture Congregation"
        initialSeedHex="#2563eb"
        initialTypePairing="classic"
        initialMarkSrc={null}
        initialLightOnly={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    expect(screen.getByText(partialError)).toBeTruthy();

    rerender(
      <BrandingForm
        slug="alder-creek"
        organizationName="Invented Fixture Congregation"
        initialSeedHex="#2563eb"
        initialTypePairing="classic"
        initialMarkSrc={null}
        initialLightOnly={false}
      />,
    );

    expect(screen.getByText(partialError)).toBeTruthy();
  });
});

describe("BrandingForm — unsaved-changes guard (H3)", () => {
  it("intercepts a same-origin link click (standing in for the admin shell's 'Back to portal') once the colour is dirtied", () => {
    render(
      <div>
        <Link href="/o/alder-creek">Back to portal</Link>
        <BrandingForm
          slug="alder-creek"
          organizationName="Invented Fixture Congregation"
          initialSeedHex="#2563eb"
          initialTypePairing="classic"
          initialMarkSrc={null}
          initialLightOnly={false}
        />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/brand colour/i), {
      target: { value: "#7a1f2b" },
    });
    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek");
  });

  it("does not intercept the link when nothing has changed from the initial brand", () => {
    render(
      <div>
        <Link href="/o/alder-creek">Back to portal</Link>
        <BrandingForm
          slug="alder-creek"
          organizationName="Invented Fixture Congregation"
          initialSeedHex="#2563eb"
          initialTypePairing="classic"
          initialMarkSrc={null}
          initialLightOnly={false}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("selecting a logo file also dirties the form", () => {
    render(
      <div>
        <Link href="/o/alder-creek">Back to portal</Link>
        <BrandingForm
          slug="alder-creek"
          organizationName="Invented Fixture Congregation"
          initialSeedHex="#2563eb"
          initialTypePairing="classic"
          initialMarkSrc={null}
          initialLightOnly={false}
        />
      </div>,
    );

    const file = new File(["logo-bytes"], "logo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/logo \(optional\)/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
  });

  it("becomes clean again once the post-save prop re-sync lands (the same render-time-adjust mechanism the staleness-bug-fix test above simulates)", async () => {
    setOrgBrandAction.mockResolvedValue({ ok: true });
    const { rerender } = render(
      <div>
        <Link href="/o/alder-creek">Back to portal</Link>
        <BrandingForm
          slug="alder-creek"
          organizationName="Invented Fixture Congregation"
          initialSeedHex="#2563eb"
          initialTypePairing="classic"
          initialMarkSrc={null}
          initialLightOnly={false}
        />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/brand colour/i), {
      target: { value: "#7a1f2b" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save brand/i }));
    });

    // Next re-renders this component with fresh `initial*` props once the
    // Server Action's own `revalidatePath()` resolves — the SAME component
    // instance (no key, no remount), simulated here explicitly since this
    // unit test has no real Server Component tree to re-fetch from. The
    // render-time-adjust blocks in branding-form.tsx pick this up and reset
    // `seedHex` to the new "clean" value, so the form is no longer dirty.
    rerender(
      <div>
        <Link href="/o/alder-creek">Back to portal</Link>
        <BrandingForm
          slug="alder-creek"
          organizationName="Invented Fixture Congregation"
          initialSeedHex="#7a1f2b"
          initialTypePairing="classic"
          initialMarkSrc={null}
          initialLightOnly={false}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });
});

describe("BrandingForm — logo file input styling (L2)", () => {
  it("styles the file input's selector-button pseudo-element to match the form's other controls", () => {
    renderForm();
    const logoInput = screen.getByLabelText(/logo \(optional\)/i);
    expect(logoInput.className).toMatch(/file:rounded-md/);
    expect(logoInput.className).toMatch(/file:border/);
    expect(logoInput.className).toMatch(/file:bg-background/);
  });
});
