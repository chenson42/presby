// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HelpEntry } from "@/lib/help/types";

const fx = vi.hoisted(() => {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "help-routes-"));
  fs.writeFileSync(path.join(dir, "signing-in.md"), "## Email\n\nSteps. {{contact}}\n\n## Google\n\ntext\n\n## Locked\n\ntext\n");
  fs.writeFileSync(path.join(dir, "first-day.md"), "## One\n\ntext\n");
  fs.writeFileSync(path.join(dir, "waiting.md"), "Not yet.\n");
  const base = { summary: "s", covers: [], labels: [] };
  const pages = [
    { ...base, slug: "signing-in", title: "Signing in", summary: "How to sign in.", order: 10, status: "published", audience: "everyone", verifiedIn: "0.47.0" },
    { ...base, slug: "second", title: "Second page", order: 20, status: "published", audience: "everyone", verifiedIn: "0.47.0" },
    { ...base, slug: "first-day", title: "First day", order: 10, status: "published", audience: "administrator", verifiedIn: "0.47.0", needs: { who: "A church administrator", appliesTo: "congregations" } },
    { ...base, slug: "waiting", title: "Waiting", order: 30, status: "pending", audience: "everyone", verifiedIn: null, requires: "later" },
    { slug: "example-plan", title: "Example plan", summary: "s", order: 10, status: "planned", forWhom: "Example groups", today: "Nothing today.", confirmedOn: "2026-10-26" },
  ];
  return { dir, pages };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/help/registry", () => ({ HELP_PAGES: fx.pages }));
vi.mock("@/lib/help/content", async () => {
  const actual = await vi.importActual<typeof import("@/lib/help/content")>("@/lib/help/content");
  return { ...actual, loadHelpPage: (slug: string) => actual.loadHelpPageFrom(slug, { pages: fx.pages as HelpEntry[], dir: fx.dir }) };
});

import HelpIndexPage, { dynamic as indexDynamic } from "./page";
import HelpPage, { dynamic, dynamicParams, generateMetadata, generateStaticParams } from "./[slug]/page";
import PlannedIndexPage, { metadata as plannedIndexMetadata } from "./planned/page";
import PlannedPage, { generateMetadata as plannedMeta, generateStaticParams as plannedParams } from "./planned/[slug]/page";
import HelpNotFound from "./not-found";

afterEach(cleanup);

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("/help index", () => {
  it("is locked static, with one h1, the intro, the note and groups in order", () => {
    expect(indexDynamic).toBe("error");
    const { container } = render(<HelpIndexPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeTruthy();
    expect(screen.getByText(/written for congregations/)).toBeTruthy();
    expect(screen.getByText(/tell the person who invited you/)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Everyone who signs in", "Church administrators"]);
    // a pending page and a planned page are not in the index
    expect(screen.queryByText("Waiting")).toBeNull();
    expect(screen.queryByText("Example plan")).toBeNull();
  });

  it("links the planned page last", () => {
    render(<HelpIndexPage />);
    const link = screen.getByRole("link", { name: "Planned and not available yet" });
    expect(link.getAttribute("href")).toBe("/help/planned");
    expect(screen.getByText("Things PresbyPortal does not do yet.")).toBeTruthy();
  });
});

describe("/help/[slug]", () => {
  it("is locked static and its static params are the published slugs only (pending excluded)", () => {
    expect(dynamic).toBe("error");
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams()).toEqual([{ slug: "signing-in" }, { slug: "second" }, { slug: "first-day" }]);
  });

  it("renders one h1 from the registry title, the summary, the body with {{contact}} resolved, and the last-checked line", async () => {
    const { container } = render(await HelpPage(params("signing-in")));
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Signing in" })).toBeTruthy();
    expect(screen.getByText("How to sign in.")).toBeTruthy();
    expect(screen.getByText("Steps. Ask the person who invited you.")).toBeTruthy();
    expect(screen.getByText("Last checked against release 0.47.0.")).toBeTruthy();
    expect(screen.getByText("On this page")).toBeTruthy();
    expect(screen.queryByText("What you need")).toBeNull();
  });

  it("shows the Needs block on a page whose entry has one", async () => {
    render(await HelpPage(params("first-day")));
    expect(screen.getByText("What you need")).toBeTruthy();
    expect(screen.getByText("A church administrator")).toBeTruthy();
  });

  it("links previous and next within the audience group", async () => {
    render(await HelpPage(params("signing-in")));
    expect(screen.getByRole("link", { name: "Next: Second page" }).getAttribute("href")).toBe("/help/second");
    expect(screen.queryByRole("link", { name: /^Previous:/ })).toBeNull();
  });

  it("is the same notFound for a pending page, a planned slug, an unknown slug and a traversal string", async () => {
    const errors: string[] = [];
    for (const slug of ["waiting", "example-plan", "no-such-page", "../../etc/passwd", "planned"]) {
      await expect(HelpPage(params(slug))).rejects.toSatisfy((e: { digest?: string }) => {
        errors.push(String(e.digest));
        return String(e.digest).includes("NEXT_HTTP_ERROR_FALLBACK;404") || String(e.digest).includes("NEXT_NOT_FOUND");
      });
    }
    expect(new Set(errors).size).toBe(1);
  });

  it("sets its own title and openGraph, and none for a slug that is not published", async () => {
    const m = await generateMetadata(params("signing-in"));
    expect(m).toMatchObject({ title: "Signing in", description: "How to sign in.", openGraph: { title: "Signing in", description: "How to sign in." } });
    expect(await generateMetadata(params("waiting"))).toEqual({});
  });
});

describe("/help/planned", () => {
  it("lists every placeholder with the fixed label and is noindex", () => {
    expect(plannedIndexMetadata.robots).toEqual({ index: false, follow: false });
    render(<PlannedIndexPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Planned and not available yet" })).toBeTruthy();
    expect(screen.getByText("Planned. Not available yet. There is no date.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Example plan" }).getAttribute("href")).toBe("/help/planned/example-plan");
  });

  it("one planned page: label, who, today, noindex, link to all", async () => {
    render(await PlannedPage(params("example-plan")));
    expect(screen.getByRole("heading", { level: 1, name: "Example plan" })).toBeTruthy();
    expect(screen.getByText("Who it is for: Example groups")).toBeTruthy();
    expect(screen.getByText("Today: Nothing today.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All planned items" }).getAttribute("href")).toBe("/help/planned");
    expect(plannedParams()).toEqual([{ slug: "example-plan" }]);
    expect(await plannedMeta(params("example-plan"))).toMatchObject({ title: "Example plan (planned, not available yet)", robots: { index: false, follow: false } });
  });

  it("an unknown planned slug is a notFound", async () => {
    await expect(PlannedPage(params("no-such"))).rejects.toBeTruthy();
  });
});

describe("/help not-found", () => {
  it("says what happened and links the index", () => {
    render(<HelpNotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn't find that page" })).toBeTruthy();
    expect(screen.getByText("The link may be old or mistyped.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the help index" }).getAttribute("href")).toBe("/help");
  });
});
