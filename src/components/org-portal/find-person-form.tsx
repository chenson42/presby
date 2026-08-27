"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { findPersonAction } from "@/app/(org)/o/[slug]/find-person-action";

/**
 * The find-a-person card. A plain client `<form>` calling the server action
 * directly (Phase 2 note 2: "stay RSC + searchParams, no new API route ...
 * no client round-trip needed at directory scale") — one round trip to
 * resolve zero/one/many/forbidden, then a client-side `router.push()` to
 * whichever href the action decided on. Mirrors
 * `feedback/feedback-form.tsx`'s `useTransition` shape.
 *
 * Both `"redirect"` and `"fallthrough"` outcomes navigate the same way here
 * — the distinction exists in the action's return TYPE for Increment 3's
 * benefit (see `find-person-action.ts`'s header comment), not for this
 * component to branch on.
 */
export function FindPersonForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const trimmed = query.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (trimmed === "" || isPending) return;

    startTransition(async () => {
      try {
        const result = await findPersonAction(slug, trimmed);
        router.push(result.href);
      } catch {
        toast.error("Couldn't search right now. Try again in a moment.");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Label htmlFor="find-person-query">Find a person</Label>
        <Input
          id="find-person-query"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, email, or phone"
          disabled={isPending}
          className="mt-1 min-h-11"
        />
      </div>
      <Button
        type="submit"
        disabled={trimmed === "" || isPending}
        className="min-h-11"
      >
        {isPending ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}
