import type { ReactNode } from "react";
import { BackLink } from "./back-link";

/** The frame every form page shares: a back link, the h1, the presbytery's name, then the form. Constrained width (ui-standards). */
export function FormPageFrame({
  backHref,
  backLabel,
  title,
  presbyteryName,
  subtitle,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  presbyteryName: string;
  /** An optional extra line under the presbytery's name (the change-role page's "Now Chair, since ..."). */
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <BackLink href={backHref}>{backLabel}</BackLink>
        <h1 className="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{presbyteryName}</p>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
