import type { Metadata } from "next";
import { LeaderPanel } from "@/components/learn/leader-panel";
import { SpotTheScamFrame } from "@/components/learn/spot-the-scam-frame";
import { readLeaderLink } from "@/lib/learn/leader-link";
import { ORG_PAGE } from "@/lib/learn/spot-the-scam/copy";
import { gateLearnPage } from "./learn-gate";

/**
 * `/o/<slug>/learn/spot-the-scam` - the practice inside the portal, for any signed-in member of
 * the organization while the toggle is on (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3
 * "API Contract"; DECISION-334). Permission-blind (DECISION-162). The `(org)` contract: the
 * auth sequence lives in the page (`learn-gate.tsx`), the four-way miss is `org-states.tsx`,
 * and `getPlatformDb()` is never touched. The one anonymous `db` read is the leader panel's
 * "is the public address live" (`readLeaderLink`, precedent: careers' `readPlacement`).
 *
 * Read-only: opening this page writes nothing, and the practice stores nothing. No
 * `loading.tsx` (the segment can 404 and a Suspense boundary would flush a 200 first).
 * `noindex` and no auto-linking of the (email-shaped) sender addresses (F439).
 */
export const metadata: Metadata = {
  title: ORG_PAGE.heading,
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export default async function SpotTheScamPortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateLearnPage(slug, `/o/${slug}/learn/spot-the-scam`);
  if (!gate.ok) return gate.node;

  const link = await readLeaderLink(slug);

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-3xl font-semibold">{ORG_PAGE.heading}</h1>
      <SpotTheScamFrame />
      <LeaderPanel link={link} />
    </div>
  );
}
