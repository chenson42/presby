/**
 * `POST /o/<slug>/reimbursements/<id>/receipts` (docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 API Contract Layer 4; EC41, EC42). The route's own properties,
 * with the gate's collaborators, the receipt library and the rate limiter mocked and
 * the REAL sniff, parse and sanitizer behind it (so what reaches `store()` is the
 * actual re-encoded JPEG): the order of refusals (nothing is read or stored before
 * the step that could refuse it), JSON answers a form can read, Origin, the
 * declared and the counted size, one file part only, the sniff by content, the
 * re-encode, the PDF pass-through, the hash of the bytes as received, and the
 * revision in the response.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/auth/cached-auth", () => ({ cachedAuth: mockAuth }));
const resolveOrgContext = vi.hoisted(() => vi.fn());
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...a: unknown[]) => resolveOrgContext(...a), OrgAccessError }));
const loadContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/reimbursement/access", () => ({ loadReimbursementContext: (...a: unknown[]) => loadContext(...a) }));
const receipts = vi.hoisted(() => ({ preflightReceipt: vi.fn(), storeAndAttachReceipt: vi.fn() }));
vi.mock("@/lib/reimbursement/receipts", () => receipts);
const checkRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));

import { MAX_RECEIPT_BODY_BYTES, MAX_RECEIPT_BYTES, MAX_RECEIPT_UPLOADS_PER_HOUR } from "@/lib/reimbursement/limits";
import { POST } from "./route";

const ORIGIN = "https://app.example.invalid";
const ID = "11111111-1111-4111-8111-111111111111";
const ATT = "55555555-5555-4555-8555-555555555555";
const OK_ORG = {
  kind: "ok" as const,
  org: { personId: "person-1", organizationId: "org-1", organizationType: "congregation" as const, name: "Alder Creek Church", slug: "alder-creek" },
};
const has = { requestForOthers: false, view: false, pay: false, manage: false };

const RECEIPT = { attachmentId: ATT, displayName: "Hardware store.jpg", byteSize: 2222, contentType: "image/jpeg", revision: 5 };

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 10, g: 120, b: 220 } } }).png().toBuffer();
}

function form(file: Buffer | Uint8Array | null, name = "Hardware store.png", type = "image/png", extra: Record<string, string | Blob> = {}) {
  const fd = new FormData();
  if (file) fd.append("file", new File([new Uint8Array(file)], name, { type }));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fd;
}

function post(body: BodyInit | null, headers: Record<string, string> = { origin: ORIGIN }, id = ID) {
  return POST(new Request(`${ORIGIN}/o/alder-creek/reimbursements/${id}/receipts`, { method: "POST", body, headers }), {
    params: Promise.resolve({ slug: "alder-creek", id }),
  });
}

function allowed() {
  mockAuth.mockResolvedValue({ user: { id: "user-1", email: "pat@example.invalid", twoFactorRequired: false } });
  resolveOrgContext.mockResolvedValue(OK_ORG);
  loadContext.mockResolvedValue({ kind: "ok", has });
  checkRateLimit.mockResolvedValue({ allowed: true });
  receipts.preflightReceipt.mockResolvedValue({ kind: "ok", liveCount: 0 });
  receipts.storeAndAttachReceipt.mockResolvedValue({ kind: "ok", receipt: RECEIPT });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const mock of [mockAuth, resolveOrgContext, loadContext, checkRateLimit, ...Object.values(receipts)]) mock.mockReset();
});

const nothingTouched = () => {
  expect(receipts.preflightReceipt).not.toHaveBeenCalled();
  expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
};

describe("the gate answers JSON the form can read", () => {
  it("signed out: 401 with the signed-out sentence, nothing else called", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await post(form(await png()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ kind: "refused", error: "You must be signed in to do that." });
    expect(resolveOrgContext).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("2FA required and unverified: 403 two_factor_required, returning to the request's EDIT page (this route has no page)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    const res = await post(form(await png()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      kind: "two_factor_required",
      redirectTo: `/totp?callbackUrl=${encodeURIComponent(`/o/alder-creek/reimbursements/${ID}/edit`)}`,
    });
    expect(resolveOrgContext).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("no such organization: 404 not_found; no relationship or an ended one: 403 with ONE body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue({ kind: "not-found" });
    const miss = await post(form(await png()));
    expect(miss.status).toBe(404);
    expect(await miss.json()).toEqual({ kind: "not_found" });
    const bodies = new Set<string>();
    for (const kind of ["forbidden", "ended"]) {
      resolveOrgContext.mockResolvedValue({ kind });
      const res = await post(form(await png()));
      expect(res.status).toBe(403);
      bodies.add(JSON.stringify(await res.json()));
    }
    expect(bodies.size).toBe(1);
    nothingTouched();
  });

  it("toggle off or not applicable: 404, nothing stored", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    for (const ctx of [{ kind: "toggle_off", canManageFeatures: true }, { kind: "not_applicable" }]) {
      loadContext.mockResolvedValue(ctx);
      expect((await post(form(await png()))).status).toBe(404);
    }
    nothingTouched();
  });

  it("a failure to read the gate is 503 failed, never a refusal that reads as 'not allowed'", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    resolveOrgContext.mockResolvedValue(OK_ORG);
    loadContext.mockRejectedValue(new Error("connection reset"));
    const res = await post(form(await png()));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ kind: "failed" });
  });
});

describe("Origin", () => {
  it.each([
    ["missing", {}],
    ["foreign", { origin: "https://evil.example.invalid" }],
    ["a near miss", { origin: `${ORIGIN}.evil.example.invalid` }],
  ])("%s Origin is a 403 before the rate limit, the preflight or any byte is read", async (_name, headers) => {
    allowed();
    const res = await post(form(await png()), headers as Record<string, string>);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ kind: "refused", error: "You don't have permission to do that." });
    expect(checkRateLimit).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("an unknown platform origin (a misconfigured production) refuses every upload", async () => {
    allowed();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect((await post(form(await png()))).status).toBe(403);
    nothingTouched();
  });
});

describe("before the file is read", () => {
  it("a malformed request id is a 404", async () => {
    allowed();
    const res = await post(form(await png()), { origin: ORIGIN }, "not-a-uuid");
    expect(res.status).toBe(404);
    nothingTouched();
  });

  it("the rate limit is per user, per hour, and answers 429 with Retry-After", async () => {
    allowed();
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 900 });
    const res = await post(form(await png()));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("900");
    expect(await res.json()).toEqual({ kind: "rate_limited" });
    const [key, limit, context] = checkRateLimit.mock.calls[0]!;
    expect(key).toBe("reimbursement-receipt:user-1");
    expect(limit).toEqual({ max: MAX_RECEIPT_UPLOADS_PER_HOUR, windowSeconds: 3600 });
    expect(MAX_RECEIPT_UPLOADS_PER_HOUR).toBe(40);
    expect(context).toMatchObject({ userId: "user-1" });
    nothingTouched();
  });

  it("a declared Content-Length over the cap is refused unread, before the preflight", async () => {
    allowed();
    const res = await post(form(await png()), { origin: ORIGIN, "content-length": String(MAX_RECEIPT_BODY_BYTES + 1) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ kind: "too_large" });
    nothingTouched();
  });

  it.each([
    ["not_found", 404, "not_found"],
    ["not_editable", 409, "not_editable"],
    ["too_many_receipts", 409, "too_many"],
  ])("the preflight says %s: %i %s, and nothing is read or stored (an oversized body behind it is never counted)", async (outcome, status, kind) => {
    allowed();
    receipts.preflightReceipt.mockResolvedValue({ kind: "refused", outcome });
    const res = await post(form(Buffer.alloc(MAX_RECEIPT_BODY_BYTES + 100), "huge.png"));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ kind });
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });

  it("an identity refusal from the preflight is 403", async () => {
    allowed();
    receipts.preflightReceipt.mockResolvedValue({ kind: "denied" });
    const res = await post(form(await png()));
    expect(res.status).toBe(403);
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });

  it("the preflight is asked as the signed-in user, from the gate, for the id in the path", async () => {
    allowed();
    await post(form(await png()));
    const [actor, requestId] = receipts.preflightReceipt.mock.calls[0]!;
    expect(actor).toMatchObject({ userId: "user-1", personId: "person-1", organizationId: "org-1" });
    expect(requestId).toBe(ID);
  });
});

describe("the body", () => {
  it("counts the bytes as they arrive: a chunked body with no Content-Length over the cap is 413 and nothing is stored", async () => {
    allowed();
    const chunk = Buffer.alloc(100_000);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
        if (sent > 20_000_000) controller.close();
      },
    });
    const req = new Request(`${ORIGIN}/o/alder-creek/reimbursements/${ID}/receipts`, {
      method: "POST",
      body: stream,
      headers: { origin: ORIGIN, "content-type": "multipart/form-data; boundary=xyz" },
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req, { params: Promise.resolve({ slug: "alder-creek", id: ID }) });
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(MAX_RECEIPT_BODY_BYTES + 1_000_000);
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });

  it("an empty body, a non-multipart body, two files, a stray field and a differently named part are all not_allowed", async () => {
    allowed();
    const pngBytes = await png();
    const two = form(pngBytes, "a.png");
    two.append("file", new File([new Uint8Array(pngBytes)], "b.png"));
    const cases: BodyInit[] = [
      two,
      form(pngBytes, "a.png", "image/png", { note: "hi" }),
      (() => {
        const fd = new FormData();
        fd.append("attachment", new File([new Uint8Array(pngBytes)], "a.png"));
        return fd;
      })(),
      new Uint8Array(pngBytes),
    ];
    for (const body of cases) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ kind: "not_allowed" });
    }
    expect((await post(null)).status).toBe(400);
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });

  it("sniffs the CONTENT: an SVG, HTML or a script named photo.png and declared image/png is 415 not_allowed", async () => {
    allowed();
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "<!doctype html><script>1</script>", "#!/bin/sh"]) {
      const res = await post(form(Buffer.from(text), "photo.png", "image/png"));
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ kind: "not_allowed" });
    }
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });

  it("a PNG-signature file that will not decode is 422 unreadable", async () => {
    allowed();
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this is not really a png")]);
    const res = await post(form(fake, "scan.png"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ kind: "unreadable" });
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });

  it("a PDF over the receipt cap is 413 too_large (a body that fits the framing but not the file cap)", async () => {
    allowed();
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(MAX_RECEIPT_BYTES)]);
    const res = await post(form(big, "bill.pdf", "application/pdf"));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ kind: "too_large" });
    expect(receipts.storeAndAttachReceipt).not.toHaveBeenCalled();
  });
});

describe("a receipt that goes through", () => {
  it("re-encodes an image as a metadata-free JPEG and stores THAT, hashing the bytes as received", async () => {
    allowed();
    const original = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 10, g: 120, b: 220 } } })
      .jpeg()
      .withExif({ IFD0: { Make: "Invented Camera Co" } })
      .toBuffer();
    expect(original.includes("Invented Camera Co")).toBe(true);
    const res = await post(form(original, "Hardware store.jpeg", "image/jpeg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(RECEIPT);

    const [actor, input] = receipts.storeAndAttachReceipt.mock.calls[0]!;
    expect(actor).toMatchObject({ userId: "user-1", organizationId: "org-1" });
    expect(input.requestId).toBe(ID);
    expect(input.contentType).toBe("image/jpeg");
    expect(input.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(input.bytes.includes("Invented Camera Co")).toBe(false);
    expect(input.bytes.equals(original)).toBe(false);
    expect(input.receivedSha256).toBe(createHash("sha256").update(original).digest("hex"));
    expect(input.displayName).toBe("Hardware store.jpeg");
  });

  it("shows a PNG upload under the extension of what is stored", async () => {
    allowed();
    await post(form(await png(), "Hardware store.png"));
    expect(receipts.storeAndAttachReceipt.mock.calls[0]![1]).toMatchObject({ contentType: "image/jpeg", displayName: "Hardware store.jpg" });
  });

  it("passes a PDF through byte for byte", async () => {
    allowed();
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    const res = await post(form(pdf, "Invoice 4471.pdf", "application/pdf"));
    expect(res.status).toBe(200);
    const input = receipts.storeAndAttachReceipt.mock.calls[0]![1];
    expect(input.bytes.equals(pdf)).toBe(true);
    expect(input.contentType).toBe("application/pdf");
    expect(input.receivedSha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(input.displayName).toBe("Invoice 4471.pdf");
  });

  it("answers the attach's own fields including the request's new revision", async () => {
    allowed();
    const body = (await (await post(form(await png()))).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["attachmentId", "byteSize", "contentType", "displayName", "revision"]);
    expect(body.revision).toBe(5);
  });

  it("a request id in the file's name or fields cannot redirect the upload: the id is the path's", async () => {
    allowed();
    await post(form(await png(), `${ATT}/../../x.png`));
    expect(receipts.storeAndAttachReceipt.mock.calls[0]![1].requestId).toBe(ID);
    expect(receipts.storeAndAttachReceipt.mock.calls[0]![1].displayName).not.toMatch(/[\\/]/);
  });
});

describe("what attach can refuse", () => {
  it.each([
    ["not_found", 404, "not_found"],
    ["not_editable", 409, "not_editable"],
    ["too_many_receipts", 409, "too_many"],
    ["duplicate_in_request", 409, "duplicate"],
    // A refusal the member did not cause: the key, type and size came from the store itself.
    ["invalid_shape", 500, "failed"],
  ])("%s is %i %s", async (outcome, status, kind) => {
    allowed();
    receipts.storeAndAttachReceipt.mockResolvedValue({ kind: "refused", outcome });
    const res = await post(form(await png()));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ kind });
  });

  it("an identity refusal is 403", async () => {
    allowed();
    receipts.storeAndAttachReceipt.mockResolvedValue({ kind: "denied" });
    expect((await post(form(await png()))).status).toBe(403);
  });

  it("a storage or database failure is 503 failed with nothing in the body, and the log names only the error class", async () => {
    allowed();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    receipts.storeAndAttachReceipt.mockRejectedValue(Object.assign(new Error('insert into blob_assets values ("Hardware store.jpg" ...)'), { name: "PostgresError" }));
    const res = await post(form(await png(), "Hardware store.png"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ kind: "failed" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("PostgresError");
    expect(logged).not.toContain("Hardware store");
    expect(logged).not.toContain("blob_assets");
  });

  it("an org-access error mid-request is 403, not 503", async () => {
    allowed();
    receipts.preflightReceipt.mockRejectedValue(new OrgAccessError("gone"));
    const res = await post(form(await png()));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ kind: "refused", error: "You don't have access to that organization." });
  });
});
