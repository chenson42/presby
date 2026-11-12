/**
 * T11 - the leader panel's liveness (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 F442):
 * the public route's own two steps in the same order, the three states, and an address built only
 * from `SiteUrls` (the database slug, and the database's canonical host when one is serving).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteUrls } from "@/lib/site-urls";

vi.mock("server-only", () => ({}));
const resolveSiteOrganization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({ resolveSiteOrganization: (...a: unknown[]) => resolveSiteOrganization(...a) }));
const readPublicLearn = vi.hoisted(() => vi.fn());
vi.mock("./public", () => ({ readPublicLearn: (...a: unknown[]) => readPublicLearn(...a) }));

import { readLeaderLink } from "./leader-link";

const ORIGIN = "https://presby.invalid";
const okOrg = (slug: string, redirectHost: string | null = null) => ({
  kind: "ok" as const,
  mode: "slug" as const,
  slug,
  organizationId: "org-1",
  urls: buildSiteUrls({ mode: "slug", slug, platformOrigin: ORIGIN }),
  redirectHost,
  row: {},
});

beforeEach(() => {
  resolveSiteOrganization.mockReset();
  readPublicLearn.mockReset();
});

describe("readLeaderLink", () => {
  it("live: the slug-mode address on the platform origin, scheme stripped from the shown address", async () => {
    resolveSiteOrganization.mockResolvedValue(okOrg("alder-creek"));
    readPublicLearn.mockResolvedValue({ state: "available" });
    expect(await readLeaderLink("alder-creek")).toEqual({
      kind: "live",
      address: "presby.invalid/site/alder-creek/learn/spot-the-scam",
      href: "https://presby.invalid/site/alder-creek/learn/spot-the-scam",
    });
    // The public route's two steps, in order, with the database-returned slug and the closed key.
    expect(resolveSiteOrganization).toHaveBeenCalledWith("alder-creek");
    expect(readPublicLearn).toHaveBeenCalledWith("alder-creek", "org_portal.spot_the_scam");
    expect(resolveSiteOrganization.mock.invocationCallOrder[0]!).toBeLessThan(readPublicLearn.mock.invocationCallOrder[0]!);
  });

  it("live with a serving custom host: the church's own clean address on its canonical host (the slug URL would 307 there)", async () => {
    resolveSiteOrganization.mockResolvedValue(okOrg("alder-creek", "www.church-one.invalid"));
    readPublicLearn.mockResolvedValue({ state: "available" });
    expect(await readLeaderLink("alder-creek")).toEqual({
      kind: "live",
      address: "www.church-one.invalid/learn/spot-the-scam",
      href: "https://www.church-one.invalid/learn/spot-the-scam",
    });
  });

  it("the link is built from the database slug, not from the argument: a different argument cannot change it", async () => {
    resolveSiteOrganization.mockResolvedValue(okOrg("alder-creek"));
    readPublicLearn.mockResolvedValue({ state: "available" });
    const link = await readLeaderLink("../../evil");
    expect(link).toMatchObject({ kind: "live", href: "https://presby.invalid/site/alder-creek/learn/spot-the-scam" });
    expect(readPublicLearn).toHaveBeenCalledWith("alder-creek", "org_portal.spot_the_scam");
  });

  it("not live: the site does not resolve (flag off, not serving), and NO read of the toggle is made", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek" });
    expect(await readLeaderLink("alder-creek")).toEqual({ kind: "not_live" });
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek", reason: "absent" });
    expect(await readLeaderLink("alder-creek")).toEqual({ kind: "not_live" });
    expect(readPublicLearn).not.toHaveBeenCalled();
  });

  it("not live: the site resolves but the public read says unavailable (toggle off at the public gate)", async () => {
    resolveSiteOrganization.mockResolvedValue(okOrg("alder-creek"));
    readPublicLearn.mockResolvedValue({ state: "unavailable" });
    expect(await readLeaderLink("alder-creek")).toEqual({ kind: "not_live" });
  });

  it("unknown: a site read that failed, or a public read that failed - never claimed live or not live", async () => {
    resolveSiteOrganization.mockResolvedValue({ kind: "not_found", mode: "slug", slug: "alder-creek", reason: "read_failed" });
    expect(await readLeaderLink("alder-creek")).toEqual({ kind: "unknown" });
    resolveSiteOrganization.mockResolvedValue(okOrg("alder-creek"));
    readPublicLearn.mockResolvedValue({ state: "failed" });
    expect(await readLeaderLink("alder-creek")).toEqual({ kind: "unknown" });
  });
});
