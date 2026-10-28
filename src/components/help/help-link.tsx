import type { ReactNode } from "react";
import Link from "next/link";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { cn } from "@/lib/utils";

/**
 * The in-app link to a help page (Copy C3, R12): a same-tab link with a 44px target. The `href`
 * comes from `helpHref()` / `plannedHref()` at the call site, so a typo or a pending slug is a
 * compile error there; this component only draws it.
 */
export function HelpLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-11 items-center", DOCUMENT_LINK_CLASS, className)}>
      {children}
    </Link>
  );
}
