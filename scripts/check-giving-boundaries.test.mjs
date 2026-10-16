/**
 * Fixture tests for the giving-boundaries tripwire. Every rule here is
 * "appears nowhere / appears in exactly one file", so on a clean tree each one
 * passes vacuously; a rule nobody has proved works is a rule that drifts. The
 * proof is synthetic files fed straight to checkGivingBoundaries() — which is
 * why it takes an array of { path, content } instead of reading the disk — one
 * violating tree per rule, plus the legal neighbours that must NOT fire, plus
 * one test that the real repository is clean.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import {
  checkGivingBoundaries,
  collectFiles,
  isNoOwnerConnectionZone,
  stripComments,
  STRIPE_CLIENT,
  INGEST_HEALTH_FILE,
  INGEST_PROCESS_FILE,
  CONNECTION_FILE,
  isNoSessionZone,
} from "./check-giving-boundaries.mjs";

/** @param {string} path @param {string} content */
const f = (path, content) => ({ path, content });
const rules = (violations) => violations.map((v) => v.rule);

const CLIENT = STRIPE_CLIENT;

describe("stripComments", () => {
  it("blanks block, line and trailing comments but keeps every newline", () => {
    const src = ['const a = 1; // trailing', "/* block", " still block */ const b = 2;", "// whole line", "const c = 3;"].join("\n");
    const out = stripComments(src);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).not.toContain("trailing");
    expect(out).not.toContain("still block");
    expect(out).not.toContain("whole line");
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
    expect(out).toContain("const c = 3;");
  });

  it("does not mistake a // inside a string for a comment", () => {
    const out = stripComments('const u = "https://example.invalid/x"; import s from "stripe";');
    expect(out).toContain('from "stripe"');
    expect(out).toContain("https://example.invalid/x");
  });
});

// ── B1 — runtime stripe import only in client.ts ────────────────────────────

describe("B1 — the stripe package is imported at runtime only by client.ts", () => {
  it("flags a default import in an ordinary lib file", () => {
    const v = checkGivingBoundaries([f("src/lib/giving/donors.ts", 'import Stripe from "stripe";')]);
    expect(rules(v)).toEqual(["B1"]);
    expect(v[0].line).toBe(1);
  });

  it.each([
    ['import { Stripe } from "stripe";'],
    ["import Stripe from 'stripe';"],
    ['import * as S from "stripe";'],
    ['import "stripe";'],
    ['import Stripe from "stripe/cjs/stripe.core.js";'],
    ['const Stripe = require("stripe");'],
    ['const mod = await import("stripe");'],
    ['export { default } from "stripe";'],
    ['import {\n  Stripe,\n  type Foo,\n} from "stripe";'],
  ])("flags %j", (src) => {
    const v = checkGivingBoundaries([f("src/app/api/webhooks/stripe/route.ts", src)]);
    expect(rules(v)).toContain("B1");
  });

  it("flags a runtime import in a sibling file inside the provider folder (only client.ts is the allowlist)", () => {
    const v = checkGivingBoundaries([
      f("src/lib/giving/providers/stripe/normalize.ts", 'import Stripe from "stripe";'),
    ]);
    expect(rules(v)).toEqual(["B1"]);
  });

  it("treats an inline `type` specifier as a runtime import (conservative: it survives verbatimModuleSyntax)", () => {
    const v = checkGivingBoundaries([
      f("src/lib/giving/providers/stripe/normalize.ts", 'import { type Event } from "stripe";'),
    ]);
    expect(rules(v)).toEqual(["B1"]);
  });

  it("allows the import in client.ts itself", () => {
    expect(checkGivingBoundaries([f(CLIENT, 'import Stripe from "stripe";\nimport "server-only";')])).toEqual([]);
  });

  it("does not fire on a comment, a longer package name, or a stripe-named local", () => {
    expect(
      checkGivingBoundaries([
        f("src/lib/giving/x.ts", '// import Stripe from "stripe"\n/* import S from "stripe" */\nimport s from "stripe-mock";\nconst stripeClient = 1;'),
      ]),
    ).toEqual([]);
  });

  it("does not scan test files", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/x.test.ts", 'import Stripe from "stripe";')])).toEqual([]);
  });
});

