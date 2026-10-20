import { describe, expect, it } from "vitest";
import { reservedSitePath } from "./sites-reserved-paths";

describe("reservedSitePath", () => {
  it.each(["/give", "/give/", "/give/return", "/give/anything/deeper", "give", "/Give", "/GIVE/Return", "//give", "/./give", " /give ", "/%67ive", "/give%2Freturn", "\\give"])(
    "%j is reserved (the platform serves /give itself)",
    (path) => {
      expect(reservedSitePath(path)).toEqual({ reserved: true, segment: "give" });
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
