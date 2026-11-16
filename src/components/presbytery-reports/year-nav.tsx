import Link from "next/link";

/**
 * Previous / current / next, as plain links (viewing a page is not audited, so
 * `next/link` is fine here). A link is omitted when it would leave 1900 to
 * 2100. Each link is a 44px target.
 */
export function YearNav({
  label,
  prev,
  next,
  ariaLabel,
}: {
  label: string;
  prev: { href: string; text: string } | null;
  next: { href: string; text: string } | null;
  ariaLabel: string;
}) {
  const link = "inline-flex min-h-11 items-center px-2 text-primary underline-offset-4 hover:underline";
  return (
    <nav aria-label={ariaLabel} className="flex flex-wrap items-center gap-3 text-sm">
      {prev ? (
        <Link href={prev.href} className={link}>
          {prev.text}
        </Link>
      ) : null}
      <span className="font-medium">{label}</span>
      {next ? (
        <Link href={next.href} className={link}>
          {next.text}
        </Link>
      ) : null}
    </nav>
  );
}
