import type { Metadata } from "next";

/**
 * The metadata of the neutral 404 (DECISION-040, Phase 2 suggestion 3): no
 * product name in the title, the description or any social tag, and out of
 * every index.
 *
 * It is used in TWO places on purpose. `not-found.tsx` exports it, which is what
 * the SERVER writes into the 404 document's head. But Next also streams the
 * matched tree's resolved metadata inside the page and the browser re-applies it
 * on hydration, and that tree has no `not-found.tsx` in it - so a tab would flip
 * to the root layout's "PresbyPortal" a moment after loading, naming the product
 * to anyone who looks at the title bar of an unclaimed church domain. The
 * segment layout therefore returns the same object from `generateMetadata` when a
 * HOST key does not resolve (`layout.tsx`), which puts it in that streamed tree.
 */
export const NEUTRAL_404_METADATA: Metadata = {
  title: { absolute: "Page not found" },
  description: "The page you were looking for does not exist.",
  robots: { index: false, follow: false },
  // A child's `openGraph` / `twitter` REPLACE the root layout's wholesale (they are not
  // deep-merged), which is what removes the product name from the social tags too.
  openGraph: { title: "Page not found", description: "The page you were looking for does not exist." },
  twitter: { card: "summary", title: "Page not found", description: "The page you were looking for does not exist." },
};
