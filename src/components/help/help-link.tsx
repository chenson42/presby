import type { ReactNode } from "react";
import Link from "next/link";
import { DOCUMENT_LINK_CLASS } from "@/components/shared/markdown-document";
import { cn } from "@/lib/utils";

/**
 * The in-app link to a help page (Copy C3, R12): a same-tab link with a 44px target. The `href`
 * comes from `helpHref()` / `plannedHref()` at the call site, so a typo or a pending slug is a
 * compile error there; this component only draws it.
 */
export function HelpLink({
  href,
  children,
  className,
  rel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** `noreferrer` on a page whose URL carries a credential (`/invite`), belt and braces over its own Referrer-Policy. */
  rel?: string;
}) {
  return (
    <Link href={href} rel={rel} className={cn("inline-flex min-h-11 items-center", DOCUMENT_LINK_CLASS, className)}>
      {children}
    </Link>
  );
}
