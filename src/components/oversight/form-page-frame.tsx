import type { ReactNode } from "react";
import { BackLink } from "./back-link";

/** The frame every form page shares: a back link, the h1, the one-line subtitle, then the form. Constrained width (ui-standards). */
export function FormPageFrame({
  backHref,
  backLabel,
  title,
  presbyteryName,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  presbyteryName: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <BackLink href={backHref}>{backLabel}</BackLink>
        <h1 className="mt-3 text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{presbyteryName}&apos;s own oversight record for this congregation.</p>
      </div>
      {children}
    </section>
  );
}
