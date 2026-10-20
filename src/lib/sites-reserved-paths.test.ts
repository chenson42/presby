import { describe, expect, it } from "vitest";
import { reservedSitePath } from "./sites-reserved-paths";

describe("reservedSitePath", () => {
  it.each(["/give", "/give/", "/give/return", "/give/anything/deeper", "give", "/Give", "/GIVE/Return", "//give", "/./give", " /give ", "/%67ive", "/give%2Freturn", "\\give"])(
    "%j is reserved (the platform serves /give itself)",
    (path) => {
      expect(reservedSitePath(path)).toEqual({ reserved: true, segment: "give" });
    },
  );

  it.each([
    ["/assets", "assets"],
    ["/assets/abc", "assets"],
    ["/Assets/abc", "assets"],
    ["/%61ssets", "assets"],
    ["/robots.txt", "robots.txt"],
    ["/ROBOTS.txt", "robots.txt"],
    ["/robots.txt/", "robots.txt"],
    ["/sitemap.xml", "sitemap.xml"],
    ["sitemap.xml", "sitemap.xml"],
    ["/./sitemap.xml", "sitemap.xml"],
  ])(
    "%j is reserved as %j (a church's own domain serves it at the root - T15)",
    (path, segment) => {
      expect(reservedSitePath(path)).toEqual({ reserved: true, segment });
    },
  );

  it.each(["/assets-gallery", "/about/assets", "/robots", "/robots.txt.html", "/sitemap", "/sitemap.xml.bak", "/xsitemap.xml", "/about/sitemap.xml"])(
    "%j is not reserved (only the exact reserved segment shadows)",
    (path) => {
      expect(reservedSitePath(path)).toEqual({ reserved: false });
    },
  );

  it.each(["/", "", "/about", "/giving", "/give-now", "/forgive", "/about/give", "/ways-to-give", "/gift", "/giveaway", "/g/ive"])(
    "%j is not reserved (only the exact segment `give` is shadowed)",
    (path) => {
      expect(reservedSitePath(path)).toEqual({ reserved: false });
    },
  );

  it("never throws on a malformed percent-escape or a non-string", () => {
    expect(reservedSitePath("/%E0%A4%A")).toEqual({ reserved: false });
    expect(reservedSitePath(undefined as unknown as string)).toEqual({ reserved: false });
    expect(reservedSitePath(42 as unknown as string)).toEqual({ reserved: false });
  });
});
