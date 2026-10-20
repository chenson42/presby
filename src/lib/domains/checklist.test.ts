/**
 * The checklist view-model (Phase 3 Component / Page Plan; G11, G29, G30).
 * Pure.
 */
import { describe, expect, it } from "vitest";
import { buildChecklist, readObservation, type ChecklistRow } from "./checklist";
import type { DomainState } from "./state";

const CTX = { siteStatus: "live" as string | null, platformSiteUrl: "platform.invalid/site/alder-creek" };
const TOKEN = "T0kenT0kenT0kenT0kenT0kenT0kenT0ken";
const FUTURE = new Date("2030-01-08T00:00:00Z");

function row(over: Partial<ChecklistRow> & { hostname: string; state: DomainState }): ChecklistRow {
  return {
    id: `id-${over.hostname}`,
    claimName: "church-one.invalid",
    purpose: "web",
    webRole: "alias",
    platformHold: null,
    proofToken: TOKEN,
    lastCheckedAt: null,
    lastCheckClass: null,
    expiresAt: FUTURE,
    graceEndsAt: null,
    observation: {},
    ...over,
  };
}

const pair = (state: DomainState, extra: Partial<ChecklistRow> = {}) => [
  row({ hostname: "church-one.invalid", state, webRole: "alias", ...extra }),
  row({ hostname: "www.church-one.invalid", state, webRole: "canonical", ...extra }),
];

describe("grouping and ordering", () => {
  it("groups by claim name, canonical first, and drops terminal rows", () => {
    const groups = buildChecklist(
      [
        ...pair("pending"),
        row({ hostname: "old.invalid", claimName: "old.invalid", state: "released" }),
        row({ hostname: "gone.invalid", claimName: "gone.invalid", state: "expired" }),
      ],
      CTX,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].claimName).toBe("church-one.invalid");
    expect(groups[0].hosts.map((h) => h.hostname)).toEqual(["www.church-one.invalid", "church-one.invalid"]);
    expect(groups[0].hosts[0].role).toBe("canonical");
  });

  it("two claim groups stay separate", () => {
    const groups = buildChecklist(
      [
        ...pair("pending"),
        row({ hostname: "other.invalid", claimName: "other.invalid", state: "pending" }),
      ],
      CTX,
    );
    expect(groups.map((g) => g.claimName).sort()).toEqual(["church-one.invalid", "other.invalid"]);
  });

  it("empty input is no groups (the page renders its empty state)", () => {
    expect(buildChecklist([], CTX)).toEqual([]);
  });
});

