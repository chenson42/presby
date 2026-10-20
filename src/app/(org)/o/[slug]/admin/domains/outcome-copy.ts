import type { CheckOutcome } from "@/lib/domains/service";

/**
 * What "Check now" tells the person, per outcome (plain English; provider text
 * is never shown, G30). `tone` picks the toast. PURE so every outcome's copy is
 * unit-tested without a browser; a `Record` over the closed union means a new
 * outcome cannot ship without copy.
 */
export const CHECK_OUTCOME_COPY: Record<CheckOutcome, { tone: "success" | "info" | "error"; message: string }> = {
  verified: { tone: "success", message: "We found your ownership record. We're connecting your domain now." },
  recovered: { tone: "success", message: "Your ownership record is back. Your domain is working again." },
  expired: {
    tone: "error",
    message: "This claim expired before we found the ownership record. You can add the domain again to start over.",
  },
  held_elsewhere: {
    tone: "error",
    message: "This domain is already connected to another organization. Contact support.",
  },
  attached: { tone: "success", message: "Connected. Now securing your site with HTTPS." },
  attach_waiting: { tone: "info", message: "We're still connecting it. Check back in a few minutes." },
  live: { tone: "success", message: "Your site is live on this domain." },
  live_lost: {
    tone: "error",
    message: "This domain stopped answering with your site. Check that your DNS records are still in place.",
  },
  lapsed: {
    tone: "error",
    message: "We can no longer find your ownership record. Put it back to restore your domain.",
  },
  release_requested: { tone: "info", message: "This domain is being released." },
  released: { tone: "info", message: "This domain has been released." },
  removed: { tone: "info", message: "This domain was removed." },
  unchanged: {
    tone: "info",
    message: "Nothing has changed yet. DNS changes can take up to an hour to be seen.",
  },
  deferred: { tone: "info", message: "Checked. There's nothing to do right now." },
};
