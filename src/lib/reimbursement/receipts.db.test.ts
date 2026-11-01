/**
 * receipts.ts against a REAL Postgres connection, through the application's own path
 * (`withOrgContext` on presby_app, RLS enforced) and the REAL blob store -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Receipts and the F289 audience
 * API", EC41 and the Batch 1b handoff ("What Batch 2b must know"). Proves: the
 * preflight, store-then-attach with the STORED type and size, the revision that
 * comes back, the hash of the bytes as received, dedup, soft detach (the blob and
 * the row stay), who may look a receipt up, the audit row for a view by anyone but
 * the uploader, and that a `private` read cannot reach a `public_site` row. Run with:
 *   npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/reimbursement/receipts.db.test.ts
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ReimbursementFixture } from "@/lib/testing/reimbursement-fixture";
import type { RequestActor } from "./requests";

vi.mock("server-only", () => ({}));
// the audit helper reads request headers for the ip and user agent; there is no request here
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.setConfig({ testTimeout: 180_000, hookTimeout: 300_000 });

const hasDb = Boolean(process.env.DATABASE_URL && process.env.PLATFORM_DATABASE_URL);
const ALL_KEYS = ["reimbursement.request_for_others", "reimbursement.view", "reimbursement.pay", "reimbursement.manage"];

/** A synthetic JPEG: the signature and some unique bytes (the store checks the declared type, not the picture). */
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(48)]);
const pdf = () => Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(48)]);
const sha = () => randomBytes(32).toString("hex");

