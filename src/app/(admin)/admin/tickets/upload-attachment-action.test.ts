/**
 * Tests for `uploadTicketAttachmentAction` — the store-then-reply flow's
 * first call (see the module's own header). Mocked at the `@/auth`,
 * `@/lib/storage/blob-store`, and `@/lib/storage/sniff` boundaries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// This module (and @/lib/permissions, transitively) is `import "server-only"`.
vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockSniff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/sniff", () => ({
  sniffTicketAttachmentContentType: (...args: unknown[]) => mockSniff(...args),
}));

const mockStore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/blob-store", () => {
  class MockBlobValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "BlobValidationError";
    }
  }
  return {
    getBlobStore: () => ({ store: mockStore }),
    BlobValidationError: MockBlobValidationError,
  };
});

import { uploadTicketAttachmentAction } from "./upload-attachment-action";
import { BlobValidationError } from "@/lib/storage/blob-store";

afterEach(() => {
  mockAuth.mockReset();
  mockSniff.mockReset();
  mockStore.mockReset();
});

const OPERATOR_SESSION = {
  user: { id: "operator-1", features: ["admin.tickets"] },
};

function fileFormData(bytes: string, name = "photo.png") {
  const fd = new FormData();
  fd.set("attachment", new File([bytes], name, { type: "image/png" }));
  return fd;
}

describe("uploadTicketAttachmentAction — auth gate", () => {
  it("returns a plain error when not signed in", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await uploadTicketAttachmentAction("org-1", fileFormData("bytes"));
    expect(result).toEqual({ ok: false, error: "Not signed in." });
    expect(mockStore).not.toHaveBeenCalled();
  });

  it("returns Forbidden when the session lacks admin.tickets", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", features: [] } });
    const result = await uploadTicketAttachmentAction("org-1", fileFormData("bytes"));
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockStore).not.toHaveBeenCalled();
  });
});

describe("uploadTicketAttachmentAction — validation", () => {
  it("rejects when no file is present", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    const result = await uploadTicketAttachmentAction("org-1", new FormData());
    expect(result).toEqual({ ok: false, error: "No file selected." });
  });

  it("rejects a file the sniffer doesn't recognize, before ever calling store()", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    mockSniff.mockReturnValue(null);
    const result = await uploadTicketAttachmentAction("org-1", fileFormData("bytes"));
    expect(result).toEqual({
      ok: false,
      error: "That file isn't a PNG, JPEG, WEBP, or PDF we can accept.",
    });
    expect(mockStore).not.toHaveBeenCalled();
  });
});

describe("uploadTicketAttachmentAction — success and store() failure", () => {
  it("returns the stored key on success", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    mockSniff.mockReturnValue("image/png");
    mockStore.mockResolvedValue({ key: "blob-1", contentType: "image/png", byteSize: 5 });

    const result = await uploadTicketAttachmentAction("org-1", fileFormData("bytes"));

    expect(mockStore).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", contentType: "image/png" }),
    );
    expect(result).toEqual({ ok: true, data: { key: "blob-1" } });
  });

  it("surfaces a BlobValidationError's own message", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    mockSniff.mockReturnValue("image/png");
    mockStore.mockRejectedValue(new BlobValidationError("too large"));

    const result = await uploadTicketAttachmentAction("org-1", fileFormData("bytes"));

    expect(result).toEqual({ ok: false, error: "too large" });
  });

  it("returns a generic message for any other store() failure", async () => {
    mockAuth.mockResolvedValue(OPERATOR_SESSION);
    mockSniff.mockReturnValue("image/png");
    mockStore.mockRejectedValue(new Error("connection reset"));

    const result = await uploadTicketAttachmentAction("org-1", fileFormData("bytes"));

    expect(result).toEqual({
      ok: false,
      error: "We couldn't store that attachment right now — try again in a moment.",
    });
  });
});
