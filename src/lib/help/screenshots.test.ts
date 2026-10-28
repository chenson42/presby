import { describe, expect, it } from "vitest";
import { resolveShot } from "./screenshots";

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
  it("resolves nothing from the real (empty) manifest", () => {
    expect(resolveShot("shot:signin-form")).toBeNull();
  });
});
