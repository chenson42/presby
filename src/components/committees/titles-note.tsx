import { TITLES_NOTE } from "@/lib/committees/copy";

/** C3 / C5: the sentence that says titles give no access. */
export function TitlesNote() {
  return <p className="text-sm text-muted-foreground">{TITLES_NOTE}</p>;
}
