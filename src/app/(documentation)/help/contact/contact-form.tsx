"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Turnstile } from "@/components/shared/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  HELP_CONTACT_FIELDS as FIELDS,
  HELP_CONTACT_TOPIC_KEYS,
  type FieldCode,
  type HelpContactField,
  type HelpContactOutcome,
  type HelpContactTopic,
} from "@/lib/help-contact/contract";
import {
  HELP_CONTACT_ANNOUNCE_AT,
  HELP_CONTACT_FORM_COPY as COPY,
  HELP_CONTACT_LIMIT_CHARS,
  HELP_CONTACT_OUTCOME_COPY as OUTCOME,
  HELP_CONTACT_EXIT_COPY as EXIT,
} from "@/lib/help-contact/copy";
import { HELP_COPY } from "@/lib/help/copy";
import { HELP_INDEX_HREF, helpHref } from "@/lib/help/urls";
import { charCount } from "@/lib/text-hygiene";
import { cn } from "@/lib/utils";
import { submitHelpContactAction } from "./actions";
import { ContactExit, ContactUnavailable, EXIT_LINK_CLASS } from "./contact-exit";

/**
 * The /help/contact island (Phase 3 "The island", 360px first).
 *
 * NOT `useForm` and NOT an `action={}` prop. Controlled fields held in state, submitted from
 * `onSubmit` with `preventDefault()`: React 19 resets an UNCONTROLLED form after an action prop
 * completes, which would erase the visitor's text on a failure, and only a `sent` outcome may
 * clear it. `check:hydration-gate` matches `useForm`, so it does not apply; the form is wrapped
 * in `<HydrationGate>` anyway and carries `method="post"`, because a pre-hydration native submit
 * of a form with no `action` is a GET of this URL with the typed text in the query string
 * (e2e/help-contact/form.spec.ts pins both).
 *
 * The client checks nothing but the counter: validation is the server's, in one place, and a
 * rejected submission returns BEFORE Turnstile is spent, so the same token is reused after the
 * visitor fixes the field. The widget is remounted (and its token cleared) after every other
 * outcome, because a token is single-use.
 *
 * Imports are held to what H19 walks: nothing server-only, no database, no `next/headers`.
 */

type Failure = Exclude<HelpContactOutcome, { kind: "sent" }>;
type FieldErrors = Partial<Record<HelpContactField, FieldCode>>;

const FIELD_IDS: Record<HelpContactField, string> = {
  topic: "contact-topic",
  name: "contact-name",
  email: "contact-email",
  congregation: "contact-congregation",
  message: "contact-message",
};

/** The one string per (field, code) of Copy B. `messageLength` is the length the visitor submitted. */
function fieldErrorText(field: HelpContactField, code: FieldCode, messageLength: number): string {
  switch (field) {
    case "topic":
      return OUTCOME.topic;
    case "email":
      return code === "bad_format" ? OUTCOME.emailBadFormat : code === "too_long" ? OUTCOME.emailTooLong : OUTCOME.emailRequired;
    case "message":
      return code === "too_long" ? OUTCOME.messageTooLong(messageLength) : OUTCOME.messageShort;
    case "name":
      return OUTCOME.nameTooLong;
    case "congregation":
      return OUTCOME.congregationTooLong;
  }
}

const FIELD_ORDER: HelpContactField[] = ["topic", "name", "email", "congregation", "message"];

const LABEL_CLASS = "block text-base font-medium";
const HELPER_CLASS = "text-sm leading-6 text-muted-foreground";
const ERROR_CLASS = "flex items-start gap-1.5 text-sm font-medium leading-6 text-destructive";
// Same control standard as the Input primitive (border-input bg-background, 16px), plus the
// manual chevron: without appearance-none a native select reads as a different, greyer control.
const SELECT_CLASS =
  "min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-9 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30";
const ALERT_CLASS = "space-y-2 rounded-lg border-2 border-destructive p-4 text-base leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
// Off-screen, not display:none (an autofill that skips hidden fields would never trip it, and a
// screen reader must not find it): F388.
const HONEYPOT_CLASS = "absolute -left-[10000px] top-auto h-px w-px overflow-hidden";

/** The success block: replaces the form, takes focus, shows no reference number and no toast. */
function SentPanel({ topic }: { topic: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="status"
      tabIndex={-1}
      data-testid="contact-sent"
      className="space-y-3 rounded-lg border border-border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <h2 className="flex items-start gap-2 text-xl font-semibold">
        <CheckCircle2 aria-hidden className="mt-1 size-5 shrink-0" />
        {OUTCOME.sentHeading}
      </h2>
      <p className="text-base leading-7">{OUTCOME.sentBody}</p>
      {topic === "signing_in" ? <p className="text-base leading-7">{OUTCOME.sentSigningIn}</p> : null}
      <Link href={HELP_INDEX_HREF} className={cn("inline-flex min-h-11 items-center text-base", EXIT_LINK_CLASS)}>
        {HELP_COPY.backToIndex}
      </Link>
    </div>
  );
}

