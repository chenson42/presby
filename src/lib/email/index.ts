// Public API for @/lib/email. All existing import { ... } from "@/lib/email"
// call sites continue to resolve through this barrel without path changes.

// HTML escaping for member-supplied strings interpolated into email bodies.
// Must be applied to all user-controlled content before HTML interpolation (XSS guard).
export { escapeHtml } from "./escape-html";

// enqueueEmail is the canonical entry point for all outbound email.
// Do NOT call sendEmail() directly from server actions or pages — see DECISION-018.
export {
  enqueueEmail,
  recordDeliveryEvent,
  insertQueueRowInTx,
  attemptQueuedSend,
  cancelQueuedEmail,
  CREDENTIAL_TEMPLATE_KEYS,
  REDACTED_BODY_MARKER,
  isCredentialTemplateKey,
} from "./queue";
export type { EnqueueEmailInput, BatchResult, DeliveryEventType } from "./queue";

// renderEmail builds the only message shape enqueueEmail accepts (DECISION-191).
// Senders import it from "@/lib/email/render" directly, not through this barrel:
// several tests replace the whole barrel with a stub, and the pure giving notice
// must not reach the server-only queue.
export { renderEmail } from "./render";
export type { RenderedEmail, EmailContent, EmailBlock } from "./render";

export type { SendEmailInput } from "./send";

// sendEmail is intentionally NOT re-exported here. It is the raw transport
// used only by queue.ts. Exposing it from the barrel would allow callers to
// bypass the queue — a violation of DECISION-018's invariant.
