import { describe, expect, it } from "vitest";
import { resolveShot } from "./screenshots";
import { HELP_SHOTS } from "./screenshots-data";

const shots = [{ id: "a", width: 640, height: 480 }];
const images = { a: { src: "/_next/static/a.png" } };

describe("resolveShot", () => {
  it("admits shot:<id> only, with the manifest's size and the import's src", () => {
    expect(resolveShot("shot:a", images, shots)).toEqual({ src: "/_next/static/a.png", width: 640, height: 480 });
  });
  it("refuses an id missing from the manifest or from the imports", () => {
    expect(resolveShot("shot:b", images, shots)).toBeNull();
    expect(resolveShot("shot:a", {}, shots)).toBeNull();
    expect(resolveShot("shot:a", images, [])).toBeNull();
  });
  it("refuses anything that is not the shot scheme, and inherited keys", () => {
    expect(resolveShot("https://tracker.example.net/p.png", images, shots)).toBeNull();
    expect(resolveShot("/etc/passwd", images, shots)).toBeNull();
    expect(resolveShot("a", images, shots)).toBeNull();
    expect(resolveShot("shot:constructor", images, [{ id: "constructor", width: 1, height: 1 }])).toBeNull();
  });
  it("resolves every id in the real manifest, with the manifest's own size (an id with no import would render nothing)", () => {
    expect(HELP_SHOTS.length).toBeGreaterThan(0);
    for (const shot of HELP_SHOTS) {
      const r = resolveShot(`shot:${shot.id}`);
      expect(r, shot.id).not.toBeNull();
      expect(r).toMatchObject({ width: shot.width, height: shot.height });
    }
  });
  it("resolves nothing for an id that is not in the real manifest", () => {
    expect(resolveShot("shot:no-such-shot")).toBeNull();
  });
});
