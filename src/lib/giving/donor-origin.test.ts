/**
 * donorOrigin(slug): where a PUBLIC donor returns after Stripe Checkout
 * (docs/work-log/2026-10-19-custom-domains.md, R5 / A11 / DECISION-181). Mocked at
 * the database edge only. What this pins:
 *
 *   1. it answers from the DATABASE's serving host, and from nothing else;
 *   2. every failure (no row, a malformed host, a DB error, no platform origin)
 *      falls to the platform origin or `null`, never to a guess;
 *   3. it takes a slug and NOTHING ELSE: no request, header or form field has any
 *      way in (a source scan pins that).
 */
vi.mock("server-only", () => ({}));
const mockExecute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => mockExecute(...a) } }));

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { donorOrigin } from "./donor-origin";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("donorOrigin", () => {
  it("returns the serving custom host from the database row", async () => {
    mockExecute.mockResolvedValue({ rows: [{ serving_host: "church-one.invalid" }] });
    expect(await donorOrigin("alder-creek")).toEqual({ origin: "https://church-one.invalid", custom: true });
  });

  it("returns the platform origin when no custom host is serving", async () => {
    for (const result of [{ rows: [{ serving_host: null }] }, { rows: [] }, { rows: [{}] }]) {
      mockExecute.mockResolvedValueOnce(result);
      expect(await donorOrigin("alder-creek")).toEqual({ origin: "https://app.example.invalid", custom: false });
    }
  });

  it("ignores a serving host that is not a plain hostname (no scheme, path, port, userinfo or whitespace)", async () => {
    for (const bad of ["https://evil.invalid", "evil.invalid/x", "evil.invalid:8443", "a@evil.invalid", "evil .invalid", "EVIL.invalid", "", "localhost", 7, {}]) {
      mockExecute.mockResolvedValueOnce({ rows: [{ serving_host: bad }] });
      expect(await donorOrigin("alder-creek"), JSON.stringify(bad)).toEqual({ origin: "https://app.example.invalid", custom: false });
    }
  });

  it("falls to the platform origin on a database error, logging the slug and never the error text", async () => {
    mockExecute.mockRejectedValue(new Error("Failed query: select serving_host from presby_published_site($1)\nparams: alder-creek"));
    expect(await donorOrigin("alder-creek")).toEqual({ origin: "https://app.example.invalid", custom: false });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("alder-creek");
    expect(logged).not.toMatch(/Failed query|select serving_host|params:/);
  });

  it("is null when there is neither a serving host nor a safe platform origin (production without https)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://insecure.example.invalid");
    mockExecute.mockResolvedValue({ rows: [{ serving_host: null }] });
    expect(await donorOrigin("alder-creek")).toBeNull();
  });

  it("passes the slug as a bound parameter, and nothing else is a parameter", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    await donorOrigin("alder-creek");
    const chunks = (mockExecute.mock.calls[0]![0] as { queryChunks: unknown[] }).queryChunks;
    const params = chunks.filter((c) => !(typeof c === "object" && c !== null && "value" in c && Array.isArray((c as { value: unknown }).value)));
    expect(params).toEqual(["alder-creek"]);
  });

  it("reads no request input: no headers(), cookies(), Host or forwarded header anywhere in the module", () => {
    const source = readFileSync(new URL("./donor-origin.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(source).not.toMatch(/next\/headers|headers\(|cookies\(|x-forwarded|\bforwarded\b|req\.|request\./i);
  });
});
