import { cn } from "@/lib/utils";
import { typeColorClasses } from "@/lib/events/type-palette";

/**
 * A 16px square filled with a category's ink. Decorative only: it always sits
 * beside a text label naming the colour or the type.
 */
export function EventTypeSwatch({
  colorToken,
  className,
}: {
  colorToken: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-4 shrink-0 rounded-sm", typeColorClasses(colorToken).swatch, className)}
    />
  );
}