// ── B2 — type-only stripe imports stay in the provider folder ───────────────

describe("B2 — a type-only stripe import is legal only inside providers/stripe/**", () => {
  it("allows `import type` in the provider folder", () => {
    expect(
      checkGivingBoundaries([
        f("src/lib/giving/providers/stripe/normalize.ts", 'import type Stripe from "stripe";'),
      ]),
    ).toEqual([]);
    expect(
      checkGivingBoundaries([
        f("src/lib/giving/providers/stripe/status.ts", 'import type { Stripe } from "stripe";\nexport type { Foo } from "stripe";'),
      ]),
    ).toEqual([]);
  });

  it("flags `import type` outside it — the provider-neutral core knows no provider's types", () => {
    const v = checkGivingBoundaries([f("src/lib/giving/types.ts", 'import type Stripe from "stripe";')]);
    expect(rules(v)).toEqual(["B2"]);
    const v2 = checkGivingBoundaries([f("src/components/giving/give-form.tsx", 'import type { Stripe } from "stripe";')]);
    expect(rules(v2)).toEqual(["B2"]);
  });
});

// ── B3 — no owner connection in the money paths ─────────────────────────────

describe("B3 — no owner connection in the giving money paths", () => {
  it("flags getPlatformDb under src/lib/giving/", () => {
    const v = checkGivingBoundaries([
      f("src/lib/giving/ingest/process.ts", 'import { getPlatformDb } from "@/lib/db";\nconst x = getPlatformDb();'),
    ]);
    expect(rules(v)).toEqual(["B3", "B3"]);
    expect(v[0].line).toBe(1);
  });

  it.each([
    "src/lib/giving/gifts.ts",
    "src/app/api/webhooks/stripe/route.ts",
    "src/app/api/cron/giving/route.ts",
    "src/app/api/giving-thing/route.ts",
    "src/app/(org)/o/[slug]/admin/giving/page.tsx",
    "src/app/(org)/o/[slug]/giving/give/actions.ts",
    "src/app/(public)/site/[slug]/give/actions.ts",
  ])("flags it in %s", (p) => {
    expect(rules(checkGivingBoundaries([f(p, "const db = getPlatformDb();")]))).toEqual(["B3"]);
  });

  it.each(["PLATFORM_DATABASE_URL", "MIGRATE_DATABASE_URL"])("flags %s too (reaching the owner URL directly is the same bypass)", (name) => {
    expect(
      rules(checkGivingBoundaries([f("src/lib/giving/x.ts", `const u = process.env.${name};`)])),
    ).toEqual(["B3"]);
  });

  it("allows it outside the zone, including the one owner-only health file", () => {
    for (const p of [
      INGEST_HEALTH_FILE,
      "src/lib/organizations.ts",
      "src/app/(admin)/admin/organizations/[id]/actions.ts",
      "src/lib/testing/giving-fixture.ts",
      "src/app/(org)/o/[slug]/admin/members/page.tsx",
    ]) {
      expect(checkGivingBoundaries([f(p, "const db = getPlatformDb();")]), p).toEqual([]);
    }
  });

  it("exempts test files in the zone and ignores comments", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/two-factor-agreement.test.ts", "const db = getPlatformDb();")])).toEqual([]);
    expect(checkGivingBoundaries([f("src/lib/giving/x.ts", "// never getPlatformDb() here\n/* getPlatformDb */")])).toEqual([]);
  });

  it("isNoOwnerConnectionZone agrees", () => {
    expect(isNoOwnerConnectionZone("src/lib/giving/a.ts")).toBe(true);
    expect(isNoOwnerConnectionZone("src/lib/givingish/a.ts")).toBe(false);
    expect(isNoOwnerConnectionZone("src/app/(org)/o/[slug]/admin/roles/page.tsx")).toBe(false);
  });
});

// ── B4 — the retired platform flag ───────────────────────────────────────────

