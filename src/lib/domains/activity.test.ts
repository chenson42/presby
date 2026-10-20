import { describe, expect, it } from "vitest";
import { activityText, activityWho, buildActivity, type ActivityRow } from "./activity";

const at = (s: string) => new Date(`2030-01-0${s}T00:00:00Z`);
const row = (action: string, metadata: Record<string, unknown> = {}, id = action, d = "1"): ActivityRow => ({
  id,
  action,
  createdAt: at(d),
  metadata: { hostname: "church-one.invalid", actorKind: "tenant", ...metadata },
});

describe("activityText", () => {
  it.each([
    ["domain.claimed", "church-one.invalid was added."],
    ["domain.proof_verified", "Ownership of church-one.invalid was confirmed."],
    ["domain.live", "church-one.invalid went live."],
    ["domain.lapsed", "We could no longer find the ownership record for church-one.invalid."],
    ["domain.released", "church-one.invalid was released."],
    ["domain.hold_cleared", "church-one.invalid was resumed by PresbyPortal support."],
  ])("%s", (action, text) => {
    expect(activityText(row(action))).toBe(text);
  });

  it("an automatic primary promotion reads 'Primary address set automatically' (follow-up B)", () => {
    const text = activityText(row("domain.canonical_changed", { reason: "no_canonical", toHostname: "www.church-one.invalid", actorKind: "machine" }));
    expect(text).toBe("Primary address set automatically: www.church-one.invalid.");
    expect(activityText(row("domain.canonical_changed", { toHostname: "www.church-one.invalid" }))).toBe(
      "Primary address changed to www.church-one.invalid.",
    );
  });

  it("hold_set distinguishes a pause from a dispute and never repeats the reason", () => {
    const paused = activityText(row("domain.hold_set", { hold: "paused", reason: "Private note about this church" }));
    expect(paused).toBe("church-one.invalid was paused by PresbyPortal support.");
    expect(activityText(row("domain.hold_set", { hold: "disputed" }))).toBe("church-one.invalid was placed under review by PresbyPortal support.");
    expect(paused).not.toContain("Private note");
  });

  it("shows the Unicode form of a punycode host, and survives a missing or hostile hostname", () => {
    expect(activityText(row("domain.live", { hostname: "xn--bcher-kva.invalid" }))).toBe("bücher.invalid went live.");
    expect(activityText({ id: "1", action: "domain.live", createdAt: at("1"), metadata: null })).toBe("a domain went live.");
    expect(activityText(row("domain.live", { hostname: 42 }))).toBe("a domain went live.");
  });

  it("an action the list does not show is null", () => {
    expect(activityText(row("auth.signin"))).toBeNull();
  });
});

describe("activityWho and buildActivity", () => {
  it("maps actor kinds to a category and never to an email", () => {
    expect(activityWho(row("domain.live", { actorKind: "platform" }))).toBe("support");
    expect(activityWho(row("domain.live", { actorKind: "machine" }))).toBe("automatic");
    expect(activityWho(row("domain.live", { actorKind: "tenant" }))).toBe("team");
    expect(activityWho({ id: "x", action: "domain.live", createdAt: at("1"), metadata: [] })).toBe("team");
  });

  it("sorts newest first and drops rows it cannot describe", () => {
    const items = buildActivity([
      row("domain.claimed", {}, "a", "1"),
      row("auth.signin", {}, "skip", "2"),
      row("domain.live", {}, "c", "3"),
    ]);
    expect(items.map((i) => i.id)).toEqual(["c", "a"]);
    expect(items[0]).toMatchObject({ who: "team", at: "2030-01-03T00:00:00.000Z" });
  });
});

describe("buildActivity merges the apex and www twins into one line", () => {
  const twin = (action: string, hostname: string, id: string, ms: number, extra: Record<string, unknown> = {}): ActivityRow => ({
    id,
    action,
    createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, 0, ms)),
    metadata: { hostname, actorKind: "tenant", ...extra },
  });

  it("two rows of one action by one actor within seconds read as one event naming both hosts", () => {
    const items = buildActivity([
      twin("domain.claimed", "www.church-one.invalid", "w", 100),
      twin("domain.claimed", "church-one.invalid", "a", 0),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("church-one.invalid and www.church-one.invalid were added.");
  });

  it("does not merge across actions, across actors, across time, or the same host twice", () => {
    expect(buildActivity([twin("domain.live", "a.invalid", "1", 0), twin("domain.claimed", "b.invalid", "2", 0)])).toHaveLength(2);
    expect(buildActivity([twin("domain.live", "a.invalid", "1", 0), twin("domain.live", "b.invalid", "2", 0, { actorKind: "platform" })])).toHaveLength(2);
    expect(buildActivity([twin("domain.live", "a.invalid", "1", 0), twin("domain.live", "b.invalid", "2", 6_000)])).toHaveLength(2);
    expect(buildActivity([twin("domain.live", "a.invalid", "1", 0), twin("domain.live", "a.invalid", "2", 100)])).toHaveLength(2);
  });

  it("never merges a primary-address change (its hosts are a from and a to)", () => {
    const items = buildActivity([
      twin("domain.canonical_changed", "a.invalid", "1", 0, { toHostname: "a.invalid" }),
      twin("domain.canonical_changed", "b.invalid", "2", 100, { toHostname: "b.invalid" }),
    ]);
    expect(items).toHaveLength(2);
  });

  it("uses the plural verb for a merged pair and keeps the singular otherwise", () => {
    const merged = buildActivity([twin("domain.parked", "church-one.invalid", "1", 0), twin("domain.parked", "www.church-one.invalid", "2", 50)]);
    expect(merged[0]!.text).toBe("church-one.invalid and www.church-one.invalid were removed and are being held while you clean up your DNS.");
    const single = buildActivity([twin("domain.parked", "church-one.invalid", "1", 0)]);
    expect(single[0]!.text).toBe("church-one.invalid was removed and is being held while you clean up your DNS.");
  });
});
