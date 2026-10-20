// @vitest-environment jsdom
/**
 * The give form (docs/work-log/2026-10-15-online-giving.md, Batch 4b). Pins the
 * contract Batch 4a published: the exact FormData fields, the single-attempt
 * idempotency key and when it is replaced, every `GiveResult` arm, the Checkout
 * origin re-assertion (including the look-alike host), the fee preview agreeing
 * with `grossUp`, the honeypot and Turnstile, the pending state, and the
 * HydrationGate root (DECISION-159). No Stripe.js, no iframe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GiveResult } from "@/lib/giving/give-input";
import { GIVE_MESSAGES, GIVE_PAGE, TEST_MODE_DONOR_DETAIL, rateLimitedMessage } from "@/lib/giving/giving-copy";
import { DEFAULT_RATES, formatCents, grossUp } from "@/lib/giving/money";

const assign = vi.fn();
const realLocation = window.location;
const randomUUID = vi.fn();

vi.mock("@/components/shared/turnstile", () => ({
  Turnstile: ({ onVerify }: { onVerify: (token: string) => void }) => (
    <button type="button" data-testid="turnstile" onClick={() => onVerify("tok-123")}>
      solve
    </button>
  ),
}));

const FUND_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUND_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_1 = "11111111-1111-4111-8111-111111111111";
const KEY_2 = "22222222-2222-4222-8222-222222222222";
const KEY_3 = "33333333-3333-4333-8333-333333333333";
const FUNDS = [
  { id: FUND_A, name: "General Fund" },
  { id: FUND_B, name: "Building Fund" },
];

type Props = Partial<import("./give-form").GiveFormProps>;

async function load() {
  const mod = await import("./give-form");
  return mod.GiveForm;
}

async function renderForm(action: (fd: FormData) => Promise<GiveResult>, props: Props = {}) {
  const GiveForm = await load();
  return render(
    <GiveForm
      mode="public"
      action={action}
      initialKey={KEY_1}
      funds={FUNDS}
      cardEnabled
      achEnabled
      rates={DEFAULT_RATES}
      minAmountCents={100}
      maxAmountCents={2_500_000}
      livemode
      contactPhone="(614) 555-0199"
      {...props}
    />,
  );
}

const amount = () => screen.getByLabelText(/Amount \(US dollars\)/) as HTMLInputElement;
const give = () => screen.getByTestId("give-submit") as HTMLButtonElement;
const type = (value: string) => fireEvent.change(amount(), { target: { value } });
const lastForm = (action: ReturnType<typeof vi.fn>) => action.mock.calls.at(-1)![0] as FormData;

beforeEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
  randomUUID.mockReset();
  randomUUID.mockReturnValueOnce(KEY_2).mockReturnValueOnce(KEY_3);
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => randomUUID() });
});

afterEach(() => {
  cleanup();
  assign.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

describe("GiveForm - structure", () => {
  it("is rooted in a HydrationGate and loads no frame or script of its own", async () => {
    const { container } = await renderForm(vi.fn());
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect(container.querySelector("iframe, script")).toBeNull();
  });

  it("carries the server-minted idempotency key in a hidden input and a honeypot nobody can reach", async () => {
    const { container } = await renderForm(vi.fn());
    expect((container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement).value).toBe(KEY_1);
    const hp = container.querySelector('input[name="_hp"]') as HTMLInputElement;
    expect(hp.type).toBe("text");
    expect(hp.tabIndex).toBe(-1);
    expect(hp.autocomplete).toBe("off");
    expect(hp.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(hp.value).toBe("");
  });

  it("shows the gift-only and processing disclosures, and the church's phone as a tel link", async () => {
    await renderForm(vi.fn());
    expect(screen.getByText(GIVE_PAGE.giftOnly)).toBeTruthy();
    expect(screen.getByText(GIVE_PAGE.processing)).toBeTruthy();
    expect(screen.getByRole("link", { name: "(614) 555-0199" }).getAttribute("href")).toBe("tel:6145550199");
  });

  it("says Test mode in words, in a donor's terms, only when the connection is not live", async () => {
    const { unmount } = await renderForm(vi.fn(), { livemode: false });
    expect(screen.getByTestId("giving-test-mode-badge").textContent).toContain(TEST_MODE_DONOR_DETAIL);
    unmount();
    await renderForm(vi.fn(), { livemode: true });
    expect(screen.queryByTestId("giving-test-mode-badge")).toBeNull();
  });

  it("offers a fund choice for two funds, none (but still sends the id) for one", async () => {
    const action = vi.fn().mockResolvedValue({ kind: "unavailable" });
    const { unmount } = await renderForm(action);
    expect(screen.getByLabelText(/^Fund/)).toBeTruthy();
    unmount();

    await renderForm(action, { funds: [FUNDS[1]!] });
    expect(screen.queryByLabelText(/^Fund/)).toBeNull();
    type("20");
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(lastForm(action).get("fundId")).toBe(FUND_B);
  });

  it("preselects a validated default fund and ignores one that is not on the list", async () => {
    const { unmount } = await renderForm(vi.fn(), { defaultFundId: FUND_B });
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_B);
    unmount();
    await renderForm(vi.fn(), { defaultFundId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_A);
  });
});

describe("GiveForm - amount and fees", () => {
  it("preset chips fill the amount, mark themselves pressed, and 'other' is a decimal text input", async () => {
    await renderForm(vi.fn());
    expect(amount().type).toBe("text");
    expect(amount().inputMode).toBe("decimal");
    fireEvent.click(screen.getByRole("button", { name: "$50" }));
    expect(amount().value).toBe("50");
    expect(screen.getByRole("button", { name: "$50" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "$25" }).getAttribute("aria-pressed")).toBe("false");
    type("37.50");
    expect(screen.getByRole("button", { name: "$50" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("cover-fees defaults off, shows no preview, and reveals card/bank when ticked", async () => {
    await renderForm(vi.fn());
    const cover = screen.getByLabelText(/Add the processing fee/) as HTMLInputElement;
    expect(cover.checked).toBe(false);
    expect(screen.queryByTestId("give-fee-preview")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Card" })).toBeNull();
    fireEvent.click(cover);
    expect(screen.getByRole("radio", { name: "Card" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Bank account" })).toBeTruthy();
  });

  it("the live 'gift + fees = total' line is exactly grossUp() for each method, in dollars", async () => {
    await renderForm(vi.fn());
    type("100");
    fireEvent.click(screen.getByLabelText(/Add the processing fee/));
    const card = grossUp(10_000, "card", DEFAULT_RATES);
    expect(screen.getByTestId("give-fee-preview").textContent).toContain(
      `Your gift $100.00 + fees ${formatCents(card.coveredCents)} = total ${formatCents(card.totalCents)}`,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Bank account" }));
    const bank = grossUp(10_000, "bank", DEFAULT_RATES);
    expect(screen.getByTestId("give-fee-preview").textContent).toContain(
      `fees ${formatCents(bank.coveredCents)} = total ${formatCents(bank.totalCents)}`,
    );
  });

  it("asks for an amount instead of guessing a fee, and uses the organization's own rates", async () => {
    await renderForm(vi.fn(), { rates: { cardBps: 100, cardFixedCents: 0, achBps: 80, achCapCents: 500 } });
    fireEvent.click(screen.getByLabelText(/Add the processing fee/));
    expect(screen.getByTestId("give-fee-preview").textContent).toContain(GIVE_PAGE.feeNeedsAmount);
    type("100");
    const expected = grossUp(10_000, "card", { cardBps: 100, cardFixedCents: 0, achBps: 80, achCapCents: 500 });
    expect(screen.getByTestId("give-fee-preview").textContent).toContain(formatCents(expected.totalCents));
  });

  it("with only one method enabled there is no card/bank choice, and the preview uses that method", async () => {
    await renderForm(vi.fn(), { cardEnabled: false });
    type("100");
    fireEvent.click(screen.getByLabelText(/Add the processing fee/));
    expect(screen.queryByRole("radio", { name: "Card" })).toBeNull();
    expect(screen.getByTestId("give-fee-preview").textContent).toContain(
      formatCents(grossUp(10_000, "bank", DEFAULT_RATES).totalCents),
    );
  });

  it("says how to stop a monthly gift only once monthly is chosen", async () => {
    await renderForm(vi.fn());
    expect(screen.queryByTestId("give-monthly-note")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: GIVE_PAGE.monthlyLabel }));
    expect(screen.getByTestId("give-monthly-note").textContent).toBe(GIVE_PAGE.monthly);
  });
});

describe("GiveForm - what reaches the server", () => {
  it("sends exactly the contract fields: a typed string, ids, flags, the key - and no total", async () => {
    const action = vi.fn().mockResolvedValue({ kind: "unavailable" });
    await renderForm(action);
    type("  37.50 ");
    fireEvent.change(screen.getByLabelText(/^Fund/), { target: { value: FUND_B } });
    fireEvent.click(screen.getByRole("radio", { name: GIVE_PAGE.monthlyLabel }));
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = lastForm(action);
    expect(Object.fromEntries(fd.entries())).toEqual({
      amount: "37.50",
      fundId: FUND_B,
      frequency: "monthly",
      method: "either",
      idempotencyKey: KEY_1,
      _hp: "",
    });
    expect(fd.has("coverFees")).toBe(false);
    expect(fd.has("totalCents")).toBe(false);
  });

  it("covering fees sends coverFees=on with the explicit method (never 'either')", async () => {
    const action = vi.fn().mockResolvedValue({ kind: "unavailable" });
    await renderForm(action);
    type("20");
    fireEvent.click(screen.getByLabelText(/Add the processing fee/));
    fireEvent.click(screen.getByRole("radio", { name: "Bank account" }));
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalled());
    const fd = lastForm(action);
    expect(fd.get("coverFees")).toBe("on");
    expect(fd.get("method")).toBe("bank");
  });

  it("with one method enabled, the method is that one even when not covering fees", async () => {
    const action = vi.fn().mockResolvedValue({ kind: "unavailable" });
    await renderForm(action, { achEnabled: false });
    type("20");
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(lastForm(action).get("method")).toBe("card");
  });

  it("carries a filled honeypot through unchanged (the server answers it)", async () => {
    const action = vi.fn().mockResolvedValue({ kind: "unavailable" });
    const { container } = await renderForm(action);
    fireEvent.change(container.querySelector('input[name="_hp"]')!, { target: { value: "bot" } });
    type("20");
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(lastForm(action).get("_hp")).toBe("bot");
  });

  it.each([
    ["", GIVE_MESSAGES.amountEmpty],
    ["10.999", GIVE_MESSAGES.amountFormat],
    ["1e3", GIVE_MESSAGES.amountFormat],
    ["-5", GIVE_MESSAGES.amountFormat],
    ["٣٠", GIVE_MESSAGES.amountFormat],
    ["0.50", GIVE_MESSAGES.amountTooSmall],
    ["25001", GIVE_MESSAGES.amountTooLarge],
  ])("refuses the amount %j in the browser, with its own sentence, and sends nothing", async (typed, message) => {
    const action = vi.fn();
    await renderForm(action);
    type(typed);
    fireEvent.click(give());
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(action).not.toHaveBeenCalled();
    expect(amount().getAttribute("aria-invalid")).toBe("true");
  });
});

describe("GiveForm - results", () => {
  async function submitWith(result: GiveResult | Promise<GiveResult>, props: Props = {}) {
    const action = vi.fn().mockReturnValue(Promise.resolve(result));
    await renderForm(action, props);
    type("25");
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalled());
    return action;
  }

  it("checkout: navigates to a real Checkout URL and stays busy", async () => {
    await submitWith({ kind: "checkout", url: "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5"));
    expect(give().disabled).toBe(true);
    expect(give().textContent).toBe(GIVE_PAGE.submitting);
  });

  it.each([
    "https://checkout.stripe.com.evil.example/c/pay/cs_test_a1B2c3D4e5",
    "https://evilcheckout.stripe.com/c/pay/x",
    "https://checkout.stripe.com@evil.example/c/pay/x", // leak-ok: hostile userinfo URL test input, not an email
    "https://checkout.stripe.com:8443/c/pay/x",
    "http://checkout.stripe.com/c/pay/x",
    "javascript:alert(1)",
    "https://evil.example/https://checkout.stripe.com/",
    "",
  ])("checkout: refuses to navigate to %j, shows the generic error and starts a fresh attempt", async (url) => {
    await submitWith({ kind: "checkout", url });
    await waitFor(() => expect(screen.getByTestId("give-banner").textContent).toBe(GIVE_MESSAGES.error));
    expect(assign).not.toHaveBeenCalled();
    expect(give().disabled).toBe(false);
  });

  it("invalid (amount): the server's sentence lands on the amount field and the key is replaced", async () => {
    const action = await submitWith({ kind: "invalid", field: "amount", message: GIVE_MESSAGES.amountTooSmall });
    await waitFor(() => expect(screen.getByText(GIVE_MESSAGES.amountTooSmall)).toBeTruthy());
    expect(amount().getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(lastForm(action).get("idempotencyKey")).toBe(KEY_2);
  });

  it("invalid (fund): lands on the fund select", async () => {
    await submitWith({ kind: "invalid", field: "fund", message: GIVE_MESSAGES.fundUnavailable });
    await waitFor(() => expect(screen.getByText(GIVE_MESSAGES.fundUnavailable)).toBeTruthy());
    expect(screen.getByLabelText(/^Fund/).getAttribute("aria-invalid")).toBe("true");
  });

  it("invalid (method/form): shown in the banner", async () => {
    await submitWith({ kind: "invalid", field: "method", message: GIVE_MESSAGES.methodForFees });
    await waitFor(() => expect(screen.getByTestId("give-banner").textContent).toBe(GIVE_MESSAGES.methodForFees));
  });

  it("rate_limited: says how long, and that nothing was charged", async () => {
    await submitWith({ kind: "rate_limited", retryAfterSeconds: 500 });
    await waitFor(() => expect(screen.getByTestId("give-banner").textContent).toBe(rateLimitedMessage(500)));
    expect(screen.getByTestId("give-banner").textContent).toMatch(/9 minutes.*haven't been charged/);
  });

  it("unavailable: says so, and the NEXT submit carries a fresh key (the old attempt is a dead intent)", async () => {
    const action = await submitWith({ kind: "unavailable" });
    await waitFor(() => expect(screen.getByTestId("give-banner").textContent).toBe(GIVE_MESSAGES.unavailable));
    expect(give().disabled).toBe(false);
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[0]![0].get("idempotencyKey")).toBe(KEY_1);
    expect(action.mock.calls[1]![0].get("idempotencyKey")).toBe(KEY_2);
  });

  it("error (also a thrown action): the generic message and a fresh key", async () => {
    const action = vi.fn().mockRejectedValue(new Error("boom"));
    await renderForm(action);
    type("25");
    fireEvent.click(give());
    await waitFor(() => expect(screen.getByTestId("give-banner").textContent).toBe(GIVE_MESSAGES.error));
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(lastForm(action).get("idempotencyKey")).toBe(KEY_2);
  });

  it("already_started: explains, and does NOT replace the key (that gift's Checkout page is already open)", async () => {
    const action = await submitWith({ kind: "already_started" });
    await waitFor(() => expect(screen.getByTestId("give-banner").textContent).toBe(GIVE_MESSAGES.alreadyStarted));
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(lastForm(action).get("idempotencyKey")).toBe(KEY_1);
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("pending: the button is disabled and relabelled while the action is in flight, and a second click is a no-op", async () => {
    let resolve!: (r: GiveResult) => void;
    const action = vi.fn().mockReturnValue(new Promise<GiveResult>((r) => (resolve = r)));
    await renderForm(action);
    type("25");
    fireEvent.click(give());
    await waitFor(() => expect(give().disabled).toBe(true));
    expect(give().textContent).toBe(GIVE_PAGE.submitting);
    fireEvent.click(give());
    expect(action).toHaveBeenCalledTimes(1);
    resolve({ kind: "unavailable" });
    await waitFor(() => expect(give().disabled).toBe(false));
    expect(give().textContent).toBe("Give");
  });
});

describe("GiveForm - Turnstile", () => {
  it("renders no widget and does not gate Give when no site key is configured", async () => {
    await renderForm(vi.fn());
    expect(screen.queryByTestId("turnstile")).toBeNull();
    expect(give().disabled).toBe(false);
  });

  it("with a site key: the widget renders, Give waits for a token, and the token is sent", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key-for-test");
    vi.resetModules();
    const action = vi.fn().mockResolvedValue({ kind: "unavailable" });
    await renderForm(action);
    expect(give().disabled).toBe(true);
    type("25");
    fireEvent.click(screen.getByTestId("turnstile"));
    await waitFor(() => expect(give().disabled).toBe(false));
    fireEvent.click(give());
    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(lastForm(action).get("turnstileToken")).toBe("tok-123");
  });

  it("a member (signed in) gets no widget even when a site key is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key-for-test");
    vi.resetModules();
    await renderForm(vi.fn(), { mode: "member" });
    expect(screen.queryByTestId("turnstile")).toBeNull();
    expect(give().disabled).toBe(false);
  });
});
