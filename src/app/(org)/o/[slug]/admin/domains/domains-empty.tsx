import { ClaimForm } from "./claim-form";

/**
 * Before any domain has been claimed (G29). Explains the two paths in plain
 * words, says where the site already lives in the meantime, and offers a
 * "Start" button rather than a bare "No domains". The form is right here so
 * Start is one step, not two.
 */
export function DomainsEmpty({ slug, siteAddress }: { slug: string; siteAddress: string }) {
  return (
    <section
      aria-labelledby="domains-empty-title"
      data-testid="domains-empty"
      className="space-y-5 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 id="domains-empty-title" className="text-xl font-semibold">
        Use your own web address
      </h2>
      <p className="text-base">
        Right now your site works at <strong className="break-words">{siteAddress}</strong>. You can also have it answer
        at an address of your own, like yourchurch.org.
      </p>
      <ul className="list-disc space-y-2 pl-5 text-base">
        <li>
          <strong>Bring a domain you already own.</strong> Enter it below. We&apos;ll give you one record to add at the
          company that manages it, and walk you through the rest.
        </li>
        <li>
          <strong>Get one later.</strong> You don&apos;t need a domain to have a site. When you do buy one, come back
          here and connect it.
        </li>
      </ul>
      <ClaimForm slug={slug} submitLabel="Start" idPrefix="claim-first" />
    </section>
  );
}