describe("B4 — the org_portal.giving platform flag is retired (R11)", () => {
  it("flags isFlagEnabled('org_portal.giving') anywhere under src/", () => {
    for (const quote of ['"', "'", "`"]) {
      const v = checkGivingBoundaries([
        f("src/app/(org)/o/[slug]/admin/giving/page.tsx", `const on = await isFlagEnabled(${quote}org_portal.giving${quote});`),
      ]);
      expect(rules(v), quote).toContain("B4");
    }
  });

  it("flags a tile gated on flagKey: 'org_portal.giving'", () => {
    const v = checkGivingBoundaries([
      f("src/lib/org-portal/tiles.ts", '{ key: "giving", flagKey: "org_portal.giving", category: "operate" }'),
    ]);
    expect(rules(v)).toEqual(["B4"]);
  });

  it("flags scripts/seed.ts seeding the flag", () => {
    const v = checkGivingBoundaries([
      f("scripts/seed.ts", '  {\n    key: "org_portal.giving",\n    enabled: true,\n  },'),
    ]);
    expect(rules(v)).toEqual(["B4"]);
    expect(v[0].line).toBe(2);
  });

  it("does NOT fire on the per-org toggle of the same key: catalog key, orgFeatureKey, a lookup by key", () => {
    expect(
      checkGivingBoundaries([
        f(
          "src/lib/org-features.ts",
          '  { key: "org_portal.giving", flag: null },\n  orgFeatureKey: "org_portal.giving",\n  await orgFeatureEnabledInTx(tx, org, "org_portal.giving", false);',
        ),
      ]),
    ).toEqual([]);
  });

  it("does not fire on other org_portal flags or on a seed that doesn't mention giving", () => {
    expect(checkGivingBoundaries([f("src/a.ts", 'isFlagEnabled("org_portal.events")')])).toEqual([]);
    expect(checkGivingBoundaries([f("scripts/seed.ts", 'key: "org_portal.worship"')])).toEqual([]);
  });

  it("does not scan other scripts, and ignores tests and comments", () => {
    expect(checkGivingBoundaries([f("scripts/other.ts", 'key: "org_portal.giving"')])).toEqual([]);
    expect(checkGivingBoundaries([f("src/a.test.ts", 'isFlagEnabled("org_portal.giving")')])).toEqual([]);
    expect(checkGivingBoundaries([f("src/a.ts", '// isFlagEnabled("org_portal.giving") was removed')])).toEqual([]);
  });
});

// ── B5 — a statement notice carries no amounts ───────────────────────────────

describe("B5 — a giving.statement email template and money never share a file", () => {
  const notice = (extra) =>
    `await enqueueEmail({ template: "giving.statement.notice", to: email, data: { orgName } });\n${extra}`;

  it.each(["formatCents(total)", "const a = row.amountCents;", "select amount_cents from x", "const t = totalCents;", "from giving_gifts g", "from giving_statement_lines l"])(
    "flags a notice file that also touches money: %s",
    (extra) => {
      const v = checkGivingBoundaries([f("src/lib/giving/statement-notice.ts", notice(extra))]);
      expect(rules(v)).toEqual(["B5"]);
      expect(v[0].line).toBe(1);
    },
  );

  it("passes a notice file with no money in it", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/statement-notice.ts", notice("const year = 2027;"))])).toEqual([]);
  });

  it("passes money code that never references a statement template", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/gifts.ts", "const a = formatCents(row.amountCents);")])).toEqual([]);
  });

  it("honours `// giving-amounts-ok: <reason>` above the template reference, and only with a reason", () => {
    const ok = "// giving-amounts-ok: renders the preview only, never enqueued\nconst t = 'giving.statement.preview';\nconst a = formatCents(1);";
    expect(checkGivingBoundaries([f("src/lib/giving/x.ts", ok)])).toEqual([]);
    const noReason = "// giving-amounts-ok:\nconst t = 'giving.statement.preview';\nconst a = formatCents(1);";
    expect(rules(checkGivingBoundaries([f("src/lib/giving/x.ts", noReason)]))).toEqual(["B5"]);
  });

  it("does not match the audit action strings (giving_statement, with an underscore)", () => {
    expect(
      checkGivingBoundaries([
        f("src/lib/audit.ts", 'GIVING_STATEMENT_ISSUED: "tenant.giving_statement.issued",\nconst a = amountCents;'),
      ]),
    ).toEqual([]);
  });
});

// ── B6 — the owner-only functions have one caller ───────────────────────────

