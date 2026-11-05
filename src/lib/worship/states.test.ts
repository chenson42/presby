import { describe, expect, it } from "vitest";
import {
  ACTOR_KINDS,
  LINK_ACCEPTED,
  canTransition,
  countsAsFilled,
  isLive,
  serviceAllows,
  transitionKind,
  withdrawnByServiceCancel,
} from "./states";
import { ASSIGNMENT_STATUSES, type AssignmentStatus } from "./vocab";

const S = ASSIGNMENT_STATUSES;

function allowed(from: AssignmentStatus, to: AssignmentStatus): string[] {
  return ACTOR_KINDS.filter((actor) => canTransition(from, to, actor));
}

describe("the assignment state machine (mirrors the BEFORE UPDATE guard; states.db.test.ts drives the trigger)", () => {
  it("send is draft -> requested, by the sender only", () => {
    expect(allowed("draft", "requested")).toEqual(["sender"]);
    for (const from of S.filter((s) => s !== "draft")) expect(allowed(from, "requested"), from).toEqual([]);
  });

  it("an answer is confirmed or declined, from draft, requested, confirmed or declined, by self or on behalf", () => {
    for (const from of ["draft", "requested", "confirmed", "declined"] as const) {
      for (const to of ["confirmed", "declined"] as const) {
        expect(allowed(from, to), `${from} -> ${to}`).toEqual(["self", "on_behalf"]);
      }
    }
    expect(allowed("withdrawn", "confirmed")).toEqual([]);
    expect(allowed("withdrawn", "declined")).toEqual([]);
  });

  it("withdraw is from any non-withdrawn status, by a remover or the service cancel", () => {
    for (const from of S.filter((s) => s !== "withdrawn")) {
      expect(allowed(from, "withdrawn"), from).toEqual(["remover", "service_cancel"]);
    }
    expect(allowed("withdrawn", "withdrawn")).toEqual([]);
  });

  it("nothing returns to draft and nothing leaves withdrawn", () => {
    for (const from of S) expect(allowed(from, "draft"), `${from} -> draft`).toEqual([]);
    for (const to of S) expect(allowed("withdrawn", to), `withdrawn -> ${to}`).toEqual([]);
  });

  it("link is refused in Increment 1 for every pair (Increment 1b flips LINK_ACCEPTED with the trigger body)", () => {
    expect(LINK_ACCEPTED).toBe(false);
    for (const from of S) for (const to of S) expect(canTransition(from, to, "link"), `${from} -> ${to}`).toBe(false);
  });

  it("a same-status pair is a transition only for a re-answer (confirmed -> confirmed, declined -> declined)", () => {
    expect(transitionKind("confirmed", "confirmed")).toBe("respond");
    expect(transitionKind("declined", "declined")).toBe("respond");
    for (const s of ["draft", "requested", "withdrawn"] as const) expect(transitionKind(s, s), s).toBeNull();
  });

  it("a guest row has no answer to record but can be removed", () => {
    expect(canTransition("confirmed", "declined", "on_behalf", { guest: true })).toBe(false);
    expect(canTransition("confirmed", "declined", "self", { guest: true })).toBe(false);
    expect(canTransition("confirmed", "withdrawn", "remover", { guest: true })).toBe(true);
  });

  it("a person cannot do another kind of actor's act (a remover cannot send, a sender cannot answer)", () => {
    expect(canTransition("draft", "requested", "remover")).toBe(false);
    expect(canTransition("requested", "confirmed", "sender")).toBe(false);
    expect(canTransition("requested", "withdrawn", "self")).toBe(false);
  });
});

describe("the service conditions", () => {
  const open = { cancelled: false, started: false };

  it("send and respond need a service that is neither cancelled nor started", () => {
    for (const kind of ["send", "respond"] as const) {
      expect(serviceAllows(kind, "self", open)).toBe(true);
      expect(serviceAllows(kind, "self", { cancelled: true, started: false })).toBe(false);
      expect(serviceAllows(kind, "self", { cancelled: false, started: true })).toBe(false);
    }
  });

  it("a person's removal has no service condition; a service-cancel withdrawal requires the cancel", () => {
    expect(serviceAllows("withdraw", "remover", { cancelled: true, started: true })).toBe(true);
    expect(serviceAllows("withdraw", "remover", open)).toBe(true);
    expect(serviceAllows("withdraw", "service_cancel", open)).toBe(false);
    expect(serviceAllows("withdraw", "service_cancel", { cancelled: true, started: false })).toBe(true);
  });
});

describe("what a status means for a position and for a cancel", () => {
  it("a cancel withdraws drafts and open requests and retains confirmed and declined", () => {
    expect(S.filter(withdrawnByServiceCancel)).toEqual(["draft", "requested"]);
  });

  it("a position counts draft, requested and confirmed as filled; declined and withdrawn open it", () => {
    expect(S.filter(countsAsFilled)).toEqual(["draft", "requested", "confirmed"]);
    expect(S.filter(isLive)).toEqual(["draft", "requested", "confirmed", "declined"]);
  });
});
