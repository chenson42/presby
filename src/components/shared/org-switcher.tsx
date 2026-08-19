"use client";

import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import type { OrganizationType } from "@/lib/authz";
import { organizationTypeLabel } from "@/lib/org-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The organization switcher — CONTEXT, not identity.
 *
 * Google's split, deliberately: the avatar answers "who am I" and this answers
 * "which congregation am I looking at". Fusing them is the tempting shortcut and
 * it is wrong for the same reason it is wrong in Google Cloud — a pastor with
 * two congregations changes CONTEXT many times a session and changes IDENTITY
 * never.
 *
 * FOUR RENDERINGS, and picking between them is the whole component:
 *
 *   1. Nothing at all      — the user belongs to no organization. There is
 *                            nothing to name, and a control naming nothing is
 *                            an invitation to click on an outage.
 *   2. Plain text          — inside the only organization the user has. It is
 *                            the ambient "where am I" indicator, and it has
 *                            nowhere to switch to, so it is not a menu.
 *   3. Plain text          — the organization list could not be READ, but the
 *                            current organization's name is known from another
 *                            source. NEVER an empty dropdown: to a user, a
 *                            picker that opens onto nothing reads as "my access
 *                            was revoked", which is a worse lie than an outage.
 *   4. A dropdown          — the ordinary case.
 *
 * `organizationType` is rendered under each name because two congregations in
 * one presbytery can share most of a name, and because the elder who serves on
 * a presbytery committee needs to tell the presbytery from the church at a
 * glance. It carries NO membership language (DECISION-039): a relationship is
 * not a roll status, and the secretary who worships elsewhere is not a "member"
 * of the church she works for.
 */

export interface SwitchableOrganization {
  slug: string;
  name: string;
  organizationType: OrganizationType;
}

export interface OrgSwitcherProps {
  /**
   * The organization the user is currently inside, or null on a page that has
   * no organization context (`/home`, `/orgs`, the account pages).
   */
  currentName?: string | null;
  /** Slug of the current organization — excluded from the switch list. */
  currentSlug?: string | null;
  /** Every organization the user can actually enter. */
  organizations: SwitchableOrganization[];
  /**
   * The list read FAILED, as opposed to came back empty. The two look identical
   * in the data and must never look identical on screen.
   */
  unavailable?: boolean;
}

// A Radix DropdownMenuTrigger — already the accessible primitive, not a
// hand-rolled imitation of <Button>. Its bespoke 44px touch target sized
// around an icon + truncating name doesn't map onto Button's fixed size
// scale (default/sm/lg/icon). Hoisted to a constant so the ui-ok comment can
// sit directly above the flagged string per check-brand-scope.mjs's
// convention — a JSX comment can't, without rendering as literal page text.
// This file carries e2e structural locators (header-controls.spec.ts:153)
// the P0.5 design doc names explicitly; left otherwise untouched.
// ui-ok: Radix DropdownMenuTrigger with a bespoke 44px touch target, not a hand-rolled button
const SWITCHER_TRIGGER_CLASS = "inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-accent disabled:pointer-events-none disabled:opacity-50";

export function OrgSwitcher({
  currentName = null,
  currentSlug = null,
  organizations,
  unavailable = false,
}: OrgSwitcherProps) {
  const others = organizations.filter((org) => org.slug !== currentSlug);

  // Rendering 3, then 1: a failed read with a known name still says where you
  // are; a failed read with no name says nothing rather than guessing.
  if (unavailable) {
    return currentName ? <CurrentOrgLabel name={currentName} /> : null;
  }

  // Rendering 1 — no relationship anywhere, and no context either.
  if (organizations.length === 0 && !currentName) return null;

  // Rendering 2 — one organization, and you are in it.
  if (currentName && others.length === 0) {
    return <CurrentOrgLabel name={currentName} />;
  }

  const label = currentName ?? "Organizations";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={SWITCHER_TRIGGER_CLASS}
        data-testid="org-switcher-trigger"
      >
        {/*
         * The accessible name is prefixed, not replaced. An aria-label would
         * override the visible text, and a voice-control user saying "click
         * Wrenfield Presbyterian Church" would find nothing to click.
         */}
        {currentName && <span className="sr-only">Current organization: </span>}
        <span className="truncate">{label}</span>
        <ChevronsUpDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      {/*
       * `collisionPadding` keeps the panel off the screen edge at 360px, where
       * a `w-72` menu opened from a trigger 72px in lands flush against the
       * right border and reads as clipped.
       */}
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {currentName ? "Switch organization" : "Your organizations"}
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {others.map((org) => (
            <DropdownMenuItem key={org.slug} asChild className="min-h-11">
              <Link
                href={`/o/${org.slug}`}
                className="flex cursor-pointer flex-col items-start gap-0"
              >
                <span className="w-full truncate font-medium">{org.name}</span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {organizationTypeLabel(org.organizationType)}
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {/*
         * The chooser is not replaced by the picker, it is reached from it.
         * `/orgs` is the only surface that names the organizations still being
         * set up, and those have no portal to switch into.
         */}
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/orgs" className="cursor-pointer">
            All organizations
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The non-interactive form of the control.
 *
 * `truncate` rather than wrap: at 360px "Presbytery of the Eastern Fells" would
 * otherwise push the header to two lines and shove the avatar off the row.
 */
function CurrentOrgLabel({ name }: { name: string }) {
  return (
    <span
      className="min-w-0 truncate px-2 py-1.5 text-sm font-medium text-foreground"
      data-testid="org-switcher-static"
    >
      <span className="sr-only">Current organization: </span>
      {name}
    </span>
  );
}
