/**
 * T4 - the Learn contract's constants and the `SiteUrls` equality
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Tests T4). Pure.
 */
import { describe, expect, it } from "vitest";
import { buildSiteUrls } from "@/lib/site-urls";
import {
  LEARN_PUBLIC_KEYS,
  SPOT_THE_SCAM_FEATURE_KEY,
  SPOT_THE_SCAM_PAGE_PATH,
  SPOT_THE_SCAM_SLOT,
  isLearnPublicKey,
} from "./contract";

describe("the Learn contract", () => {
  it("pins the three constants a site author, a route and a migration depend on", () => {
    expect(SPOT_THE_SCAM_FEATURE_KEY).toBe("org_portal.spot_the_scam");
    expect(SPOT_THE_SCAM_SLOT).toBe("spotTheScam");
    expect(SPOT_THE_SCAM_PAGE_PATH).toBe("/learn/spot-the-scam");
  });

  it("the key list the reader accepts is closed and holds exactly the one Learn key today", () => {
    expect([...LEARN_PUBLIC_KEYS]).toEqual([SPOT_THE_SCAM_FEATURE_KEY]);
    expect(isLearnPublicKey(SPOT_THE_SCAM_FEATURE_KEY)).toBe(true);
    for (const other of ["org_portal.giving", "org_portal.careers", "learn", "", null, undefined, 7]) {
      expect(isLearnPublicKey(other), String(other)).toBe(false);
    }
  });

  it("SPOT_THE_SCAM_PAGE_PATH equals SiteUrls.spotTheScam() in host mode and page(...) in slug mode, so SiteUrls cannot drift from the contract", () => {
    const platformOrigin = "https://app.example.invalid";
    const host = buildSiteUrls({ mode: "host", host: "www.church-one.invalid", slug: "alder-creek", platformOrigin });
    const slug = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin });
    expect(host.spotTheScam()).toBe(SPOT_THE_SCAM_PAGE_PATH);
    expect(slug.spotTheScam()).toBe(slug.page(SPOT_THE_SCAM_PAGE_PATH));
  });
});
