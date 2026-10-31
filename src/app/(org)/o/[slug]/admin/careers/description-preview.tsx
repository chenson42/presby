"use client";

import { PostingDescription } from "@/components/careers/posting-description";

/**
 * The editor's live "Preview" (Copy S6): the SAME `PostingDescription` the public
 * posting page renders, over the text as typed. Called "Preview", not "how it will
 * look" - its surroundings (width, fonts) differ from the public page, and the copy
 * does not claim otherwise. Client component only because it is imported by one.
 */
export function DescriptionPreview({ body }: { body: string }) {
  return (
    <section aria-labelledby="description-preview-heading" className="space-y-2" data-testid="description-preview">
      <h3 id="description-preview-heading" className="text-sm font-medium">
        Preview
      </h3>
      <div className="min-h-24 rounded-md border border-border bg-background p-4">
        {body.trim() === "" ? (
          <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
        ) : (
          <PostingDescription body={body} />
        )}
      </div>
    </section>
  );
}
