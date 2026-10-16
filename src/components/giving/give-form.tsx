"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Turnstile } from "@/components/shared/turnstile";
import { ContactLine } from "@/components/giving/contact-line";
import { TestModeBadge } from "@/components/giving/test-mode-badge";
import { CHECKBOX_CLASSES, FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import { GIVE_FORM_FIELDS, type GiveResult } from "@/lib/giving/give-input";
import {
  GIVE_MESSAGES,
  GIVE_PAGE,
  TEST_MODE_DONOR_DETAIL,
  feePreviewText,
  rateLimitedMessage,
} from "@/lib/giving/giving-copy";
import { formatCents, grossUp, parseAmountToCents, type FeeRates } from "@/lib/giving/money";
import { isCheckoutUrl } from "@/lib/giving/providers/stripe/urls";

/**
 * The give form - docs/work-log/2026-10-15-online-giving.md, Component / Page
 * Plan and Batch 4a's "Contract for 4b". One component for the three places a
 * gift starts: the public `/site/<slug>/give` page, the public `giving` live
 * slot, and the signed-in member page (`mode="member"`, which differs only in
 * that it renders no Turnstile - the action authenticates instead).
 *
 * WHAT THIS FORM DOES NOT DO. It loads no Stripe.js and renders no iframe: the
 * donor leaves for Stripe-hosted Checkout by a top-level redirect, so card and
 * bank data never touch this origin (SAQ-A) and the enforced CSP on the give
 * routes names no Stripe origin. It never sends a total - only a typed amount
 * STRING and booleans; the database computes what is charged. The fee preview
 * below is DISPLAY ONLY (`grossUp`, the same arithmetic as the SQL function,
 * pinned digit for digit by `money.db.test.ts`).
 *
 * Root is `<HydrationGate>` (DECISION-159): it is a money form, and
 * react-hook-form writes `defaultValues` over the live DOM in the hydration
 * commit, so a fund picked or an amount typed before that would be silently
 * replaced by the defaults (F116). Everything, the preset chips and Give
 * included, is inoperable until the page has hydrated.
 *
 * THE IDEMPOTENCY KEY identifies ONE attempt. It is minted on the server for the
 * first render and passed in; this component re-keys with
 * `crypto.randomUUID()` in the result handler (never during render) after every
 * result except `checkout` and `already_started`, because after an `error` or
 * `unavailable` presby has already written the attempt as a dead `failed`
 * intent and a retry under the same key would find it and answer `error` again.
 *
 * Results: `checkout` re-asserts the destination is exactly Stripe's Checkout
 * origin before `window.location.assign` (a tampered or look-alike URL becomes
 * the generic error, never a navigation). Every refusal says whether anything
 * was charged, in `giving-copy.ts`.
 */

// Evaluated at module scope for bundle-time baking, as the sign-in form does.
const turnstileConfigured = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const CHECKOUT_ORIGIN = "https://checkout.stripe.com";
const PRESET_DOLLARS = [25, 50, 100, 250] as const;

export interface GiveFormFund {
  id: string;
  name: string;
}

export interface GiveFormProps {
  mode: "public" | "member";
  /** The server action, already bound to the slug. */
  action: (formData: FormData) => Promise<GiveResult>;
  /** The server-minted idempotency key for the first attempt. */
  initialKey: string;
  funds: GiveFormFund[];
  /** Preselects a fund (the live slot's validated `filter.fund`). */
  defaultFundId?: string;
  cardEnabled: boolean;
  achEnabled: boolean;
  rates: FeeRates;
  minAmountCents: number;
  maxAmountCents: number;
  /** False => the congregation's Stripe account is in test mode: say so above the form. */
  livemode: boolean;
  contactPhone?: string | null;
  /** Namespaces element ids so two forms (or the slot) on one page never collide. */
  idPrefix?: string;
}

type Frequency = "once" | "monthly";
type PayMethod = "card" | "bank";

interface GiveFormValues {
  amount: string;
  fundId: string;
  frequency: Frequency;
  coverFees: boolean;
  method: PayMethod;
  _hp: string;
}

type Banner = { text: string; tone: "problem" | "info" } | null;

export function GiveForm(props: GiveFormProps) {
  const {
    mode,
    action,
    funds,
    cardEnabled,
    achEnabled,
    rates,
    minAmountCents,
    maxAmountCents,
    livemode,
    contactPhone,
    idPrefix = "give",
  } = props;
  const both = cardEnabled && achEnabled;
  const onlyMethod: PayMethod = achEnabled && !cardEnabled ? "bank" : "card";
  const initialFund =
    props.defaultFundId && funds.some((f) => f.id === props.defaultFundId) ? props.defaultFundId : (funds[0]?.id ?? "");

  const [idempotencyKey, setIdempotencyKey] = useState(props.initialKey);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileRound, setTurnstileRound] = useState(0);
  const needsTurnstile = mode === "public" && turnstileConfigured;

  const resolver: Resolver<GiveFormValues> = async (values) => {
    const errors: Record<string, { type: string; message: string }> = {};
    const parsed = parseAmountToCents(values.amount ?? "", "online");
    if (!parsed.ok) {
      const message = {
        empty: GIVE_MESSAGES.amountEmpty,
        format: GIVE_MESSAGES.amountFormat,
        too_small: GIVE_MESSAGES.amountTooSmall,
        too_large: GIVE_MESSAGES.amountTooLarge,
      }[parsed.reason];
      errors.amount = { type: "validation", message };
    } else if (parsed.cents < minAmountCents) {
      errors.amount = { type: "validation", message: GIVE_MESSAGES.amountTooSmall };
    } else if (parsed.cents > maxAmountCents) {
      errors.amount = { type: "validation", message: GIVE_MESSAGES.amountTooLarge };
    }
    if (!funds.some((f) => f.id === values.fundId)) {
      errors.fundId = { type: "validation", message: GIVE_MESSAGES.fund };
    }
    return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
  };

  const form = useForm<GiveFormValues>({
    resolver,
    defaultValues: { amount: "", fundId: initialFund, frequency: "once", coverFees: false, method: "card", _hp: "" },
  });
  const {
    register,
    control,
    setValue,
    setError,
    formState: { errors },
  } = form;

  const amountText = useWatch({ control, name: "amount" }) ?? "";
  const coverFees = useWatch({ control, name: "coverFees" });
  const chosenMethod = useWatch({ control, name: "method" });
  const frequency = useWatch({ control, name: "frequency" });

  const parsedAmount = parseAmountToCents(amountText, "online");
  const feeMethod: PayMethod = both ? chosenMethod : onlyMethod;
  const preview =
    coverFees && parsedAmount.ok
      ? (() => {
          const { totalCents, coveredCents } = grossUp(parsedAmount.cents, feeMethod, rates);
          return feePreviewText(formatCents(parsedAmount.cents), formatCents(coveredCents), formatCents(totalCents));
        })()
      : null;

  // Coming back to this page from Stripe's "back" button restores it from the
  // back/forward cache with the attempt still marked in flight and its key
  // spent. Start a fresh attempt.
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      setSubmitting(false);
      setIdempotencyKey(crypto.randomUUID());
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function buildFormData(values: GiveFormValues): FormData {
    const fd = new FormData();
    fd.set(GIVE_FORM_FIELDS.amount, values.amount.trim());
    fd.set(GIVE_FORM_FIELDS.fundId, values.fundId);
    fd.set(GIVE_FORM_FIELDS.frequency, values.frequency);
    // `coverFees` is "on" when ticked and ABSENT otherwise (the contract).
    if (values.coverFees) fd.set(GIVE_FORM_FIELDS.coverFees, "on");
    // The fee depends on the method, so ticking "cover fees" requires card or
    // bank; otherwise "either" lets Checkout offer both.
    const method: "card" | "bank" | "either" = values.coverFees ? (both ? values.method : onlyMethod) : both ? "either" : onlyMethod;
    fd.set(GIVE_FORM_FIELDS.method, method);
    fd.set(GIVE_FORM_FIELDS.idempotencyKey, idempotencyKey);
    fd.set(GIVE_FORM_FIELDS.honeypot, values._hp);
    if (needsTurnstile && turnstileToken) fd.set(GIVE_FORM_FIELDS.turnstileToken, turnstileToken);
    return fd;
  }

  function freshAttempt() {
    setIdempotencyKey(crypto.randomUUID());
    setSubmitting(false);
    if (needsTurnstile) {
      // A Turnstile token is single-use: draw a new widget for the next try.
      setTurnstileToken("");
      setTurnstileRound((n) => n + 1);
    }
  }

  function handleResult(result: GiveResult) {
    switch (result.kind) {
      case "checkout": {
        let allowed = false;
        try {
          allowed = isCheckoutUrl(result.url) && new URL(result.url).origin === CHECKOUT_ORIGIN;
        } catch {
          allowed = false;
        }
        if (!allowed) {
          setBanner({ text: GIVE_MESSAGES.error, tone: "problem" });
          freshAttempt();
          return;
        }
        // Leave the form busy: the page is about to navigate away.
        window.location.assign(result.url);
        return;
      }
      case "invalid": {
        if (result.field === "amount" || result.field === "fund") {
          setError(result.field === "fund" ? "fundId" : "amount", { type: "server", message: result.message });
        } else {
          setBanner({ text: result.message, tone: "problem" });
        }
        freshAttempt();
        return;
      }
      case "rate_limited":
        setBanner({ text: rateLimitedMessage(result.retryAfterSeconds), tone: "problem" });
        freshAttempt();
        return;
      case "unavailable":
        setBanner({ text: GIVE_MESSAGES.unavailable, tone: "problem" });
        freshAttempt();
        return;
      case "already_started":
        // The key stays spent: that gift's Checkout page is already open somewhere.
        setBanner({ text: GIVE_MESSAGES.alreadyStarted, tone: "info" });
        setSubmitting(false);
        return;
      default:
        setBanner({ text: GIVE_MESSAGES.error, tone: "problem" });
        freshAttempt();
    }
  }

  async function submit(values: GiveFormValues) {
    setBanner(null);
    setSubmitting(true);
    let result: GiveResult;
    try {
      result = await action(buildFormData(values));
    } catch {
      result = { kind: "error" };
    }
    handleResult(result);
  }

  const id = (name: string) => `${idPrefix}-${name}`;
  const submitDisabled = submitting || (needsTurnstile && !turnstileToken);
  const amountError = errors.amount?.message;
  const fundError = errors.fundId?.message;

  return (
    <div className="space-y-4">
      {!livemode && <TestModeBadge detail={TEST_MODE_DONOR_DETAIL} />}
      <p className="text-base text-muted-foreground">{GIVE_PAGE.intro}</p>

      <HydrationGate>
        <form
          onSubmit={form.handleSubmit(submit)}
          className="space-y-6"
          noValidate
          aria-busy={submitting ? true : undefined}
          data-testid="give-form"
        >
          <input type="hidden" name={GIVE_FORM_FIELDS.idempotencyKey} value={idempotencyKey} />

          {/* Honeypot - never visible to, or reachable by, a real visitor. */}
          <div aria-hidden="true" className="absolute left-[-9999px]">
            <label htmlFor={id("hp")}>Leave this field blank</label>
            <input id={id("hp")} type="text" tabIndex={-1} autoComplete="off" {...register("_hp")} />
          </div>

          {banner && (
            <p
              role={banner.tone === "problem" ? "alert" : "status"}
              data-testid="give-banner"
              className="rounded-lg border border-border bg-muted p-3 text-base text-foreground"
            >
              {banner.text}
            </p>
          )}

          <div className="space-y-2">
            <p id={id("presets-label")} className="text-sm font-medium">
              {GIVE_PAGE.presetsLabel}
            </p>
            <div role="group" aria-labelledby={id("presets-label")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRESET_DOLLARS.map((dollars) => {
                const selected = parsedAmount.ok && parsedAmount.cents === dollars * 100;
                return (
                  <Button
                    key={dollars}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    aria-pressed={selected}
                    className="min-h-11"
                    onClick={() => setValue("amount", String(dollars), { shouldValidate: Boolean(amountError) })}
                  >
                    {`$${dollars}`}
                  </Button>
                );
              })}
            </div>
          </div>

          <FormField id={id("amount")} label={GIVE_PAGE.amountLabel} required hint={GIVE_PAGE.amountHint} error={amountError}>
            <Input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="min-h-11"
              {...fieldA11y(id("amount"), amountError, true)}
              {...register("amount")}
            />
          </FormField>

          {funds.length > 1 ? (
            <FormField id={id("fund")} label={GIVE_PAGE.fundLabel} required error={fundError}>
              <NativeSelect {...fieldA11y(id("fund"), fundError)} {...register("fundId")}>
                {funds.map((fund) => (
                  <option key={fund.id} value={fund.id}>
                    {fund.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          ) : (
            // One fund: no choice to make, but the contract still sends its id.
            <input type="hidden" {...register("fundId")} />
          )}

          <div>
            <p id={id("frequency-label")} className="text-sm font-medium">
              {GIVE_PAGE.frequencyLabel}
            </p>
            <div role="radiogroup" aria-labelledby={id("frequency-label")} className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-6">
              {(
                [
                  ["once", GIVE_PAGE.onceLabel],
                  ["monthly", GIVE_PAGE.monthlyLabel],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="inline-flex min-h-11 items-center gap-2 text-base">
                  <input type="radio" value={value} className={CHECKBOX_CLASSES} {...register("frequency")} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={id("cover")} className="inline-flex min-h-11 items-start gap-2 py-2 text-base font-medium">
              <input id={id("cover")} type="checkbox" aria-describedby={id("cover-hint")} className={`${CHECKBOX_CLASSES} mt-0.5 shrink-0`} {...register("coverFees")} />
              {GIVE_PAGE.coverFeesLabel}
            </label>
            <p id={id("cover-hint")} className="text-sm text-muted-foreground">
              {GIVE_PAGE.coverFeesHint}
            </p>
          </div>

          {coverFees && both && (
            <div>
              <p id={id("method-label")} className="text-sm font-medium">
                {GIVE_PAGE.methodLabel}
              </p>
              <p className="text-sm text-muted-foreground">{GIVE_PAGE.methodHint}</p>
              <div role="radiogroup" aria-labelledby={id("method-label")} className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-6">
                {(
                  [
                    ["card", GIVE_PAGE.cardLabel],
                    ["bank", GIVE_PAGE.bankLabel],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="inline-flex min-h-11 items-center gap-2 text-base">
                    <input type="radio" value={value} className={CHECKBOX_CLASSES} {...register("method")} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {coverFees && (
            <div role="status" aria-live="polite" data-testid="give-fee-preview" className="rounded-lg border border-border p-3 text-base">
              {preview ? (
                <>
                  <p className="font-medium">{preview}</p>
                  <p className="text-sm text-muted-foreground">{GIVE_PAGE.feeNote}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{GIVE_PAGE.feeNeedsAmount}</p>
              )}
            </div>
          )}

          {needsTurnstile && (
            <Turnstile
              key={turnstileRound}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken("")}
              onError={() => setTurnstileToken("")}
            />
          )}

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{GIVE_PAGE.giftOnly}</p>
            <p>{GIVE_PAGE.processing}</p>
            {frequency === "monthly" && <p data-testid="give-monthly-note">{GIVE_PAGE.monthly}</p>}
          </div>

          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={submitDisabled} data-testid="give-submit">
            {submitting ? GIVE_PAGE.submitting : GIVE_PAGE.submit}
          </Button>
        </form>
      </HydrationGate>

      <div className="pt-2">
        <ContactLine phone={contactPhone} />
      </div>
    </div>
  );
}
