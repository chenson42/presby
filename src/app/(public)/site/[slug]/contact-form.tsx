"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitContactMessageAction } from "./actions";
import type { ActionResult } from "@/types/actions";

/**
 * `/site/<slug>`'s one client island (Phase 2's own ruling) — the anonymous
 * visitor's contact form. See docs/work-log/2026-08-20-public-sites.md
 * Phase 3, DECISION-083.
 *
 * The hidden `_hp` field is a honeypot: real visitors never see or fill it
 * (`aria-hidden`, off-screen, `tabIndex={-1}`, `autoComplete="off"`) — a bot
 * that fills every field in a scraped form gets a fake success with no
 * signal anything tripped. `submitContactMessageAction` checks it first,
 * before the rate limit or the query-layer call.
 *
 * Toast is a SUPPLEMENT, not the only record of the result — the inline
 * status banner below persists after the toast fades, same discipline
 * `BrandForm` already established for this codebase.
 */

async function submit(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const slug = String(formData.get("__slug") ?? "");
  return submitContactMessageAction(slug, formData);
}

export function ContactForm({ slug }: { slug: string }) {
  const [result, formAction, isPending] = useActionState(
    submit,
    null as ActionResult | null,
  );

  useEffect(() => {
    if (!result) return;
    if (result.ok) {
      toast.success("Message sent.");
    } else {
      toast.error(result.error);
    }
  }, [result]);

  if (result?.ok) {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
      >
        Thanks — your message has been sent. Someone will follow up soon.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="__slug" value={slug} />

      {/* Honeypot — never visible to, or reachable by, a real visitor. */}
      <div aria-hidden="true" className="absolute left-[-9999px]">
        <label htmlFor="_hp">Leave this field blank</label>
        <input
          id="_hp"
          name="_hp"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {result && !result.ok && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {result.error}
        </div>
      )}

      <div>
        <Label htmlFor="contact-name">Name</Label>
        <Input id="contact-name" name="name" type="text" required maxLength={200} />
      </div>

      <div>
        <Label htmlFor="contact-email">Email</Label>
        <Input id="contact-email" name="email" type="email" required maxLength={320} />
      </div>

      <div>
        <Label htmlFor="contact-body">Message</Label>
        <Textarea id="contact-body" name="body" required maxLength={5000} rows={5} />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