describe.skipIf(!hasDb)("receipts.ts (Postgres-backed)", () => {
  let fx: ReimbursementFixture;
  let requests: typeof import("./requests");
  let receipts: typeof import("./receipts");
  let input: typeof import("./input");
  let reads: typeof import("./reads");
  let blobStore: typeof import("@/lib/storage/blob-store");

  let A: string;
  let B: string;
  let committee: string;
  let today: string;
  let requester: RequestActor;
  let chair: RequestActor;
  let treasurer: RequestActor;
  let plain: RequestActor;
  let outsider: RequestActor;
  let keySeq = 0;
  const nextKey = () => `rk${Date.now().toString(36)}${(keySeq += 1)}`.padEnd(10, "x");

  const actor = (org: string, m: { userId: string; personId: string }): RequestActor => ({
    userId: m.userId,
    email: `${m.userId}@example.invalid`,
    personId: m.personId,
    organizationId: org,
  });

  async function draft(who: RequestActor = requester): Promise<string> {
    const saved = await requests.saveRequest(
      who,
      input.saveRequestSchema.parse({
        clientKey: nextKey(),
        kind: "reimburse",
        groupId: committee,
        amountCents: 4150,
        expenseDate: today,
        purpose: "Paint for the fellowship hall",
        noReceiptClaimed: false,
      }),
    );
    if (saved.kind !== "ok") throw new Error("setup: draft");
    return saved.requestId;
  }

  async function attach(requestId: string, over: Partial<Parameters<typeof receipts.storeAndAttachReceipt>[1]> = {}, who: RequestActor = requester) {
    return receipts.storeAndAttachReceipt(who, {
      requestId,
      bytes: jpeg(),
      contentType: "image/jpeg",
      receivedSha256: sha(),
      displayName: "Hardware store.jpg",
      ...over,
    });
  }

  const revisionOf = async (requestId: string) => {
    const found = await reads.getRequestDetail(requester, requestId, "member");
    if (found.kind !== "ok") throw new Error("setup: detail");
    return found.detail.revision;
  };

  const auditViews = (requestId: string) =>
    fx.q(sql`select actor_user_id, metadata, resource_type, resource_id from audit_events
              where action = 'tenant.reimbursement.receipt_viewed' and metadata->>'requestId' = ${requestId}
              order by created_at, id`);

  beforeAll(async () => {
    const mod = await import("@/lib/testing/reimbursement-fixture");
    fx = await mod.createReimbursementFixture("rcpts");
    requests = await import("./requests");
    receipts = await import("./receipts");
    input = await import("./input");
    reads = await import("./reads");
    blobStore = await import("@/lib/storage/blob-store");

    A = await fx.makeOrg("main", { timeZone: "America/New_York", toggle: true });
    B = await fx.makeOrg("other", { toggle: true });
    committee = await fx.makeGroup(A, "Finance Committee");
    const r = await fx.member(A, "Requester");
    const ch = await fx.member(A, "Chair");
    const t = await fx.member(A, "Treasurer");
    const p = await fx.member(A, "Plain");
    const o = await fx.member(B, "Outsider");
    requester = actor(A, r);
    chair = actor(A, ch);
    treasurer = actor(A, t);
    plain = actor(A, p);
    outsider = actor(B, o);
    await fx.seat(A, committee, ch.personId, { role: "chair" });
    await fx.grant(A, await fx.makeRole(A, "treasurer_like", ALL_KEYS), t.personId);
    await fx.chargeable(A, committee, t.userId);
    today = await reads.getOrgToday(requester);
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  // =========================================================================
  describe("preflight (before any byte is stored)", () => {
    it("the creator may add to their own draft, and the count starts at zero", async () => {
      const id = await draft();
      expect(await receipts.preflightReceipt(requester, id)).toEqual({ kind: "ok", liveCount: 0 });
    });

    it("another member, a missing id and another organization's member are the same not_found", async () => {
      const id = await draft();
      const missing = "99999999-9999-4999-8999-999999999999";
      const answers = [
        await receipts.preflightReceipt(plain, id),
        await receipts.preflightReceipt(requester, missing),
        await receipts.preflightReceipt(treasurer, id),
      ];
      expect(answers).toEqual(Array(3).fill({ kind: "refused", outcome: "not_found" }));
      // a member of ANOTHER organization names this one's request: the organization is theirs, the request is not
      expect(await receipts.preflightReceipt(outsider, id)).toEqual({ kind: "refused", outcome: "not_found" });
    });

    it("a user with no person at the organization is an identity refusal, not an outcome", async () => {
      const id = await draft();
      const stranger = await fx.makeUser("stranger");
      expect(await receipts.preflightReceipt({ ...requester, userId: stranger }, id)).toEqual({ kind: "denied" });
    });

    it("EC41: five receipts is the cap - the sixth is too_many_receipts, and a detached one frees its place", async () => {
      const id = await draft();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const out = await attach(id, { displayName: `r${i}.jpg` });
        if (out.kind !== "ok") throw new Error(`setup: attach ${i}`);
        ids.push(out.receipt.attachmentId);
      }
      expect(await receipts.preflightReceipt(requester, id)).toEqual({ kind: "refused", outcome: "too_many_receipts" });
      expect(await attach(id)).toEqual({ kind: "refused", outcome: "too_many_receipts" });
      expect(await receipts.detachReceipt(requester, { requestId: id, attachmentId: ids[0]! })).toMatchObject({ kind: "ok" });
      expect(await receipts.preflightReceipt(requester, id)).toEqual({ kind: "ok", liveCount: 4 });
    });

    it("a request that has been sent is not_editable", async () => {
      const id = await draft();
      expect((await attach(id)).kind).toBe("ok");
      const sent = await requests.submitRequest(requester, { requestId: id, expectedRevision: await revisionOf(id) });
      expect(sent.kind).toBe("ok");
      expect(await receipts.preflightReceipt(requester, id)).toEqual({ kind: "refused", outcome: "not_editable" });
      expect(await attach(id)).toEqual({ kind: "refused", outcome: "not_editable" });
    });
  });

  // =========================================================================
  describe("storeAndAttachReceipt", () => {
    it("stores a PRIVATE blob of this organization and attaches the STORED type and size, returning the new revision", async () => {
      const id = await draft();
      const before = await revisionOf(id);
      const bytes = jpeg();
      const received = sha();
      const out = await attach(id, { bytes, receivedSha256: received, displayName: "Hardware store.jpg" });
      expect(out.kind).toBe("ok");
      if (out.kind !== "ok") return;
      expect(out.receipt).toMatchObject({ displayName: "Hardware store.jpg", byteSize: bytes.byteLength, contentType: "image/jpeg" });
      expect(out.receipt.revision).toBe(before + 1);
      expect(await revisionOf(id)).toBe(before + 1);

      const [row] = await fx.q(sql`
        select a.blob_key, a.content_sha256, a.content_type, a.byte_size, a.display_name, a.asset_audience, a.detached_at,
               b.audience, b.organization_id, b.content_type as blob_type, b.byte_size as blob_size
          from reimbursement_attachments a join blob_assets b on b.id = a.blob_key
         where a.id = ${out.receipt.attachmentId}`);
      expect(row).toMatchObject({
        audience: "private",
        asset_audience: "private",
        organization_id: A,
        content_type: "image/jpeg",
        blob_type: "image/jpeg",
        byte_size: bytes.byteLength,
        blob_size: bytes.byteLength,
        content_sha256: received,
        display_name: "Hardware store.jpg",
        detached_at: null,
      });
      // the attachment's hash is of the bytes AS RECEIVED, which is not the blob's own content hash
      const [blobRow] = await fx.q(sql`select content_hash from blob_assets where id = ${String(row!.blob_key)}`);
      expect(String(blobRow!.content_hash)).not.toBe(received);
    });

    it("a PDF is stored as application/pdf", async () => {
      const id = await draft();
      const out = await attach(id, { bytes: pdf(), contentType: "application/pdf", displayName: "Invoice.pdf" });
      expect(out).toMatchObject({ kind: "ok", receipt: { contentType: "application/pdf", displayName: "Invoice.pdf" } });
    });

    it("the same bytes attached twice to ONE request is duplicate_in_request (by the hash as received)", async () => {
      const id = await draft();
      const same = sha();
      expect((await attach(id, { receivedSha256: same })).kind).toBe("ok");
      expect(await attach(id, { receivedSha256: same })).toEqual({ kind: "refused", outcome: "duplicate_in_request" });
    });

    it("the same receipt on two requests is allowed: one shared blob, two attachment rows (the store's dedup)", async () => {
      const bytes = jpeg();
      const first = await attach(await draft(), { bytes });
      const second = await attach(await draft(), { bytes });
      if (first.kind !== "ok" || second.kind !== "ok") throw new Error("setup");
      const rows = await fx.q(sql`
        select blob_key from reimbursement_attachments where id in (${first.receipt.attachmentId}::uuid, ${second.receipt.attachmentId}::uuid)`);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((r) => String(r.blob_key))).size).toBe(1);
    });

    it("a refused attach leaves the unreferenced private blob behind (the recorded residual) and no attachment", async () => {
      const id = await draft();
      const same = sha();
      await attach(id, { receivedSha256: same });
      const bytes = jpeg();
      expect(await attach(id, { bytes, receivedSha256: same })).toEqual({ kind: "refused", outcome: "duplicate_in_request" });
      const stored = await fx.q(sql`
        select b.id, (select count(*)::int from reimbursement_attachments a where a.blob_key = b.id) as refs
          from blob_assets b where b.organization_id = ${A} and b.audience = 'private' and b.byte_size = ${bytes.byteLength}
           and b.content_type = 'image/jpeg' order by b.created_at desc limit 1`);
      expect(stored[0]).toMatchObject({ refs: 0 });
    });

    it("another member cannot attach to this request: not_found (the blob is theirs to have stored, the attachment is refused)", async () => {
      const id = await draft();
      expect(await attach(id, {}, plain)).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await revisionOf(id)).toBe(1);
    });

    it("a display name the definer refuses (a path separator) is invalid_shape, which the route treats as a defect", async () => {
      const id = await draft();
      expect(await attach(id, { displayName: "a/b.jpg" })).toEqual({ kind: "refused", outcome: "invalid_shape" });
    });
  });

  // =========================================================================
  describe("detachReceipt (soft: nothing referenced is ever deleted)", () => {
    it("takes the receipt off, moves the revision by one, and keeps the row and the blob", async () => {
      const id = await draft();
      const out = await attach(id);
      if (out.kind !== "ok") throw new Error("setup");
      const before = await revisionOf(id);
      const detached = await receipts.detachReceipt(requester, { requestId: id, attachmentId: out.receipt.attachmentId });
      expect(detached).toEqual({ kind: "ok", revision: before + 1 });
      const [row] = await fx.q(sql`
        select a.detached_at, a.detached_by_user, (select count(*)::int from blob_assets b where b.id = a.blob_key) as blobs
          from reimbursement_attachments a where a.id = ${out.receipt.attachmentId}`);
      expect(row!.detached_at).not.toBeNull();
      expect(row!.detached_by_user).toBe(requester.userId);
      expect(row!.blobs).toBe(1);
      const detail = await reads.getRequestDetail(requester, id, "member");
      expect(detail.kind === "ok" && detail.detail.receipts).toEqual([]);
    });

    it("a second detach, another member's detach and a missing attachment are the same not_found", async () => {
      const id = await draft();
      const out = await attach(id);
      if (out.kind !== "ok") throw new Error("setup");
      const ask = { requestId: id, attachmentId: out.receipt.attachmentId };
      expect(await receipts.detachReceipt(plain, ask)).toEqual({ kind: "refused", outcome: "not_found" });
      expect((await receipts.detachReceipt(requester, ask)).kind).toBe("ok");
      expect(await receipts.detachReceipt(requester, ask)).toEqual({ kind: "refused", outcome: "not_found" });
      expect(await receipts.detachReceipt(requester, { ...ask, attachmentId: "99999999-9999-4999-8999-999999999999" })).toEqual({
        kind: "refused",
        outcome: "not_found",
      });
    });

    it("after the request is sent, a receipt cannot be taken off (not_editable)", async () => {
      const id = await draft();
      const out = await attach(id);
      if (out.kind !== "ok") throw new Error("setup");
      await requests.submitRequest(requester, { requestId: id, expectedRevision: await revisionOf(id) });
      expect(await receipts.detachReceipt(requester, { requestId: id, attachmentId: out.receipt.attachmentId })).toEqual({
        kind: "refused",
        outcome: "not_editable",
      });
    });
  });

  // =========================================================================
  describe("lookupReceipt and readReceiptBytes", () => {
    let sentRequest: string;
    let attachmentId: string;
    let original: Buffer;

    beforeAll(async () => {
      sentRequest = await draft();
      original = jpeg();
      const out = await attach(sentRequest, { bytes: original, displayName: "Kitchen.jpg" });
      if (out.kind !== "ok") throw new Error("setup: attach");
      attachmentId = out.receipt.attachmentId;
      const sent = await requests.submitRequest(requester, { requestId: sentRequest, expectedRevision: await revisionOf(sentRequest) });
      if (sent.kind !== "ok") throw new Error("setup: submit");
    });

    it("the creator looks it up and reads the bytes back, with no audit row for their own view", async () => {
      const found = await receipts.lookupReceipt(requester, { requestId: sentRequest, attachmentId });
      expect(found).toMatchObject({ kind: "ok", contentType: "image/jpeg", displayName: "Kitchen.jpg" });
      if (found.kind !== "ok") return;
      const blob = await receipts.readReceiptBytes(A, found.blobKey);
      expect(blob?.contentType).toBe("image/jpeg");
      expect(blob?.bytes.equals(original)).toBe(true);
      expect(await auditViews(sentRequest)).toHaveLength(0);
    });

    it("an eligible approver and the treasury team may look it up, and each view writes ONE audit row with ids only", async () => {
      expect((await receipts.lookupReceipt(chair, { requestId: sentRequest, attachmentId })).kind).toBe("ok");
      expect((await receipts.lookupReceipt(treasurer, { requestId: sentRequest, attachmentId })).kind).toBe("ok");
      const rows = await auditViews(sentRequest);
      expect(rows.map((r) => r.actor_user_id)).toEqual([chair.userId, treasurer.userId]);
      for (const row of rows) {
        expect(row.metadata).toEqual({ organizationId: A, requestId: sentRequest, attachmentId });
        expect(row.resource_type).toBe("reimbursement_request");
        expect(row.resource_id).toBe(sentRequest);
      }
    });

    it("a member with no relationship to the request, a missing attachment and another organization's member are the same not_found, with no audit row", async () => {
      const before = (await auditViews(sentRequest)).length;
      const missing = "99999999-9999-4999-8999-999999999999";
      const answers = [
        await receipts.lookupReceipt(plain, { requestId: sentRequest, attachmentId }),
        await receipts.lookupReceipt(requester, { requestId: sentRequest, attachmentId: missing }),
        await receipts.lookupReceipt(outsider, { requestId: sentRequest, attachmentId }),
        await receipts.lookupReceipt(requester, { requestId: missing, attachmentId }),
      ];
      expect(answers).toEqual(Array(4).fill({ kind: "not_found" }));
      expect((await auditViews(sentRequest)).length).toBe(before);
    });

    it("an attachment id from ANOTHER request does not resolve under this one", async () => {
      const otherId = await draft();
      expect(await receipts.lookupReceipt(requester, { requestId: otherId, attachmentId })).toEqual({ kind: "not_found" });
    });

    it("a user with no person at the organization is the same not_found (an identity refusal is not a different answer)", async () => {
      const stranger = await fx.makeUser("stranger2");
      expect(await receipts.lookupReceipt({ ...requester, userId: stranger }, { requestId: sentRequest, attachmentId })).toEqual({ kind: "not_found" });
    });

    it("a detached receipt is no longer served", async () => {
      const id = await draft();
      const out = await attach(id);
      if (out.kind !== "ok") throw new Error("setup");
      expect((await receipts.lookupReceipt(requester, { requestId: id, attachmentId: out.receipt.attachmentId })).kind).toBe("ok");
      await receipts.detachReceipt(requester, { requestId: id, attachmentId: out.receipt.attachmentId });
      expect(await receipts.lookupReceipt(requester, { requestId: id, attachmentId: out.receipt.attachmentId })).toEqual({ kind: "not_found" });
    });

    it("readReceiptBytes reaches only this organization's PRIVATE blobs: a public_site row and another organization's key are null", async () => {
      const store = blobStore.getBlobStore();
      const publicRow = await store.store({
        organizationId: A,
        bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(32)]),
        contentType: "image/jpeg",
        audience: "public_site",
      });
      expect(await receipts.readReceiptBytes(A, publicRow.key)).toBeNull();
      const found = await receipts.lookupReceipt(requester, { requestId: sentRequest, attachmentId });
      if (found.kind !== "ok") throw new Error("setup");
      expect(await receipts.readReceiptBytes(B, found.blobKey)).toBeNull();
      expect(await receipts.readReceiptBytes(A, "99999999-9999-4999-8999-999999999999")).toBeNull();
    });
  });
});