describe("B6 — presby_giving_ingest_health / presby_giving_dead_letters / presby_giving_requeue_event are called from one file", () => {
  it.each(["presby_giving_ingest_health", "presby_giving_dead_letters", "presby_giving_requeue_event"])("flags %s outside the health file", (fn) => {
    const v = checkGivingBoundaries([f("src/app/(admin)/admin/giving/actions.ts", `await db.execute(sql\`select ${fn}()\`);`)]);
    expect(rules(v)).toEqual(["B6"]);
  });

  it("allows all three in the health file", () => {
    expect(
      checkGivingBoundaries([
        f(INGEST_HEALTH_FILE, "select * from presby_giving_ingest_health();\nselect * from presby_giving_dead_letters(100);\nselect presby_giving_requeue_event(id);"),
      ]),
    ).toEqual([]);
  });

  it("does not fire in a comment or a test", () => {
    expect(checkGivingBoundaries([f("src/lib/db/domain/giving.ts", "// presby_giving_ingest_health() is owner-only")])).toEqual([]);
    expect(checkGivingBoundaries([f("src/lib/db/domain/giving.db.test.ts", "select presby_giving_ingest_health()")])).toEqual([]);
  });

  it("does not fire on the granted sibling functions", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/x.ts", "select presby_giving_attention_events()")])).toEqual([]);
  });
});

// ── B7 — no Stripe origin in the CSP's navigation / script / frame directives ─

const CSP = (value) =>
  `const securityHeaders = [\n  { key: "Content-Security-Policy-Report-Only", value:\n    "${value}" },\n];\n`;
const BASE_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

describe("B7 — no stripe.com in form-action / script-src / frame-src (R7, G30)", () => {
  it("is quiet on today's policy", () => {
    expect(checkGivingBoundaries([f("next.config.ts", CSP(BASE_CSP))])).toEqual([]);
  });

  it.each([
    ["form-action", BASE_CSP.replace("form-action 'self'", "form-action 'self' https://checkout.stripe.com")],
    ["script-src", BASE_CSP.replace("script-src 'self'", "script-src 'self' https://js.stripe.com")],
    ["frame-src", BASE_CSP.replace("frame-src ", "frame-src https://js.stripe.com ")],
    ["default-src", BASE_CSP.replace("default-src 'self'", "default-src 'self' https://*.stripe.com")],
    ["child-src", `${BASE_CSP}; child-src https://hooks.stripe.com`],
    ["script-src-elem", `${BASE_CSP}; script-src-elem https://js.stripe.com`],
  ])("flags a stripe.com origin in %s", (directive, value) => {
    const v = checkGivingBoundaries([f("next.config.ts", CSP(value))]);
    expect(rules(v)).toContain("B7");
    expect(v.find((x) => x.rule === "B7").message).toContain(directive);
  });

  it("flags it in a second, give-route-scoped header entry too (the Batch 4 shape)", () => {
    const src =
      CSP(BASE_CSP) +
      `const giveHeaders = [{ key: "Content-Security-Policy", value: "default-src 'self'; form-action 'self' https://checkout.stripe.com" }];\n`;
    expect(rules(checkGivingBoundaries([f("next.config.ts", src)]))).toContain("B7");
  });

  it("does not fire on a directive that is not navigation, script or frame (img-src)", () => {
    const value = BASE_CSP + "; img-src 'self' https://files.stripe.com";
    expect(checkGivingBoundaries([f("next.config.ts", CSP(value))])).toEqual([]);
  });

  it("does not fire in a comment, or in other files", () => {
    expect(checkGivingBoundaries([f("next.config.ts", "// form-action may never list https://checkout.stripe.com\n")])).toEqual([]);
    expect(checkGivingBoundaries([f("src/lib/giving/x.ts", `const csp = "form-action 'self' https://checkout.stripe.com";`)])).toEqual([]);
  });
});

// ── B8 — no session machinery in the ingest paths ───────────────────────────

