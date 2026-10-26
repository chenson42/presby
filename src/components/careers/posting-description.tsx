import { Prose } from "presby-site-kit";

/**
 * A posting's description, rendered by site-kit's own `<Prose>` - the SAME code
 * path the bundle's `prose` blocks use, so there is one markdown renderer
 * (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 D1, DECISION-266). Used by
 * the public posting page AND the staff editor's live preview, so what an author
 * previews is what a visitor reads.
 *
 * WHY A WRAPPER WITH ITS OWN TYPOGRAPHY (D2, finding P3-2). site-kit's stylesheet
 * is keyed on a `.presby-site` ancestor and sized for the first customer's site
 * (its prose `h2` is 4.25rem). This page is not inside that chrome, so nothing
 * styles the headings, lists or links; the wrapper does, with Tailwind arbitrary
 * variants written as full static literals (a template string would not survive
 * the class scanner). It deliberately emits no `.presby-site` class and sets no
 * `dangerouslySetInnerHTML`: `<Prose>` returns React elements and escapes every
 * character the markdown subset does not consume, so `<script>` in a description
 * is inert text (`posting-description.test.tsx`).
 *
 * No `'use client'`: a Server Component on the public page, bundled for the
 * client only where the editor's preview imports it.
 */
export function PostingDescription({ body }: { body: string }) {
  return (
    <div
      data-testid="posting-description"
      className="text-base leading-relaxed [overflow-wrap:anywhere] [&_[data-block=prose]>*+*]:mt-4 [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-6 [&_h3]:text-xl [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mt-1 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_hr]:my-6 [&_hr]:border-border"
    >
      <Prose body={body} />
    </div>
  );
}
