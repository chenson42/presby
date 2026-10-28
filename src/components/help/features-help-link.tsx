import { HelpLink } from "@/components/help/help-link";
import { helpHref } from "@/lib/help/urls";

/**
 * "How features are turned on": the one line the six per-organization toggle-off states
 * add (calendar, Community, job openings, Giving, parish management, website domain;
 * user-help Inc 1, P3-10, Copy C3). Kept as one component so the text and the target
 * live in one place. It is read by every member who reaches a "isn't turned on"
 * sentence, not only an administrator, which is why the target page also says who to ask.
 */
export function FeaturesHelpLink() {
  return (
    <div className="mt-1">
      <HelpLink href={helpHref("turning-features-on-and-off")} className="text-sm">
        How features are turned on
      </HelpLink>
    </div>
  );
}