describe("B8 — the webhook, the giving cron and ingest/ run with no session and no org context", () => {
  it.each([
    ["src/app/api/webhooks/stripe/route.ts", 'import { auth } from "@/auth";'],
    ["src/app/api/webhooks/stripe/route.ts", "const session = await auth();"],
    ["src/app/api/cron/giving/route.ts", 'import { cachedAuth } from "@/lib/auth/cached-auth";'],
    ["src/lib/giving/ingest/process.ts", "await withOrgContext(personId, orgId, async (tx) => {});"],
    ["src/lib/giving/ingest/functions.ts", 'import { resolveOrgContext } from "@/lib/authz";'],
  ])("flags %s: %s", (path, src) => {
    expect(rules(checkGivingBoundaries([f(path, src)]))).toContain("B8");
  });

  it("allows db, the audit writer and the SECURITY DEFINER wrappers", () => {
    expect(
      checkGivingBoundaries([
        f("src/lib/giving/ingest/functions.ts", 'import { db } from "@/lib/db";\nimport { sql } from "drizzle-orm";'),
        f("src/lib/giving/ingest/process.ts", 'import { recordAudit } from "@/lib/audit";'),
        f("src/app/api/webhooks/stripe/route.ts", 'import { after } from "next/server";'),
      ]),
    ).toEqual([]);
  });

  it("does not fire outside the zone, in a test or in a comment", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/funds.ts", "await withOrgContext(a, b, fn);")])).toEqual([]);
    expect(checkGivingBoundaries([f("src/lib/giving/ingest/process.test.ts", "const s = await auth();")])).toEqual([]);
    expect(checkGivingBoundaries([f("src/lib/giving/ingest/process.ts", "// never call auth() here")])).toEqual([]);
  });

  it("defines the zone as the webhook route, the cron route and ingest/", () => {
    expect(isNoSessionZone("src/app/api/webhooks/stripe/route.ts")).toBe(true);
    expect(isNoSessionZone("src/app/api/cron/giving/route.ts")).toBe(true);
    expect(isNoSessionZone("src/lib/giving/ingest/outcome.ts")).toBe(true);
    expect(isNoSessionZone("src/app/api/cron/maintenance/route.ts")).toBe(false);
    expect(isNoSessionZone("src/lib/giving/connection.ts")).toBe(false);
  });
});

// ── B9 — the allowlist's calls have named callers ───────────────────────────

describe("B9 — retrieveInvoiceForPayment and the account-lifecycle calls have named callers", () => {
  it("flags retrieveInvoiceForPayment anywhere but the processor and the client", () => {
    const v = checkGivingBoundaries([
      f("src/lib/giving/donors.ts", 'import { retrieveInvoiceForPayment } from "./providers/stripe/client";'),
    ]);
    expect(rules(v)).toEqual(["B9"]);
    expect(v[0].message).toContain(INGEST_PROCESS_FILE);
  });

  it("allows retrieveInvoiceForPayment in process.ts and client.ts", () => {
    expect(
      checkGivingBoundaries([
        f(INGEST_PROCESS_FILE, "await retrieveInvoiceForPayment(account, invoice);"),
        f(CLIENT, "export async function retrieveInvoiceForPayment() {}"),
      ]),
    ).toEqual([]);
  });

  it.each(["createConnectedAccount", "createOnboardingLink", "retrieveConnectedAccount"])(
    "flags %s outside connection.ts",
    (fn) => {
      const v = checkGivingBoundaries([f("src/app/(org)/o/[slug]/admin/giving/connect/actions.ts", `await ${fn}({});`)]);
      expect(rules(v)).toEqual(["B9"]);
      expect(v[0].message).toContain(CONNECTION_FILE);
    },
  );

  it("allows the account-lifecycle calls in connection.ts and client.ts", () => {
    expect(
      checkGivingBoundaries([
        f(CONNECTION_FILE, "await createConnectedAccount({}); await createOnboardingLink({}); await retrieveConnectedAccount(id);"),
        f(CLIENT, "export async function createConnectedAccount() {}"),
      ]),
    ).toEqual([]);
  });

  it("does not fire in a test or a comment", () => {
    expect(checkGivingBoundaries([f("src/lib/giving/x.test.ts", "retrieveInvoiceForPayment()")])).toEqual([]);
    expect(checkGivingBoundaries([f("src/lib/giving/x.ts", "// createConnectedAccount is the connect flow's")])).toEqual([]);
  });
});

describe("the real repository", () => {
  it("is clean", async () => {
    const violations = checkGivingBoundaries(await collectFiles());
    expect(violations).toEqual([]);
  });
});
