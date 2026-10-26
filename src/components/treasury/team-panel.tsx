import { Card, CardContent } from "@/components/ui/card";
import type { ReimbursementActionResult } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import type { ListTreasuryTeamResult } from "@/lib/treasury/team";
import { TeamGrantForm } from "./team-grant-form";
import { TeamGrantList } from "./team-grant-list";
import { TeamSetupButtons, type SetupItem } from "./team-setup-buttons";

/**
 * The treasury team page's body (Copy C9, F296), shared so another module's team
 * page can compose the same three parts: who holds a treasury role, the roles to
 * set up, and the form that gives a role. docs/work-log/2026-10-25-treasury-
 * inc1.md, Phase 3 "Components and libraries to create". The giving team page is
 * NOT refactored onto it (a follow-up TODO line).
 *
 * A server component. The actions arrive as props, already bound to the slug, so
 * this file knows no route. Section headings are `COPY.team` (`Who has a treasury
 * role`, `Roles to set up`); `Give a role` is borrowed from the giving page.
 * The holders list cannot be empty here: the viewer holds the manage key through
 * a grant of a role that carries it, and that grant is listed - so no empty
 * state is written for it.
 */

export type TeamData = Extract<ListTreasuryTeamResult, { kind: "ok" }>;

export function TeamPanel({
  team,
  setupLabels,
  setupDescriptions = {},
  grant,
  revoke,
  ensure,
}: {
  team: TeamData;
  /** The button text for each template key that may be missing. */
  setupLabels: Record<string, string>;
  setupDescriptions?: Record<string, string>;
  grant: (input: { roleId: string; personId: string }) => Promise<ReimbursementActionResult<{ grantId: string }>>;
  revoke: (input: { grantId: string }) => Promise<ReimbursementActionResult>;
  ensure: (input: { templateKey: string }) => Promise<ReimbursementActionResult<{ roleId: string; skippedKeys: string[] }>>;
}) {
  const setup: SetupItem[] = team.missingTemplates
    .filter((key) => setupLabels[key])
    .map((key) => ({ key, label: setupLabels[key]!, description: setupDescriptions[key] }));
  return (
    <div className="space-y-8">
      <section aria-labelledby="team-current" className="space-y-3">
        <h2 id="team-current" className="text-xl font-semibold">
          {COPY.team.sectionHolders}
        </h2>
        <TeamGrantList grants={team.grants} revoke={revoke} />
      </section>

      {setup.length > 0 && (
        <section aria-labelledby="team-setup-heading" className="space-y-3">
          <h2 id="team-setup-heading" className="text-xl font-semibold">
            {COPY.team.sectionSetup}
          </h2>
          <p className="text-sm text-muted-foreground">
            {setup.length === 1 ? COPY.team.panel.setupIntroOne : COPY.team.panel.setupIntroMany}
          </p>
          <TeamSetupButtons items={setup} ensure={ensure} />
        </section>
      )}

      <section aria-labelledby="team-give" className="space-y-3">
        <h2 id="team-give" className="text-xl font-semibold">
          {COPY.team.panel.giveHeading}
        </h2>
        <Card>
          <CardContent>
            <TeamGrantForm roles={team.assignableRoles} people={team.people} grant={grant} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
