"use client";

import { useRef, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { copyText } from "./domain-copy-button";
import { useHydrated } from "./use-hydrated";

/**
 * "Copy all records as text" plus a `mailto:` link for the person who manages
 * the DNS (G11: that is often not the administrator). The mail is sent by the
 * church's own mail client, never by the platform to an arbitrary address.
 *
 * If the clipboard is unavailable the full text appears in a read-only box,
 * already selected, so it can still be copied by hand.
 */
export function DomainCopyAllButton({
  text,
  mailto,
  idPrefix,
}: {
  text: string;
  mailto: string;
  idPrefix: string;
}) {
  const hydrated = useHydrated();
  const [fallback, setFallback] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  async function onCopy() {
    const ok = await copyText(text);
    if (ok) {
      setFallback(false);
      toast.success("Copied all records.");
      return;
    }
    setFallback(true);
    toast.error("Couldn't copy automatically. The text is selected below; copy it from there.");
    // Selection needs the textarea to exist first.
    setTimeout(() => areaRef.current?.select(), 0);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated} onClick={onCopy}>
          <Copy aria-hidden />
          Copy all records as text
        </Button>
        <Button asChild variant="outline" className="min-h-11">
          <a href={mailto}>
            <Mail aria-hidden />
            Email these to my DNS person
          </a>
        </Button>
      </div>
      {fallback && (
        <div>
          <Label htmlFor={`${idPrefix}-all-text`}>All records, as text</Label>
          <textarea
            id={`${idPrefix}-all-text`}
            ref={areaRef}
            readOnly
            value={text}
            rows={8}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
      )}
    </div>
  );
}