export function ContactForm() {
  const [topic, setTopic] = useState<string>("none");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [congregation, setCongregation] = useState("");
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [widgetKey, setWidgetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<HelpContactOutcome | null>(null);
  const [submittedLength, setSubmittedLength] = useState(0);
  const [failureRevision, setFailureRevision] = useState(0);
  const [checkNote, setCheckNote] = useState(false);
  const [live, setLive] = useState("");
  const band = useRef<0 | 1 | 2>(0);
  const failureRef = useRef<HTMLDivElement>(null);

  const length = charCount(message);

  // The widget never loaded (a content blocker, a school or church network): say so in words.
  // `window.turnstile` is set by Cloudflare's script, so its absence after 8 s means it did not load;
  // a slow challenge that DID load is left alone. Restarted on every widget mount.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!window.turnstile) setCheckNote(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [widgetKey]);

  // After a failed submit, focus moves to the error summary (invalid) or the failure block.
  useEffect(() => {
    if (failureRevision > 0) failureRef.current?.focus();
  }, [failureRevision]);

  function onMessageChange(value: string) {
    setMessage(value);
    // The visually hidden live region speaks only when the count crosses 1,800 or 2,000, never per keystroke.
    const n = charCount(value);
    const next: 0 | 1 | 2 = n >= HELP_CONTACT_LIMIT_CHARS ? 2 : n >= HELP_CONTACT_ANNOUNCE_AT ? 1 : 0;
    if (next !== band.current) {
      band.current = next;
      setLive(next === 2 ? COPY.counterLimit : next === 1 ? COPY.counterUsed(n) : "");
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || token === "") return;
    // Read the DOM (not the state) so an autofilled honeypot is included even if no change event fired.
    const data = new FormData(event.currentTarget);
    data.set(FIELDS.turnstileToken, token);
    setPending(true);
    setSubmittedLength(length);
    let result: HelpContactOutcome;
    try {
      result = await submitHelpContactAction(data);
    } catch {
      result = { kind: "not_sent" };
    }
    setPending(false);
    setOutcome(result);
    if (result.kind === "sent" || result.kind === "unavailable") return;
    setFailureRevision((n) => n + 1);
    // `invalid` returned before Turnstile spent the token, so it is kept; every other outcome
    // may have spent it, and the widget is remounted for a fresh one.
    if (result.kind !== "invalid") {
      setToken("");
      setWidgetKey((n) => n + 1);
      setCheckNote(false);
    }
  }

  if (outcome?.kind === "sent") return <SentPanel topic={topic} />;
  if (outcome?.kind === "unavailable") return <ContactUnavailable />;

  const failure: Failure | null = outcome;
  const fieldErrors: FieldErrors = failure?.kind === "invalid" ? failure.fieldErrors : {};
  const errorList = FIELD_ORDER.flatMap((field) => {
    const code = fieldErrors[field];
    return code ? [{ field, text: fieldErrorText(field, code, submittedLength) }] : [];
  });

  const describedBy = (field: HelpContactField, ...extra: string[]) =>
    [...extra, fieldErrors[field] ? `${FIELD_IDS[field]}-error` : null].filter(Boolean).join(" ") || undefined;
  const errorFor = (field: HelpContactField) => {
    const code = fieldErrors[field];
    if (!code) return null;
    return (
      <p id={`${FIELD_IDS[field]}-error`} className={ERROR_CLASS}>
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{fieldErrorText(field, code, submittedLength)}</span>
      </p>
    );
  };

  return (
    <HydrationGate>
      <form method="post" onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-xl space-y-5" data-testid="contact-form">
        {failure?.kind === "invalid" ? (
          <div ref={failureRef} role="alert" tabIndex={-1} data-testid="contact-error-summary" className={ALERT_CLASS}>
            <p className="flex items-start gap-2 font-semibold">
              <AlertCircle aria-hidden className="mt-1 size-5 shrink-0" />
              {COPY.errorSummary}
            </p>
            <ul className="list-disc space-y-1 pl-9">
              {errorList.map(({ field, text }) => (
                <li key={field}>
                  <a href={`#${FIELD_IDS[field]}`} className={EXIT_LINK_CLASS}>
                    {text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {failure && failure.kind !== "invalid" ? (
          <div ref={failureRef} role="alert" tabIndex={-1} data-testid={`contact-${failure.kind}`} className={ALERT_CLASS}>
            <p className="flex items-start gap-2">
              <AlertCircle aria-hidden className="mt-1 size-5 shrink-0" />
              <span>
                {failure.kind === "check_failed" ? OUTCOME.checkFailed : failure.kind === "busy" ? OUTCOME.busy : OUTCOME.notSent}
              </span>
            </p>
            {failure.kind === "busy" ? <ContactExit /> : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor={FIELD_IDS.topic} className={LABEL_CLASS}>
            {COPY.topicLabel}
          </label>
          <div className="relative">
            <select
              id={FIELD_IDS.topic}
              name={FIELDS.topic}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              aria-invalid={fieldErrors.topic ? true : undefined}
              aria-describedby={describedBy("topic")}
              className={SELECT_CLASS}
            >
              <option value="none">{COPY.topicPlaceholder}</option>
              {HELP_CONTACT_TOPIC_KEYS.map((key: HelpContactTopic) => (
                <option key={key} value={key}>
                  {COPY.topics[key]}
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          {errorFor("topic")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={FIELD_IDS.name} className={LABEL_CLASS}>
            {COPY.nameLabel}
          </label>
          <Input
            id={FIELD_IDS.name}
            name={FIELDS.name}
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            className="min-h-11"
          />
          {errorFor("name")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={FIELD_IDS.email} className={LABEL_CLASS}>
            {COPY.emailLabel}
          </label>
          <Input
            id={FIELD_IDS.email}
            name={FIELDS.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={describedBy("email", "contact-email-helper")}
            className="min-h-11"
          />
          <p id="contact-email-helper" className={HELPER_CLASS}>
            {COPY.emailHelper}
          </p>
          {errorFor("email")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={FIELD_IDS.congregation} className={LABEL_CLASS}>
            {COPY.congregationLabel}
          </label>
          <Input
            id={FIELD_IDS.congregation}
            name={FIELDS.congregation}
            type="text"
            autoComplete="organization"
            value={congregation}
            onChange={(e) => setCongregation(e.target.value)}
            aria-invalid={fieldErrors.congregation ? true : undefined}
            aria-describedby={describedBy("congregation")}
            className="min-h-11"
          />
          {errorFor("congregation")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={FIELD_IDS.message} className={LABEL_CLASS}>
            {COPY.messageLabel}
          </label>
          {/* No maxLength: a native one counts UTF-16 units and truncates a paste silently. The rule is reject, never truncate. */}
          <Textarea
            id={FIELD_IDS.message}
            name={FIELDS.message}
            rows={8}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            aria-invalid={fieldErrors.message ? true : undefined}
            aria-describedby={describedBy("message", "contact-message-helper", "contact-message-count")}
            className="min-h-44"
          />
          <p id="contact-message-helper" className={HELPER_CLASS}>
            {COPY.messageHelper}
          </p>
          <p id="contact-message-count" className={cn(HELPER_CLASS, length > HELP_CONTACT_LIMIT_CHARS && "font-semibold text-destructive")}>
            {COPY.counter(length)}
          </p>
          <p aria-live="polite" className="sr-only" data-testid="contact-counter-live">
            {live}
          </p>
          {errorFor("message")}
        </div>

        <div className={HONEYPOT_CLASS}>
          <label htmlFor="contact-hp">{COPY.honeypotLabel}</label>
          <input id="contact-hp" name={FIELDS.honeypot} type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" defaultValue="" />
        </div>

        <p className="text-sm leading-6 text-muted-foreground" data-testid="contact-notice">
          {COPY.noticeLead}
          <Link href={helpHref("privacy-policy")} className={EXIT_LINK_CLASS}>
            {COPY.noticeLinkText}
          </Link>
          {COPY.noticeTail}
        </p>

        <div className="space-y-2">
          <div className="min-h-16 max-w-full overflow-hidden">
            <Turnstile key={widgetKey} onVerify={(t) => { setToken(t); if (t) setCheckNote(false); }} onError={() => setCheckNote(true)} />
          </div>
          {checkNote ? (
            <div className="space-y-2 rounded-lg border border-border p-3" data-testid="contact-check-note">
              <p className="text-base leading-7">{EXIT.checkDidNotLoad}</p>
              <ContactExit />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Button type="submit" disabled={pending || token === ""} aria-describedby={token === "" && !checkNote ? "contact-submit-reason" : undefined} className="min-h-11 w-full sm:w-auto">
            {pending ? COPY.buttonPending : COPY.button}
          </Button>
          {token === "" && !pending && !checkNote ? (
            <p id="contact-submit-reason" className={HELPER_CLASS}>
              {COPY.waiting}
            </p>
          ) : null}
        </div>
      </form>
    </HydrationGate>
  );
}
