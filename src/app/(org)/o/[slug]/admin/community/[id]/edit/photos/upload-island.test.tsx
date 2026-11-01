// @vitest-environment jsdom
/**
 * U10 (upload island): Copy C3, the pre-hydration gate, the fixed-copy error
 * mapping (including the framework's 413 and a dropped connection), and that no
 * original filename or raw error text ever reaches the user or the action.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockAdd = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ addPersonPhotoAction: (...args: unknown[]) => mockAdd(...args) }));

const mockDownscale = vi.hoisted(() => vi.fn());
vi.mock("./downscale", async () => {
  const actual = await vi.importActual<typeof import("./downscale")>("./downscale");
  return { ...actual, downscaleToJpeg: (...args: unknown[]) => mockDownscale(...args) };
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { UploadIsland } from "./upload-island";
import { DownscaleError } from "./downscale";
import { REFUSAL_COPY, UPLOAD_COPY, UPLOAD_REJECTED_COPY } from "@/lib/person-photos/copy";

const PREPARED = new File([new Uint8Array(10)], "photo.jpg", { type: "image/jpeg" });

function island(props: Partial<React.ComponentProps<typeof UploadIsland>> = {}) {
  return <UploadIsland slug="alder-creek" personId="p-1" firstName="Nora" {...props} />;
}

function choose(file = new File([new Uint8Array(5)], "Holiday Party.png", { type: "image/png" })) {
  const input = screen.getByLabelText(UPLOAD_COPY.label) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

beforeEach(() => {
  mockDownscale.mockResolvedValue(PREPARED);
  mockAdd.mockResolvedValue({ ok: true, data: { photoId: "ph-1", usedForDirectory: false } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UploadIsland", () => {
  it("renders the label, the helper and a 44px button; the input offers camera and library (no capture attribute)", () => {
    render(island());
    const input = screen.getByLabelText(UPLOAD_COPY.label) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.hasAttribute("capture")).toBe(false);
    expect(input.accept).toBe("image/jpeg,image/png,image/webp,image/heic,image/heif");
    expect(screen.getByText(UPLOAD_COPY.helper)).toBeTruthy();
    expect(screen.getByRole("button", { name: UPLOAD_COPY.button }).className).toContain("min-h-11");
  });

  it("is inoperable before hydration: the server HTML has the input and the button disabled, so an un-downscaled file cannot be posted", () => {
    const html = renderToString(island());
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain('data-slot="hydration-gate"');
  });

  it("is disabled for a person who appears to be under 18", () => {
    render(island({ disabled: true }));
    expect((screen.getByLabelText(UPLOAD_COPY.label) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: UPLOAD_COPY.button }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("downscales, then posts only the prepared file under the field 'photo', never the original name", async () => {
    render(island());
    choose();
    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    const [slug, personId, body] = mockAdd.mock.calls[0] as [string, string, FormData];
    expect([slug, personId]).toEqual(["alder-creek", "p-1"]);
    const sent = body.get("photo") as File;
    expect(sent.name).toBe("photo.jpg");
    expect([...body.keys()]).toEqual(["photo"]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(UPLOAD_COPY.added));
  });

  it("says the photo became the directory photo when the server auto-designated it", async () => {
    mockAdd.mockResolvedValue({ ok: true, data: { photoId: "ph-1", usedForDirectory: true } });
    render(island());
    choose();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(UPLOAD_COPY.addedDirectory("Nora")));
  });

  it("shows the server's fixed refusal string as is", async () => {
    mockAdd.mockResolvedValue({ ok: false, error: REFUSAL_COPY.duplicate("Nora") });
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That picture is already in Nora's photos."));
  });

  it("maps ANY rejection of the action (the framework's 413, a dropped connection) to the fixed string, never the raw error", async () => {
    mockAdd.mockRejectedValue(new Error("Body exceeded 1 MB limit at /secret/path"));
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(UPLOAD_REJECTED_COPY));
    expect(JSON.stringify(toast.error.mock.calls)).not.toMatch(/exceeded|secret/);
  });

  it("a file the browser cannot decode gets the convert-to-JPEG message and never reaches the server", async () => {
    mockDownscale.mockRejectedValue(new DownscaleError("undecodable"));
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_COPY.unsupported_type("Nora")));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("a picture that cannot be made small enough gets the too-big message", async () => {
    mockDownscale.mockRejectedValue(new DownscaleError("too_big"));
    render(island());
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL_COPY.too_large("Nora")));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("shows progress while preparing and uploading, then clears it and the input, so the same file can be chosen again", async () => {
    let finish!: (v: unknown) => void;
    mockAdd.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(island());
    const input = choose();
    expect(screen.getByRole("status").textContent).toBe(UPLOAD_COPY.preparing);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(UPLOAD_COPY.uploading));
    expect(input.disabled).toBe(true);
    finish({ ok: true, data: { photoId: "p", usedForDirectory: false } });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("");
  });
});
