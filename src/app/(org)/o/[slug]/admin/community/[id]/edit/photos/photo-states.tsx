import { PAGE_COPY } from "@/lib/person-photos/copy";

/**
 * The photos page when the organization's "Photos of people" toggle is off
 * (Copy C2). Names no permission and no flag: from the viewer's seat the
 * feature is simply not on, and the sentence says who can turn it on. The
 * generic forbidden and load-error states are `MembersForbidden` and
 * `MembersLoadError` (heading "Photos"), shared with the rest of Community.
 */
export function PhotosOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{PAGE_COPY.heading}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{PAGE_COPY.off(name)}</p>
    </section>
  );
}
