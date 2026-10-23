#!/usr/bin/env node
/**
 * CI dependency audit: production dependencies, high and critical only.
 *
 * Same gate as `npm audit --omit=dev --audit-level=high`, with one addition: a
 * short, dated list of advisories the operator has accepted temporarily. Each
 * entry names its reason and an expiry date, and an expired entry fails the
 * job, so an exception cannot quietly outlive the fix it is waiting for.
 *
 * Usage: node scripts/ci/audit-prod.mjs
 */
import { execFileSync } from "node:child_process";

const ACCEPTED = [
  {
    id: "GHSA-mrhx-c7xc-m3w5",
    pkg: "zod",
    reason:
      "zod <4.6.6 can exhaust memory on oversized constrained collections. No 3.x fix exists; " +
      "the zod 4 upgrade is in progress (docs/work-log/2026-10-23-zod-4.md). Server-action and " +
      "route bodies are capped at 1 MB, which bounds the input. Operator ruling 2026-10-23.",
    expires: "2026-11-13",
  },
];

const today = new Date().toISOString().slice(0, 10);
const expired = ACCEPTED.filter((a) => a.expires < today);
if (expired.length > 0) {
  for (const a of expired) {
    console.error(`audit-prod: accepted advisory ${a.id} (${a.pkg}) expired on ${a.expires}.`);
  }
  process.exit(1);
}

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8" });
} catch (err) {
  // npm audit exits non-zero whenever it finds anything; the JSON is still on stdout.
  raw = err.stdout;
  if (!raw) throw err;
}
const report = JSON.parse(raw);

const acceptedIds = new Set(ACCEPTED.map((a) => a.id));
const blocking = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  const advisories = (vuln.via ?? []).filter((v) => typeof v === "object");
  for (const adv of advisories) {
    if (adv.severity !== "high" && adv.severity !== "critical") continue;
    const id = String(adv.url ?? "").split("/").pop();
    if (acceptedIds.has(id)) {
      console.log(`audit-prod: accepted ${id} (${name}, ${adv.severity}) until ${ACCEPTED.find((a) => a.id === id).expires}`);
      continue;
    }
    blocking.push(`${name}: ${adv.severity} ${adv.title} ${adv.url}`);
  }
}

if (blocking.length > 0) {
  console.error("audit-prod: high or critical advisories in production dependencies:");
  for (const line of blocking) console.error(`  ${line}`);
  process.exit(1);
}
console.log("audit-prod: no unaccepted high or critical advisories in production dependencies.");
