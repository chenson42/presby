// @vitest-environment jsdom
/**
 * `/site/<key>/give/return` (docs/work-log/2026-10-15-online-giving.md, Flow 3 step
 * 4). The panel is chosen by presby's own rows, never by the query string; a
 * missing or repeated `session_id` is `unknown` without a database call; the page
 * is noindex and sends no referrer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const readReturnState = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/public-config", () => ({ readReturnState: (...a: unknown[]) => readReturnState(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
const resolveGiveSite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({ resolveGiveSite: (...a: unknown[]) => resolveGiveSite(...a) }));

import { buildSiteUrls } from "@/lib/site-urls";
import PublicGiveReturnPage, { dynamic, metadata } from "./page";

const call = (slug: string, sp: Record<string, string | string[] | undefined>) =>
  PublicGiveReturnPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(sp) });

beforeEach(() => {
  // Default: slug mode, where the key is the slug.
  resolveGiveSite.mockImplementation(async (key: string) => ({
    slug: key,
    urls: buildSiteUrls({ mode: "slug", slug: key, platformOrigin: "http://localhost:3000" }),
    redirectHost: null,
  }));
});

afterEach(() => {
  cleanup();
  resolveGiveSite.mockReset();
  readReturnState.mockReset();
});

describe("PublicGiveReturnPage", () => {
  it("is noindex, no-referrer and dynamic", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(dynamic).toBe("force-dynamic");
  });

  it("reads the state by slug and session id and renders that panel", async () => {
    readReturnState.mockResolvedValue({ state: "received", giftAmountCents: 2500, coveredCents: 0, fundName: "General Fund", frequency: "once", livemode: true });
    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5" }));
    expect(readReturnState).toHaveBeenCalledWith("alder-creek", "cs_test_a1B2c3D4e5");
    expect(screen.getByTestId("give-return-received")).toBeTruthy();
    expect(screen.getByTestId("give-return-gift").textContent).toBe("$25.00 to General Fund");
  });

  it.each([
    ["missing", {}],
    ["repeated", { session_id: ["cs_test_a1B2c3D4e5", "cs_test_zzzzzzzz"] }],
  ])("a %s session_id is the unknown panel and never reaches the database", async (_label, sp) => {
    render(await call("alder-creek", sp));
    expect(screen.getByTestId("give-return-unknown")).toBeTruthy();
    expect(readReturnState).not.toHaveBeenCalled();
  });

  it("the unknown panel is the same markup whatever the slug (nothing here depends on whether it is a tenant)", async () => {
    readReturnState.mockResolvedValue({ state: "unknown" });
    const html: string[] = [];
    for (const slug of ["no-such-church", "alder-creek"]) {
      const { container, unmount } = render(await call(slug, { session_id: "cs_test_a1B2c3D4e5" }));
      html.push(container.innerHTML.split(slug).join("SLUG"));
      unmount();
    }
    expect(html[0]).toBe(html[1]);
  });

  it("a database error is the error panel, which says the gift is unaffected", async () => {
    readReturnState.mockResolvedValue({ state: "error" });
    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5" }));
    expect(screen.getByTestId("give-return-error")).toBeTruthy();
    expect(screen.getByText(/Your gift is not affected/)).toBeTruthy();
  });

  it("a query string cannot mark anything paid: only the database's state picks the panel", async () => {
    readReturnState.mockResolvedValue({ state: "confirming", giftAmountCents: 2500, coveredCents: 0, fundName: "General Fund", frequency: "once", livemode: true });
    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5", status: "paid", payment_status: "succeeded" }));
    expect(screen.getByTestId("give-return-confirming")).toBeTruthy();
  });
});

describe("PublicGiveReturnPage - a site KEY (Track F)", () => {
  const HOST = "church-one.invalid";
  const hostTarget = (redirectHost: string | null = null) => ({
    slug: "alder-creek",
    urls: buildSiteUrls({ mode: "host", host: HOST, slug: "alder-creek", platformOrigin: "http://localhost:3000" }),
    redirectHost,
  });

  it("on a church's own domain, reads the state for the DB-returned slug and links back at CLEAN paths", async () => {
    resolveGiveSite.mockResolvedValue(hostTarget());
    readReturnState.mockResolvedValue({ state: "failed", livemode: true });

    render(await call(HOST, { session_id: "cs_test_a1B2c3D4e5" }));

    expect(readReturnState).toHaveBeenCalledWith("alder-creek", "cs_test_a1B2c3D4e5");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, String(href)).not.toContain("/site/");
      expect(href, String(href)).not.toContain("alder-creek");
    }
    expect(hrefs).toContain("/give");
  });

  it("NEVER redirects (R6): Stripe's success_url was fixed when the session was created", async () => {
    resolveGiveSite.mockResolvedValue(hostTarget("www.church-one.invalid"));
    readReturnState.mockResolvedValue({ state: "unknown" });

    // Renders in place (no redirect() import is even mocked here, so a redirect would throw a different error).
    render(await call(HOST, { session_id: "cs_test_a1B2c3D4e5" }));

    expect(screen.getByTestId("give-return-unknown")).toBeTruthy();
  });

  it("a key that does not resolve is the neutral notFound(), with no database read", async () => {
    resolveGiveSite.mockResolvedValue(null);

    await expect(call(HOST, { session_id: "cs_test_a1B2c3D4e5" })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(readReturnState).not.toHaveBeenCalled();
  });

  it("on the platform the links keep today's /site/<slug>/... shape", async () => {
    readReturnState.mockResolvedValue({ state: "failed", livemode: true });

    render(await call("alder-creek", { session_id: "cs_test_a1B2c3D4e5" }));

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/site/alder-creek/give");
  });
});
