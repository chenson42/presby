import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

/**
 * One choosable destination on the chooser — an organization, or a platform
 * surface.
 *
 * ONE COMPONENT FOR BOTH ON PURPOSE. The organization cards and the Admin /
 * Developer cards are the same gesture ("go here") and must look and behave the
 * same; two components would drift in padding, hover treatment and focus ring
 * within a release, and the brief for this program was explicitly "modern,
 * responsive and consistent".
 *
 * The WHOLE card is the link, so the tap target is the card rather than the
 * words inside it — which is what makes this usable one-handed on a 360px
 * phone. The focus ring sits on the link, not the card, so keyboard users get
 * one ring around the whole target instead of a ring inside a border.
 *
 * `title` is an <h3> rather than <CardTitle>: card titles here sit under the
 * page's <h2> section headings, and the heading level is structure, not size
 * (docs/ui-standards.md → Page Header & Typography).
 */
export function DestinationCard({
  href,
  title,
  badge,
  description,
}: {
  href: string;
  title: string;
  /** Short qualifier — the organization type, or the platform surface's kind. */
  badge: string;
  /** One line of orientation. Omitted on organization cards: see below. */
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 py-5 transition-colors group-hover:border-ring group-hover:bg-accent group-active:bg-accent/70">
        <CardHeader className="gap-2">
          <h3 className="text-base font-semibold leading-snug text-foreground">
            {title}
          </h3>
          <Badge variant="outline" className="w-fit font-normal">
            {badge}
          </Badge>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </CardHeader>
      </Card>
    </Link>
  );
}
