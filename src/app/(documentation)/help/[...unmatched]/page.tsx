import { notFound } from "next/navigation";

// Every /help URL that is not a published page or a planned placeholder lands here after
// [slug] / planned/[slug] decline it (dynamicParams = false), so all of them get
// help/not-found.tsx. force-dynamic: a miss is never written to the cache (DECISION-293).
export const dynamic = "force-dynamic";

export default function UnmatchedHelpPage(): never {
  notFound();
}
