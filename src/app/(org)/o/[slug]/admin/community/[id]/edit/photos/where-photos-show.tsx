import { PAGE_COPY } from "@/lib/person-photos/copy";
import type { StatusLines } from "@/lib/person-photos/status-lines";

/**
 * "Where photos show" (Copy C2): the directory line, the website line and the
 * listing line. Every sentence was chosen by `reader.ts` from the SQL answers
 * (`presby_person_directory_photo`, `presby_person_public_photo_status`); this
 * component only lays them out. A `null` line is not rendered.
 */
export function WherePhotosShow({ lines }: { lines: StatusLines }) {
  const items = [lines.directory, lines.website, lines.listing].filter((l): l is string => typeof l === "string" && l !== "");
  return (
    <section aria-labelledby="where-photos-show" className="space-y-2">
      <h2 id="where-photos-show" className="text-base font-semibold">
        {PAGE_COPY.whereHeading}
      </h2>
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        {items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
