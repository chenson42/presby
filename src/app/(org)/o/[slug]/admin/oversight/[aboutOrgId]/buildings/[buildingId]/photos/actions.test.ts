/**
 * Orchestration tests for the building photo Server Actions (docs/work-log/
 * 2026-11-17-congregation-profile-inc2.md, B5; Copy C14). Mocked at the
 * `photo-store` boundary: the key check, the toggle, the type, the cap, the lock
 * and the audit row are proven by `photo-store.unit.test.ts` and
 * `photo-store.db.test.ts`. What this pins is the plumbing, in the order the
 * design gives: a signed-out or second-factor-stale caller and an unresolvable
 * slug are refused before anything else; every id is a UUID or the one
 * not-found string, before the store is reached; the upload's size and shape are
 * refused before its bytes are read; the caption is parsed before any
 * transaction; each store refusal is mapped to its ONE fixed C14 string; success
 * revalidates the three pages; and no action takes an organization id, redirects,
 * or touches the database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoRefusal } from "@/lib/oversight/contract";
import { GATE_COPY, PHOTO_REFUSAL, REFUSAL } from "@/lib/oversight/copy";
import { UPLOAD_MAX_BYTES } from "@/lib/storage/image/limits";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({ resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args) }));

const store = vi.hoisted(() => ({
  addPhoto: vi.fn(),
  setPhotoCaption: vi.fn(),
  setPhotoCover: vi.fn(),
  removePhoto: vi.fn(),
}));
vi.mock("@/lib/oversight/photo-store", () => store);

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args) }));

import { addBuildingPhotoAction, removePhotoAction, setPhotoCaptionAction, setPhotoCoverAction } from "./actions";

const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "actor-1",
    name: "Scioto Hills Presbytery",
    organizationType: "presbytery" as const,
    slug: "scioto-hills",
    platformStatus: "managed" as const,
  },
};
const SLUG = "scioto-hills";
const ABOUT = "00000000-0000-4000-8000-0000000000a1";
const BUILDING = "00000000-0000-4000-8000-0000000000b1";
const PHOTO = "00000000-0000-4000-8000-0000000000c1";

const formWith = (bytes: Buffer | null, name = "photo"): FormData => {
  const form = new FormData();
  if (bytes) form.set(name, new File([new Uint8Array(bytes)], "whatever-name.jpg", { type: "image/jpeg" }));
  return form;
};
const JPEGISH = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

beforeEach(() => {
  mockAuth.mockResolvedValue(SESSION);
  mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
});
afterEach(() => {
  vi.clearAllMocks();
});

const noStoreCalled = () => {
  for (const fn of Object.values(store)) expect(fn).not.toHaveBeenCalled();
  expect(mockRevalidatePath).not.toHaveBeenCalled();
};

const calls: Array<[string, () => Promise<unknown>]> = [
  ["addBuildingPhotoAction", () => addBuildingPhotoAction(SLUG, ABOUT, BUILDING, formWith(JPEGISH))],
  ["setPhotoCaptionAction", () => setPhotoCaptionAction(SLUG, ABOUT, BUILDING, PHOTO, { caption: "Front steps" })],
  ["setPhotoCoverAction", () => setPhotoCoverAction(SLUG, ABOUT, BUILDING, PHOTO)],
  ["removePhotoAction", () => removePhotoAction(SLUG, ABOUT, BUILDING, PHOTO)],
];

describe("every action: authenticate, then resolve the organization, before anything else", () => {
  it.each(calls)("%s: signed out is refused, and nothing is resolved or written", async (_name, call) => {
    mockAuth.mockResolvedValue(null);
    expect(await call()).toEqual({ ok: false, error: GATE_COPY.signedOut, kind: "unauthenticated" });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    noStoreCalled();
  });

  it.each(calls)("%s: a session whose second factor is required and unverified is refused before the organization is resolved", async (_name, call) => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", twoFactorRequired: true, twoFactorVerified: false } });
    expect(await call()).toEqual({ ok: false, error: GATE_COPY.signedOut, kind: "two_factor_required" });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    noStoreCalled();
  });

  it.each(calls)("%s: a slug the user has no membership in is refused with the organization string", async (_name, call) => {
    mockResolveOrgContext.mockResolvedValue({ kind: "forbidden" });
    expect(await call()).toEqual({ ok: false, error: GATE_COPY.noAccess, kind: "forbidden" });
    noStoreCalled();
  });

  it.each(calls)("%s: the organization comes from the resolution of the slug and the session, never from the request", async (_name, call) => {
    store.addPhoto.mockResolvedValue({ kind: "refused", reason: "cap_reached" });
    store.setPhotoCaption.mockResolvedValue({ kind: "refused", reason: "not_found" });
    store.setPhotoCover.mockResolvedValue({ kind: "refused", reason: "not_found" });
    store.removePhoto.mockResolvedValue({ kind: "refused", reason: "not_found" });
    await call();
    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-1", SLUG);
    const used = Object.values(store).find((fn) => fn.mock.calls.length > 0)!;
    expect(used.mock.calls[0]![0]).toMatchObject({ organizationId: "org-1", personId: "actor-1", actor: { userId: "user-1" } });
  });
});

describe("every id is a UUID, or the one not-found string, before the store is reached", () => {
  const bad = ["", "not-a-uuid", "00000000-0000-4000-8000-00000000000", "'; drop table x; --"];
  it.each(bad)("a malformed id %j is refused by every action", async (id) => {
    const results = [
      await addBuildingPhotoAction(SLUG, id, BUILDING, formWith(JPEGISH)),
      await addBuildingPhotoAction(SLUG, ABOUT, id, formWith(JPEGISH)),
      await setPhotoCaptionAction(SLUG, ABOUT, BUILDING, id, { caption: "x" }),
      await setPhotoCoverAction(SLUG, ABOUT, id, PHOTO),
      await removePhotoAction(SLUG, id, BUILDING, PHOTO),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, error: REFUSAL.not_found, kind: "not_found" });
    noStoreCalled();
  });
});

describe("addBuildingPhotoAction: the file is judged by its handle before it is read", () => {
  it("no photo field, a field that is not a file, and an empty file are `empty`", async () => {
    for (const form of [formWith(null), formWith(JPEGISH, "other")]) {
      expect(await addBuildingPhotoAction(SLUG, ABOUT, BUILDING, form)).toEqual({ ok: false, error: PHOTO_REFUSAL.empty, kind: "empty" });
    }
    const textual = new FormData();
    textual.set("photo", "just a string");
    expect(await addBuildingPhotoAction(SLUG, ABOUT, BUILDING, textual)).toEqual({ ok: false, error: PHOTO_REFUSAL.empty, kind: "empty" });
    expect(await addBuildingPhotoAction(SLUG, ABOUT, BUILDING, formWith(Buffer.alloc(0)))).toEqual({ ok: false, error: PHOTO_REFUSAL.empty, kind: "empty" });
    noStoreCalled();
  });

  it("a file over the server ceiling is `too_large` without reading its bytes", async () => {
    const form = formWith(Buffer.alloc(UPLOAD_MAX_BYTES + 1, 1));
    const file = form.get("photo") as File;
    const spy = vi.spyOn(file, "arrayBuffer");
    expect(await addBuildingPhotoAction(SLUG, ABOUT, BUILDING, form)).toEqual({ ok: false, error: PHOTO_REFUSAL.too_large, kind: "too_large" });
    expect(spy).not.toHaveBeenCalled();
    noStoreCalled();
  });

  it("a file at exactly the ceiling reaches the store, with the bytes and the resolved context (the filename and type are never read)", async () => {
    store.addPhoto.mockResolvedValue({ kind: "ok", data: { id: PHOTO, cover: true } });
    const bytes = Buffer.alloc(UPLOAD_MAX_BYTES, 3);
    const result = await addBuildingPhotoAction(SLUG, ABOUT, BUILDING, formWith(bytes));
    expect(result).toEqual({ ok: true, data: { id: PHOTO, cover: true } });
    const [ctx, about, building, file] = store.addPhoto.mock.calls[0]!;
    expect(ctx).toMatchObject({ organizationId: "org-1" });
    expect([about, building]).toEqual([ABOUT, BUILDING]);
    expect(Buffer.isBuffer(file) && file.byteLength).toBe(UPLOAD_MAX_BYTES);
  });
});

describe("setPhotoCaptionAction: the caption is parsed before any transaction", () => {
  it("a caption over 200 characters is `invalid` on the caption field, with the Copy string, and the store is not reached", async () => {
    expect(await setPhotoCaptionAction(SLUG, ABOUT, BUILDING, PHOTO, { caption: "a".repeat(201) })).toEqual({
      ok: false,
      error: "Caption must be 200 characters or fewer.",
      field: "caption",
      kind: "invalid",
    });
    noStoreCalled();
  });

  it("passes the cleaned caption, and null for an empty one", async () => {
    store.setPhotoCaption.mockResolvedValue({ kind: "ok", data: { id: PHOTO } });
    await setPhotoCaptionAction(SLUG, ABOUT, BUILDING, PHOTO, { caption: "  front \n steps  " });
    expect(store.setPhotoCaption.mock.calls[0]![4]).toBe("front steps");
    await setPhotoCaptionAction(SLUG, ABOUT, BUILDING, PHOTO, { caption: "   " });
    expect(store.setPhotoCaption.mock.calls[1]![4]).toBeNull();
  });
});

describe("each store refusal maps to its one fixed C14 string, never database text", () => {
  const kinds = Object.keys(PHOTO_REFUSAL) as PhotoRefusal[];
  it.each(kinds)("%s", async (reason) => {
    store.addPhoto.mockResolvedValue({ kind: "refused", reason });
    store.setPhotoCover.mockResolvedValue({ kind: "refused", reason });
    expect(await addBuildingPhotoAction(SLUG, ABOUT, BUILDING, formWith(JPEGISH))).toEqual({ ok: false, error: PHOTO_REFUSAL[reason], kind: reason });
    expect(await setPhotoCoverAction(SLUG, ABOUT, BUILDING, PHOTO)).toEqual({ ok: false, error: PHOTO_REFUSAL[reason], kind: reason });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("success", () => {
  it("revalidates the record page, the building page and the photos page", async () => {
    store.removePhoto.mockResolvedValue({ kind: "ok", data: { id: PHOTO } });
    expect(await removePhotoAction(SLUG, ABOUT, BUILDING, PHOTO)).toEqual({ ok: true, data: { id: PHOTO } });
    const record = `/o/scioto-hills/admin/oversight/${ABOUT}`;
    expect(mockRevalidatePath.mock.calls.map((c) => c[0]).sort()).toEqual(
      [record, `${record}/buildings/${BUILDING}`, `${record}/buildings/${BUILDING}/photos`].sort(),
    );
  });

  it("an unchanged write (same caption, already the cover) is ok and revalidates nothing", async () => {
    store.setPhotoCover.mockResolvedValue({ kind: "ok", data: { id: PHOTO, unchanged: true } });
    expect(await setPhotoCoverAction(SLUG, ABOUT, BUILDING, PHOTO)).toEqual({ ok: true, data: { id: PHOTO, unchanged: true } });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});

describe("the file itself", () => {
  const source = readFileSync(path.join(__dirname, "actions.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("is a 'use server' module that holds no database call, no redirect, no audit write and no organization parameter", () => {
    expect(source.startsWith('"use server";')).toBe(true);
    expect(code).not.toMatch(/\bdb\.|\bgetPlatformDb\b|\bwithOrgContext\b|\binsertAuditRow\b|\brecordAudit\b/);
    expect(code).not.toMatch(/\bredirect\(/);
    for (const m of code.matchAll(/export async function (\w+)\s*\(([^)]*)\)/g)) expect(m[2]).not.toMatch(/\borganizationId\b/);
  });
});
