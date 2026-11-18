import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STATE } from "@/lib/oversight/copy";
import type { ProfileRow } from "@/lib/oversight/reads";
import { FactList } from "./fact-list";
import { ImportedNote } from "./imported-note";
import { LockedSection } from "./locked-section";
import { SectionFrame } from "./section-frame";
import type { SectionState } from "./section-state";
import { SectionLoadError } from "./section-load-error";

/** The Profile section (C2, C3): address, city, county, year organized and phone, or "Nothing is recorded in the profile yet." */
export function ProfileSection({
  slug,
  aboutOrgId,
  state,
}: {
  slug: string;
  aboutOrgId: string;
  state: SectionState<{ profile: ProfileRow | null }>;
}) {
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const profile = state.kind === "ok" ? state.data.profile : null;
  const action =
    state.kind === "ok" ? (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`${recordHref}/profile/edit`}>{profile ? "Edit profile" : "Add profile details"}</Link>
      </Button>
    ) : undefined;
  return (
    <SectionFrame id="profile" title="Profile" action={action}>
      {state.kind === "locked" ? <LockedSection need="manage" /> : null}
      {state.kind === "error" ? <SectionLoadError href={recordHref} /> : null}
      {state.kind === "ok" && profile === null ? <p className="text-sm text-muted-foreground">{STATE.emptyProfile}</p> : null}
      {state.kind === "ok" && profile !== null ? (
        <>
          <FactList
            facts={[
              { label: "Address", value: profile.streetAddress },
              { label: "City", value: profile.city },
              { label: "County", value: profile.county },
              { label: "Year organized", value: profile.yearOrganized === null ? null : String(profile.yearOrganized) },
              { label: "Phone", value: profile.phone },
            ]}
          />
          <ImportedNote provenance={profile.provenance} />
        </>
      ) : null}
    </SectionFrame>
  );
}
