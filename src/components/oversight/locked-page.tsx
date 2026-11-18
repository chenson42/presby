import { BackLink } from "./back-link";
import { LockedSection } from "./locked-section";

/**
 * A form page opened by URL by someone whose keys do not cover it (a manage-only
 * clerk at `/insurance/new`, say): the page's own reader answered `forbidden`
 * inside its transaction, so there is no form and nothing to write. A visible
 * Locked card with the permission named, and a way back.
 */
export function LockedPage({
  title,
  need,
  backHref,
  backLabel,
}: {
  title: string;
  need: "manage" | "finance";
  backHref: string;
  backLabel: string;
}) {
  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <BackLink href={backHref}>{backLabel}</BackLink>
        <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
      </div>
      <LockedSection need={need} />
    </section>
  );
}
