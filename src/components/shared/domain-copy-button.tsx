"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "./use-hydrated";

/**
 * Copies a value to the clipboard. `navigator.clipboard` needs a secure context
 * and a user gesture; when it is missing or refused (an older phone browser, an
 * embedded webview) the value stays visible and selected so the person can copy
 * it by hand, and the toast says so - a visible fallback, never a silent no-op
 * (Component Plan: copy-button).
 *
 * Disabled until hydrated (CLAUDE.md -> Verify in a Browser): a pre-hydration
 * tap would do nothing, which reads as a broken button.
 *
 * `targetId` names the element that shows the value; the fallback selects its
 * text.
 */

export function selectText(id: string): void {
  const el = typeof document === "undefined" ? null : document.getElementById(id);
  if (!el) return;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

export async function copyText(text: string, targetId?: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (targetId) selectText(targetId);
    return false;
  }
}

export function DomainCopyButton({
  value,
  label,
  targetId,
  children = "Copy",
}: {
  value: string;
  /** What is being copied, for the accessible name: "Copy value of the TXT record". */
  label: string;
  targetId?: string;
  children?: string;
}) {
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);

  async function onClick() {
    const ok = await copyText(value, targetId);
    if (ok) {
      setCopied(true);
      toast.success("Copied.");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Couldn't copy automatically. The text is selected; copy it from there.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="min-h-11 min-w-11"
      disabled={!hydrated}
      onClick={onClick}
      aria-label={`${children} ${label}`}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? "Copied" : children}
    </Button>
  );
}
