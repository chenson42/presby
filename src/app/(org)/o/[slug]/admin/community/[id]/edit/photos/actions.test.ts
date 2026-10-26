/**
 * U8: orchestration tests for the photos sub-screen's Server Actions
 * (docs/work-log/2026-10-26-person-photos-inc1.md, Phase 3 Test Plan U8).
 * Mocked at the `@/lib/person-photos/store` boundary: the checks and the audit
 * rows are proven against a real Postgres by `store.db.test.ts`. What this pins
 * is the plumbing: unauthenticated and no-org answers, each refusal kind mapped
 * to its ONE fixed string, success revalidating the three pages, ids validated
 * before the store is reached, the website attestation being a boolean `true`,
 * upload size and shape refused before the bytes are read, and no redirect
 * anywhere.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REFUSAL_COPY, REUSED_COPY } from "@/lib/person-photos/copy";
import { UPLOAD_MAX_BYTES } from "@/lib/person-photos/limits";
import type { PhotoRefusal } from "@/lib/person-photos/types";

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const store = vi.hoisted(() => ({
  addPhoto: vi.fn(),
  designatePhoto: vi.fn(),
  undesignatePhoto: vi.fn(),
  removePhoto: vi.fn(),
}));
vi.mock("@/lib/person-photos/store", () => store);

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args) }));

import {
  addPersonPhotoAction,
  designatePersonPhotoAction,
  removePersonPhotoAction,
  undesignatePersonPhotoAction,
} from "./actions";

const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
const RESOLVED_OK = {
  kind: "ok" as const,
  org: { organizationId: "org-1", personId: "actor-1", name: "Alder Creek", organizationType: "congregation" as const, slug: "alder-creek", platformStatus: "managed" as const },
};
const PERSON = "00000000-0000-4000-8000-0000000000a1";
const PHOTO = "00000000-0000-4000-8000-0000000000b1";
const SLUG = "alder-creek";

const ALL_REFUSALS = Object.keys(REFUSAL_COPY) as PhotoRefusal[];
const NAMED = new Set<PhotoRefusal>(["minor", "cap_reached", "duplicate"]);

function formWith(bytes: Buffer | null, name = "photo"): FormData {
  const form = new FormData();
  if (bytes) form.set(name, new File([new Uint8Array(bytes)], "whatever-name.jpg", { type: "image/jpeg" }));
  return form;
}
const refusal = (reason: PhotoRefusal) => ({ kind: "refused" as const, reason, ...(NAMED.has(reason) ? { first: "Ada" } : {}) });

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

describe("every action: authenticate, then resolve the organization, before anything else", () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["add", () => addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.from("x")))],
    ["designate", () => designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "directory", attested: false })],
    ["undesignate", () => undesignatePersonPhotoAction(SLUG, PERSON, "directory")],
    ["remove", () => removePersonPhotoAction(SLUG, PERSON, PHOTO)],
  ];

  it.each(calls)("%s: no session -> the signed-in string, and nothing reached", async (_n, run) => {
    mockAuth.mockResolvedValue(null);
    expect(await run()).toEqual({ ok: false, error: "You must be signed in to do that." });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    noStoreCalled();
  });

  it.each(calls)("%s: a session without a user id is not a session", async (_n, run) => {
    mockAuth.mockResolvedValue({ user: {} });
    expect(await run()).toEqual({ ok: false, error: REUSED_COPY.signedOut });
    noStoreCalled();
  });

  it.each(calls)("%s: no access to the organization -> the no-access string, and nothing reached", async (_n, run) => {
    mockResolveOrgContext.mockResolvedValue({ kind: "no_access" });
    expect(await run()).toEqual({ ok: false, error: "You don't have access to that organization." });
    noStoreCalled();
  });

  it("the acting person, organization and user come from the session and the resolution, never from the request", async () => {
    store.removePhoto.mockResolvedValue({ kind: "ok" });
    await removePersonPhotoAction(SLUG, PERSON, PHOTO);
    expect(mockResolveOrgContext).toHaveBeenCalledWith("user-1", SLUG);
    expect(store.removePhoto).toHaveBeenCalledWith(
      { organizationId: "org-1", actorPersonId: "actor-1", actor: { userId: "user-1", email: "clerk@example.invalid" } },
      PERSON,
      PHOTO,
    );
  });
});

describe("each refusal kind maps to its one fixed string (Copy C6)", () => {
  it.each(ALL_REFUSALS)("%s", async (reason) => {
    store.addPhoto.mockResolvedValue(refusal(reason));
    store.designatePhoto.mockResolvedValue(refusal(reason));
    store.undesignatePhoto.mockResolvedValue(refusal(reason));
    store.removePhoto.mockResolvedValue(refusal(reason));
    const expected = { ok: false, error: REFUSAL_COPY[reason]("Ada") };
    expect(await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.from("x")))).toEqual(expected);
    expect(await designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "directory", attested: false })).toEqual(expected);
    expect(await undesignatePersonPhotoAction(SLUG, PERSON, "directory")).toEqual(expected);
    expect(await removePersonPhotoAction(SLUG, PERSON, PHOTO)).toEqual(expected);
    expect(mockRevalidatePath, "a refusal revalidates nothing").not.toHaveBeenCalled();
  });

  it("the three strings that name the person name them", async () => {
    store.addPhoto.mockResolvedValue({ kind: "refused", reason: "minor", first: "Zelda" });
    const r = await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.from("x")));
    expect(r).toEqual({ ok: false, error: "Zelda appears to be under 18. Photos of children can't be added yet." });
  });

  it("a refusal that should have named the person but did not falls back to the generic truth, never a blank name", async () => {
    store.addPhoto.mockResolvedValue({ kind: "refused", reason: "cap_reached" });
    const r = (await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.from("x")))) as { error: string };
    expect(r.error).toBe("We couldn't save that photo. Nothing was changed. Try again.");
  });

  it("no error string carries raw error text, an id or a placeholder", () => {
    for (const reason of ALL_REFUSALS) {
      const text = REFUSAL_COPY[reason]("Ada");
      expect(text).not.toMatch(/[{}]|undefined|Error|sqlstate|uuid/i);
    }
  });
});

describe("success revalidates the photos page, the edit page and the directory", () => {
  it("add", async () => {
    store.addPhoto.mockResolvedValue({ kind: "ok", photoId: PHOTO, usedForDirectory: true });
    expect(await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.from("bytes")))).toEqual({
      ok: true,
      data: { photoId: PHOTO, usedForDirectory: true },
    });
    expect(mockRevalidatePath.mock.calls.map((c) => c[0])).toEqual([
      `/o/${SLUG}/admin/community/${PERSON}/edit/photos`,
      `/o/${SLUG}/admin/community/${PERSON}/edit`,
      `/o/${SLUG}/directory`,
    ]);
  });

  it("designate, undesignate and remove each revalidate the same three", async () => {
    store.designatePhoto.mockResolvedValue({ kind: "ok" });
    store.undesignatePhoto.mockResolvedValue({ kind: "ok" });
    store.removePhoto.mockResolvedValue({ kind: "ok" });
    for (const run of [
      () => designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "website", attested: true }),
      () => undesignatePersonPhotoAction(SLUG, PERSON, "website"),
      () => removePersonPhotoAction(SLUG, PERSON, PHOTO),
    ]) {
      mockRevalidatePath.mockClear();
      expect(await run()).toEqual({ ok: true });
      expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
    }
  });

  it("the file's bytes reach the store untouched, and the original file name does not", async () => {
    store.addPhoto.mockResolvedValue({ kind: "ok", photoId: PHOTO, usedForDirectory: false });
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await addPersonPhotoAction(SLUG, PERSON, formWith(bytes));
    const [, personId, sent] = store.addPhoto.mock.calls[0]!;
    expect(personId).toBe(PERSON);
    expect(Buffer.isBuffer(sent) && sent.equals(bytes)).toBe(true);
    expect(JSON.stringify(store.addPhoto.mock.calls[0]!.slice(0, 2))).not.toContain("whatever-name");
  });
});

describe("input is validated before the store is reached", () => {
  it("malformed ids are 'not found' and reach nothing", async () => {
    const notFound = { ok: false, error: REFUSAL_COPY.not_found("") };
    expect(await addPersonPhotoAction(SLUG, "not-a-uuid", formWith(Buffer.from("x")))).toEqual(notFound);
    expect(await designatePersonPhotoAction(SLUG, "../etc", { photoId: PHOTO, purpose: "directory", attested: false })).toEqual(notFound);
    expect(await designatePersonPhotoAction(SLUG, PERSON, { photoId: "x", purpose: "directory", attested: false })).toEqual(notFound);
    expect(await designatePersonPhotoAction(SLUG, PERSON, undefined as never)).toEqual(notFound);
    expect(await undesignatePersonPhotoAction(SLUG, "", "directory")).toEqual(notFound);
    expect(await removePersonPhotoAction(SLUG, PERSON, `${PHOTO}\n`)).toEqual(notFound);
    expect(await removePersonPhotoAction(SLUG, "1; drop table", PHOTO)).toEqual(notFound);
    noStoreCalled();
  });

  it("the purpose is a closed pair", async () => {
    const generic = { ok: false, error: REFUSAL_COPY.save_failed("") };
    expect(await designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "profile" as never, attested: true })).toEqual(generic);
    expect(await undesignatePersonPhotoAction(SLUG, PERSON, "Directory" as never)).toEqual(generic);
    noStoreCalled();
  });

  it.each([[false], ["true"], [1], [undefined], [null], [{}]])(
    "the website needs the boolean true as its attestation: %j is not consent, and the store is not reached",
    async (attested) => {
      const r = await designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "website", attested: attested as never });
      expect(r).toEqual({ ok: false, error: "Tick the box to confirm you have their permission." });
      noStoreCalled();
    },
  );

  it("the directory's clearance is optional, and only a boolean true counts as given", async () => {
    store.designatePhoto.mockResolvedValue({ kind: "ok" });
    await designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "directory", attested: "yes" as never });
    expect(store.designatePhoto.mock.calls[0]![2]).toEqual({ photoId: PHOTO, purpose: "directory", attested: false });
    await designatePersonPhotoAction(SLUG, PERSON, { photoId: PHOTO, purpose: "directory", attested: true });
    expect(store.designatePhoto.mock.calls[1]![2]).toEqual({ photoId: PHOTO, purpose: "directory", attested: true });
  });

  it("an upload with no file, a non-file value, an empty file or an oversized one is refused before the bytes are read", async () => {
    const text = new FormData();
    text.set("photo", "just a string");
    expect(await addPersonPhotoAction(SLUG, PERSON, formWith(null))).toEqual({ ok: false, error: "That file is empty." });
    expect(await addPersonPhotoAction(SLUG, PERSON, text)).toEqual({ ok: false, error: "That file is empty." });
    expect(await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.alloc(0)))).toEqual({ ok: false, error: "That file is empty." });
    expect(await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.alloc(UPLOAD_MAX_BYTES + 1)))).toEqual({
      ok: false,
      error: "That picture is too big to upload. Try a smaller one.",
    });
    // A field under another name is not the photo.
    expect(await addPersonPhotoAction(SLUG, PERSON, formWith(Buffer.from("x"), "file"))).toEqual({ ok: false, error: "That file is empty." });
    noStoreCalled();
  });
});

describe("the file holds no redirect and no database call", () => {
  const source = readFileSync(path.join(__dirname, "actions.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("never redirects (a redirect target would be an open-redirect surface; the client re-renders from the revalidated page)", () => {
    expect(source).not.toMatch(/\bredirect\s*\(|\bpermanentRedirect\s*\(|next\/navigation/);
  });

  it("calls no `db.` and imports no table or database module (check:audit has nothing to scan here; store.ts holds the checks)", () => {
    expect(source).not.toMatch(/\bdb\.|getPlatformDb|@\/lib\/db\b|drizzle-orm|@\/lib\/audit\b/);
  });
});
