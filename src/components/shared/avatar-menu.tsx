"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { signOutAction } from "@/lib/auth/sign-out-action";
import { accountLabel, initialsFrom } from "@/lib/initials";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The avatar menu — IDENTITY, not context.
 *
 * Who am I, my account, the platform surfaces that are a property of ME, and
 * sign out. Nothing about which congregation is on screen; that is the org
 * switcher's job, and the two are separate controls on purpose.
 *
 * THERE IS NO "ORGANIZATION ADMIN" ITEM, and its absence is deliberate rather
 * than forgotten: the destination does not exist until P9, and a menu item that
 * goes nowhere is worse than an absent one.
 *
 * TWO ENTITLEMENTS, NOT ONE (DECISION-044). `canAccessAdmin` is a session claim
 * and is what the Edge enforces on `/admin`; `isPlatformAdmin` is
 * `users.is_platform_admin`, a column, and it gates `/developer`. They are held
 * by the same people today by accident, not by design, and rendering an item
 * the Edge will bounce to `/access-pending` reads as a broken login rather than
 * as a permissions boundary. Both arrive as props: `isPlatformAdmin` MUST be
 * read live by the caller (`readIsPlatformAdmin`) and never cached into a
 * session claim, so that revoking it takes effect now rather than at the next
 * token refresh.
 */

export interface AvatarMenuProps {
  name?: string | null;
  email?: string | null;
  /** Session claim — gates `/admin`. */
  canAccessAdmin: boolean;
  /** `users.is_platform_admin`, read live — gates `/developer`. */
  isPlatformAdmin: boolean;
  /** Where sign-out lands. Omit for the default (`/`, the marketing home) —
   * `(org)/o/[slug]/layout.tsx` passes the org's own public site so leaving
   * the portal doesn't strand the visitor on generic platform chrome. */
  signOutRedirectTo?: string;
}

export function AvatarMenu({
  name,
  email,
  canAccessAdmin,
  isPlatformAdmin,
  signOutRedirectTo,
}: AvatarMenuProps) {
  const initials = initialsFrom(name, email);
  const who = accountLabel(name, email);
  const showPlatform = canAccessAdmin || isPlatformAdmin;

  return (
    <DropdownMenu>
      {/*
       * 44px hit area (WCAG 2.5.5) around a 36px circle. The circle is the thing
       * you see; the button is the thing you can hit with a thumb.
       */}
      <DropdownMenuTrigger
        aria-label={`Account menu for ${who}`}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent active:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-accent disabled:pointer-events-none disabled:opacity-50"
        data-testid="avatar-menu-trigger"
      >
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initials}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="w-64 max-w-[calc(100vw-2rem)]"
      >
        {/*
         * Not a DropdownMenuLabel: this block is two lines with two type sizes,
         * and Label's padding/typography is built for a one-line group heading.
         * It is inert either way — Radix gives it no role and no focus.
         */}
        <div className="px-2 py-1.5">
          {name?.trim() && (
            <p className="truncate text-sm font-medium">{name.trim()}</p>
          )}
          {email && (
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          )}
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/account" className="cursor-pointer">
            Account
          </Link>
        </DropdownMenuItem>

        {showPlatform && (
          <>
            <DropdownMenuSeparator />
            {canAccessAdmin && (
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/admin" className="cursor-pointer">
                  Platform admin
                </Link>
              </DropdownMenuItem>
            )}
            {isPlatformAdmin && (
              <DropdownMenuItem asChild className="min-h-11">
                <Link href="/developer" className="cursor-pointer">
                  Developer
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />
        <form action={signOutAction.bind(null, signOutRedirectTo ?? "/")}>
          <SignOutItem />
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Sign out, unchanged in behavior: a real `<form>` posting to a server action
 * that calls `signOut({ redirectTo: "/" })`.
 *
 * `onSelect` IS PREVENTED AND THAT IS LOAD-BEARING. Radix closes the menu from
 * inside the item's click handler; React flushes that discrete update
 * synchronously, so the `<form>` can be detached from the document BEFORE the
 * browser dispatches `submit` — and a submit event is never fired for a
 * detached form. The menu therefore stays open until the redirect navigates
 * away, which is also the only place the pending state has to live.
 *
 * Its own component because `useFormStatus()` reads the nearest ANCESTOR form,
 * so it cannot be called by the component that renders the form.
 */
function SignOutItem() {
  const { pending } = useFormStatus();

  return (
    <DropdownMenuItem
      asChild
      disabled={pending}
      onSelect={(event) => event.preventDefault()}
      className="min-h-11"
    >
      <button
        type="submit"
        disabled={pending}
        className="w-full cursor-pointer text-left disabled:pointer-events-none disabled:opacity-50"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </DropdownMenuItem>
  );
}