describe("steps and phases", () => {
  it.each<[DomainState, number, string]>([
    ["pending", 1, "proving"],
    ["verified", 2, "connecting"],
    ["attach_pending", 2, "connecting"],
    ["attached", 3, "securing"],
    ["live", 4, "live"],
    ["lapsed", 0, "lapsed"],
    ["parked", 0, "parked"],
    ["release_pending", 0, "releasing"],
  ])("%s -> step %i, phase %s", (state, step, phase) => {
    const g = buildChecklist(pair(state), CTX)[0];
    expect(g.step).toBe(step);
    expect(g.phase).toBe(phase);
  });

  it("the group is only as far along as its least advanced row", () => {
    const g = buildChecklist(
      [
        row({ hostname: "church-one.invalid", state: "live", webRole: "alias" }),
        row({ hostname: "www.church-one.invalid", state: "attached", webRole: "canonical" }),
      ],
      CTX,
    )[0];
    expect(g.step).toBe(3);
  });

  it("marks steps done / current / todo", () => {
    const g = buildChecklist(pair("attached"), CTX)[0];
    expect(g.steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo"]);
    const lapsed = buildChecklist(pair("lapsed"), CTX)[0];
    expect(lapsed.steps.every((s) => s.state === "todo")).toBe(true);
  });
});

describe("the proof record", () => {
  it("is a TXT at _presby-challenge.<claim> with a presby-verify= value", () => {
    const [proof] = buildChecklist(pair("pending"), CTX)[0].records;
    expect(proof).toMatchObject({
      kind: "proof",
      type: "TXT",
      name: "_presby-challenge.church-one.invalid",
      value: `presby-verify=${TOKEN}`,
      status: "unknown",
    });
  });

  it.each([
    ["present", "correct"],
    ["absent", "missing"],
    ["wrong_value", "wrong_value"],
    ["unknown", "unknown"],
  ] as const)("observation %s -> status %s", (observed, status) => {
    const g = buildChecklist(pair("pending", { observation: { proof: { status: observed } } }), CTX)[0];
    expect(g.records[0].status).toBe(status);
  });

  it("a lookup that failed is 'unknown', never 'missing' (G30)", () => {
    const g = buildChecklist(
      pair("pending", { lastCheckClass: "dns_unknown", observation: { proof: { status: "unknown" } } }),
      CTX,
    )[0];
    expect(g.records[0].status).toBe("unknown");
    expect(g.banners.find((b) => b.code === "lookup_failed")?.message).toBe(
      "We couldn't check right now. Try again in a few minutes.",
    );
  });

  it("is marked keep-in-place once the claim is past step 1 (the takeover defence)", () => {
    expect(buildChecklist(pair("pending"), CTX)[0].records[0].keep).toBe(false);
    expect(buildChecklist(pair("verified"), CTX)[0].records[0].keep).toBe(true);
    expect(buildChecklist(pair("lapsed"), CTX)[0].records[0].keep).toBe(true);
  });

  it("tolerates garbage in the stored observation", () => {
    for (const bad of [null, "x", 7, [], [1]]) {
      expect(readObservation(bad)).toEqual({});
    }
    expect(buildChecklist(pair("pending", { observation: "garbage" }), CTX)[0].records[0].status).toBe("unknown");
  });
});

describe("routing records (written by Batch 1b)", () => {
  const targets = { cname: "cname.vercel-dns.invalid", ipv4: ["203.0.113.9"] };

  it("none until the hosting adapter has cached its targets", () => {
    expect(buildChecklist(pair("attach_pending"), CTX)[0].records).toHaveLength(1);
  });

  it("an A record for the apex and a CNAME for www, with per-host results", () => {
    const g = buildChecklist(
      pair("attached", {
        observation: {
          targets,
          routing: {
            records: [
              { hostname: "church-one.invalid", status: "correct" },
              { hostname: "www.church-one.invalid", status: "wrong_value", hint: "proxied" },
            ],
          },
        },
      }),
      CTX,
    )[0];
    const routing = g.records.filter((r) => r.kind === "routing");
    expect(routing).toEqual([
      expect.objectContaining({ type: "CNAME", name: "www.church-one.invalid", value: targets.cname, status: "wrong_value", hint: "proxied" }),
      expect.objectContaining({ type: "A", name: "church-one.invalid", value: "203.0.113.9", status: "correct" }),
    ]);
  });

  it("no routing rows for a row that has not been verified yet, nor for a mail row", () => {
    const pending = buildChecklist(pair("pending", { observation: { targets } }), CTX)[0];
    expect(pending.records.filter((r) => r.kind === "routing")).toEqual([]);
    const mail = buildChecklist(
      [row({ hostname: "church-one.invalid", state: "verified", purpose: "mail", webRole: null, observation: { targets } })],
      CTX,
    )[0];
    expect(mail.records.filter((r) => r.kind === "routing")).toEqual([]);
  });
});

describe("banners (plain English, no provider text, G30)", () => {
  const codes = (g: ReturnType<typeof buildChecklist>[number]) => g.banners.map((b) => b.code);

  it("held elsewhere names no organization", () => {
    const g = buildChecklist(pair("pending", { lastCheckClass: "held_elsewhere" }), CTX)[0];
    const b = g.banners.find((x) => x.code === "held_elsewhere")!;
    expect(b.message).toBe("This domain is already connected to another organization. Contact support.");
    expect(b.tone).toBe("error");
  });

  it("provider unavailable reassures that DNS changes are safe", () => {
    const g = buildChecklist(pair("attach_pending", { lastCheckClass: "provider_unavailable" }), CTX)[0];
    expect(g.banners.find((b) => b.code === "provider_unavailable")?.message).toMatch(/Your DNS changes are safe to make/);
  });

  it("paused and disputed point the church at its working platform URL", () => {
    const paused = buildChecklist(pair("live", { platformHold: "paused" }), CTX)[0];
    expect(paused.banners.find((b) => b.code === "paused")?.message).toContain(CTX.platformSiteUrl);
    const disputed = buildChecklist(pair("live", { platformHold: "disputed" }), CTX)[0];
    expect(codes(disputed)).toContain("disputed");
  });

  it("lapsed says where the site is serving from meanwhile", () => {
    const g = buildChecklist(pair("lapsed"), CTX)[0];
    expect(g.banners.find((b) => b.code === "lapsed")?.message).toContain(CTX.platformSiteUrl);
    expect(g.offboarding).toBe(true);
  });

  it("parked names the date the hold ends", () => {
    const g = buildChecklist(pair("parked", { graceEndsAt: new Date("2030-02-01T00:00:00Z") }), CTX)[0];
    expect(g.banners.find((b) => b.code === "parked")?.message).toContain("2030-02-01");
    expect(g.canReconnect).toBe(true);
  });

  it("attached reads 'Securing your site...'", () => {
    expect(codes(buildChecklist(pair("attached"), CTX)[0])).toContain("securing");
  });

  it("pre-flight: an unpublished site warns before the DNS flip, and only then", () => {
    expect(codes(buildChecklist(pair("pending"), { ...CTX, siteStatus: "provisioning" })[0])).toContain("preflight_site_not_live");
    expect(codes(buildChecklist(pair("pending"), CTX)[0])).not.toContain("preflight_site_not_live");
    expect(codes(buildChecklist(pair("pending"), { ...CTX, siteStatus: null })[0])).not.toContain("preflight_site_not_live");
    expect(codes(buildChecklist(pair("live"), { ...CTX, siteStatus: "provisioning" })[0])).not.toContain("preflight_site_not_live");
  });

  it("a pending claim says when it expires", () => {
    const g = buildChecklist(pair("pending"), CTX)[0];
    expect(g.claimExpiresAt).toBe(FUTURE.toISOString());
    expect(g.banners.find((b) => b.code === "claim_expires")?.message).toContain("2030-01-08");
    expect(buildChecklist(pair("verified"), CTX)[0].claimExpiresAt).toBeNull();
  });

  it("the keep-the-TXT banner appears from step 2", () => {
    expect(codes(buildChecklist(pair("pending"), CTX)[0])).not.toContain("keep_txt");
    expect(codes(buildChecklist(pair("verified"), CTX)[0])).toContain("keep_txt");
  });

  it("no banner leaks provider vocabulary", () => {
    const all = buildChecklist(
      [
        ...pair("attach_pending", { lastCheckClass: "provider_rejected" }),
      ],
      CTX,
    )[0].banners.map((b) => b.message).join(" ");
    expect(all).not.toMatch(/vercel|resend|cloudflare|403|409|429|token|api/i);
  });
});

describe("capabilities", () => {
  it("canCheck: live-ish states and lapsed, not parked or releasing", () => {
    for (const s of ["pending", "verified", "attach_pending", "attached", "live", "lapsed"] as const) {
      expect(buildChecklist(pair(s), CTX)[0].canCheck, s).toBe(true);
    }
    for (const s of ["parked", "release_pending"] as const) {
      expect(buildChecklist(pair(s), CTX)[0].canCheck, s).toBe(false);
    }
  });

  it("canRemove: not once parked or releasing", () => {
    expect(buildChecklist(pair("live"), CTX)[0].canRemove).toBe(true);
    expect(buildChecklist(pair("parked"), CTX)[0].canRemove).toBe(false);
    expect(buildChecklist(pair("release_pending"), CTX)[0].canRemove).toBe(false);
  });

  it("lastCheckedAt is the most recent check in the group", () => {
    const g = buildChecklist(
      [
        row({ hostname: "church-one.invalid", state: "pending", lastCheckedAt: new Date("2030-01-01T10:00:00Z") }),
        row({ hostname: "www.church-one.invalid", state: "pending", lastCheckedAt: new Date("2030-01-01T11:00:00Z") }),
      ],
      CTX,
    )[0];
    expect(g.lastCheckedAt).toBe("2030-01-01T11:00:00.000Z");
  });

  it("shows the Unicode display name for a punycode claim", () => {
    const g = buildChecklist(
      [row({ hostname: "xn--mnchen-kirche-wob.invalid", claimName: "xn--mnchen-kirche-wob.invalid", state: "pending" })],
      CTX,
    )[0];
    expect(g.displayName).toBe("münchen-kirche.invalid");
    expect(g.hosts[0].displayHostname).toBe("münchen-kirche.invalid");
  });
});
