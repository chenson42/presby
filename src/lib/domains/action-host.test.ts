/**
 * isDirectPlatformActionRequest (DECISION-313): a Server Action is direct on a platform host only
 * when `Host` is a platform host AND Next's forwarded-action marker is absent.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDirectPlatformActionRequest, NEXT_ACTION_FORWARDED_HEADER } from "./action-host";

const DEV_ENV = {} as const;
const PROD_ENV = {
  VERCEL_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://app.example.invalid",
  NEXT_PUBLIC_PLATFORM_HOSTS: "app.example.invalid",
} as const;
const h = (init: Record<string, string>) => new Headers(init);

describe("isDirectPlatformActionRequest", () => {
  it("accepts a request whose Host is a platform host and that was not forwarded", () => {
    expect(isDirectPlatformActionRequest(h({ host: "localhost:3000" }), DEV_ENV)).toBe(true);
    expect(isDirectPlatformActionRequest(h({ host: "app.example.invalid" }), PROD_ENV)).toBe(true);
  });

  it("refuses a forwarded action, with any value, even though its Host is a platform host (the CA7 defect)", () => {
    for (const value of ["1", "", "0", "true"]) {
      expect(
        isDirectPlatformActionRequest(
          h({ host: "localhost:3000", [NEXT_ACTION_FORWARDED_HEADER]: value, "x-forwarded-host": "church-one.invalid" }),
          DEV_ENV,
        ),
        `value ${JSON.stringify(value)}`,
      ).toBe(false);
    }
    expect(
      isDirectPlatformActionRequest(h({ host: "app.example.invalid", [NEXT_ACTION_FORWARDED_HEADER]: "1" }), PROD_ENV),
    ).toBe(false);
  });

  it("refuses a church's custom host", () => {
    expect(isDirectPlatformActionRequest(h({ host: "church-one.invalid" }), DEV_ENV)).toBe(false);
    expect(isDirectPlatformActionRequest(h({ host: "www.church-one.org" }), PROD_ENV)).toBe(false);
  });

  it("refuses an IP-literal Host in a production deployment, and a missing Host anywhere", () => {
    expect(isDirectPlatformActionRequest(h({ host: "203.0.113.9" }), PROD_ENV)).toBe(false);
    expect(isDirectPlatformActionRequest(new Headers(), DEV_ENV)).toBe(false);
    expect(isDirectPlatformActionRequest(new Headers(), PROD_ENV)).toBe(false);
  });

  it("never trusts x-forwarded-host: it can neither grant nor deny (R3)", () => {
    // It cannot make a custom host a platform host...
    expect(isDirectPlatformActionRequest(h({ host: "church-one.invalid", "x-forwarded-host": "localhost" }), DEV_ENV)).toBe(false);
    // ...and it cannot turn a direct platform request into a refusal.
    expect(isDirectPlatformActionRequest(h({ host: "localhost:3000", "x-forwarded-host": "church-one.invalid" }), DEV_ENV)).toBe(true);
  });

  it("the header name is Next's own, lower-case", () => {
    expect(NEXT_ACTION_FORWARDED_HEADER).toBe("x-action-forwarded");
  });
});

describe("the module's shape", () => {
  const source = readFileSync(path.join(__dirname, "action-host.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("imports only ./host, is not server-only, and never reads x-forwarded-host", () => {
    const specs = [...code.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specs).toEqual(["./host"]);
    expect(code).not.toMatch(/server-only/);
    expect(code).not.toMatch(/x-forwarded-host|x-original-host|["']forwarded["']/i);
  });

  it("is not imported by the proxy", () => {
    const proxy = readFileSync(path.join(__dirname, "../../proxy.ts"), "utf8");
    expect(proxy).not.toMatch(/action-host/);
  });
});

describe("version tripwire: Next still names the forwarded-action marker", () => {
  it("node_modules/next/dist/server/app-render/action-handler.js contains the literal 'x-action-forwarded'", () => {
    // If a Next upgrade renames the marker, the refusal in isDirectPlatformActionRequest goes
    // quiet and a custom host's forwarded action runs as a platform one. Fail loudly instead.
    const file = path.join(__dirname, "../../../node_modules/next/dist/server/app-render/action-handler.js");
    expect(readFileSync(file, "utf8")).toContain("'x-action-forwarded'");
  });
});
