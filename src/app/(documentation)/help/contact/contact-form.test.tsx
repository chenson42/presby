// @vitest-environment jsdom
/**
 * The /help/contact island (Phase 3 Test Plan, "The island (jsdom)"). The action and the Turnstile
 * widget are faked: the widget's mount count is how a test tells a remounted widget (a fresh token)
 * from a kept one, and its buttons stand in for Cloudflare's callbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { HelpContactOutcome } from "@/lib/help-contact/contract";
import {
  HELP_CONTACT_EXIT_COPY as EXIT,
  HELP_CONTACT_FORM_COPY as COPY,
  HELP_CONTACT_OUTCOME_COPY as OUTCOME,
} from "@/lib/help-contact/copy";

const action = vi.fn<(formData: FormData) => Promise<HelpContactOutcome>>();
vi.mock("./actions", () => ({ submitHelpContactAction: (fd: FormData) => action(fd) }));

let mounts = 0;
vi.mock("@/components/shared/turnstile", async () => {
  const React = await import("react");
  return {
    Turnstile: ({ onVerify, onError }: { onVerify: (t: string) => void; onError?: () => void }) => {
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <div data-testid="widget">
          <button type="button" onClick={() => onVerify("tok-123")}>
            solve
          </button>
          <button type="button" onClick={() => onError?.()}>
            widget-error
          </button>
        </div>
      );
    },
  };
});

import { ContactForm } from "./contact-form";

const submitButton = () => screen.getByRole("button", { name: /Send message|Sending/ });
const solve = () => fireEvent.click(screen.getByText("solve"));

function fill(over: Partial<Record<"topic" | "name" | "email" | "congregation" | "message", string>> = {}) {
  const v = { topic: "something_else", name: "Pat Example", email: "pat@example.invalid", congregation: "First Example", message: "A perfectly ordinary message.", ...over };
  fireEvent.change(screen.getByLabelText(COPY.topicLabel), { target: { value: v.topic } });
  fireEvent.change(screen.getByLabelText(COPY.nameLabel), { target: { value: v.name } });
  fireEvent.change(screen.getByLabelText(COPY.emailLabel), { target: { value: v.email } });
  fireEvent.change(screen.getByLabelText(COPY.congregationLabel), { target: { value: v.congregation } });
  fireEvent.change(screen.getByLabelText(COPY.messageLabel), { target: { value: v.message } });
  return v;
}

async function send() {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

beforeEach(() => {
  mounts = 0;
  action.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the labels and the static copy (Copy A)", () => {
  it("renders every label and helper from the design", () => {
    render(<ContactForm />);
    for (const label of [COPY.topicLabel, COPY.nameLabel, COPY.emailLabel, COPY.congregationLabel, COPY.messageLabel]) {
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
    expect(screen.getByText(COPY.emailHelper)).toBeTruthy();
    expect(screen.getByText(COPY.messageHelper)).toBeTruthy();
    expect(screen.getByText(COPY.counter(0))).toBeTruthy();
    expect(screen.getByRole("option", { name: COPY.topicPlaceholder })).toBeTruthy();
    for (const label of Object.values(COPY.topics)) expect(screen.getByRole("option", { name: label })).toBeTruthy();
  });

  it("the privacy notice says what is kept, links the privacy policy, and never claims 'we never record your IP'", () => {
    render(<ContactForm />);
    const notice = screen.getByTestId("contact-notice");
    expect(notice.textContent).toBe(`${COPY.noticeLead}${COPY.noticeLinkText}${COPY.noticeTail}`);
    expect(notice.textContent).toContain("We do not store your IP address or browser details with the message.");
    expect(notice.textContent).not.toMatch(/never record/i);
    expect(within(notice).getByRole("link", { name: COPY.noticeLinkText }).getAttribute("href")).toBe("/help/privacy-policy");
  });

  it("uses the right autocomplete, input mode and 16px-safe controls, with real labels (no placeholder standing in)", () => {
    render(<ContactForm />);
    expect(screen.getByLabelText(COPY.nameLabel).getAttribute("autocomplete")).toBe("name");
    const email = screen.getByLabelText(COPY.emailLabel);
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");
    expect(screen.getByLabelText(COPY.congregationLabel).getAttribute("autocomplete")).toBe("organization");
    for (const id of ["contact-name", "contact-email", "contact-congregation", "contact-message"]) {
      expect(document.getElementById(id)!.getAttribute("placeholder")).toBeNull();
    }
    // no native maxLength: it counts UTF-16 units and truncates a paste silently
    expect(screen.getByLabelText(COPY.messageLabel).getAttribute("maxlength")).toBeNull();
  });

  it("is a POST form inside the hydration gate (a pre-hydration native submit must not be a GET)", () => {
    render(<ContactForm />);
    const form = screen.getByTestId("contact-form");
    expect(form.getAttribute("method")).toBe("post");
    expect(form.closest("[data-slot=hydration-gate]")).not.toBeNull();
  });
});

describe("the honeypot (F388)", () => {
  it("is named _hp, off-screen, out of the tab order, autocomplete off, aria-hidden, and starts blank", () => {
    render(<ContactForm />);
    const hp = document.getElementById("contact-hp") as HTMLInputElement;
    expect(hp.name).toBe("_hp");
    expect(hp.tabIndex).toBe(-1);
    expect(hp.getAttribute("autocomplete")).toBe("off");
    expect(hp.getAttribute("aria-hidden")).toBe("true");
    expect(hp.value).toBe("");
    expect(hp.parentElement!.className).toContain("-left-[10000px]");
    expect(hp.parentElement!.className).not.toMatch(/(^|\s)(hidden|invisible)(\s|$)/); // not display:none
    expect(screen.getByText(COPY.honeypotLabel)).toBeTruthy();
  });

  it("an autofilled honeypot is sent even though no change event fired", async () => {
    action.mockResolvedValue({ kind: "sent" });
    render(<ContactForm />);
    fill();
    (document.getElementById("contact-hp") as HTMLInputElement).value = "autofilled";
    solve();
    await send();
    expect((action.mock.calls[0]![0] as FormData).get("_hp")).toBe("autofilled");
  });
});

describe("submit gating", () => {
  it("is disabled until a token exists, with a visible reason; enabled once the check finishes", () => {
    render(<ContactForm />);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(COPY.waiting)).toBeTruthy();
    expect(submitButton().getAttribute("aria-describedby")).toBe("contact-submit-reason");
    solve();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(COPY.waiting)).toBeNull();
  });

  it("is disabled and says Sending while pending, and a second click sends nothing", async () => {
    let finish!: (o: HelpContactOutcome) => void;
    action.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ContactForm />);
    fill();
    solve();
    await send();
    expect(submitButton().textContent).toBe(COPY.buttonPending);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByTestId("contact-form"));
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: "sent" }));
  });

  it("sends the typed fields and the token as a FormData, and nothing a client could use to forge a status", async () => {
    action.mockResolvedValue({ kind: "sent" });
    render(<ContactForm />);
    const v = fill({ topic: "signing_in" });
    solve();
    await send();
    const fd = action.mock.calls[0]![0] as FormData;
    expect(Object.fromEntries(fd.entries())).toEqual({
      topic: "signing_in",
      name: v.name,
      email: v.email,
      congregation: v.congregation,
      message: v.message,
      _hp: "",
      turnstileToken: "tok-123",
    });
  });
});

describe("outcomes (Copy B)", () => {
  it("sent: replaces the form, takes focus, shows the heading and body, no reference number, and links the help index", async () => {
    action.mockResolvedValue({ kind: "sent" });
    render(<ContactForm />);
    fill();
    solve();
    await send();
    const sent = screen.getByTestId("contact-sent");
    expect(sent.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(sent);
    expect(within(sent).getByRole("heading", { name: OUTCOME.sentHeading })).toBeTruthy();
    expect(sent.textContent).toContain(OUTCOME.sentBody);
    expect(sent.textContent).not.toContain(OUTCOME.sentSigningIn);
    expect(sent.textContent).not.toMatch(/reference|ticket|#\d/i);
    expect(within(sent).getByRole("link", { name: "Back to the help index" }).getAttribute("href")).toBe("/help");
    expect(screen.queryByTestId("contact-form")).toBeNull();
  });

  it("sent for the signing-in topic adds the 'a message cannot reset anything' paragraph", async () => {
    action.mockResolvedValue({ kind: "sent" });
    render(<ContactForm />);
    fill({ topic: "signing_in" });
    solve();
    await send();
    expect(screen.getByTestId("contact-sent").textContent).toContain(OUTCOME.sentSigningIn);
  });

  it.each([
    ["check_failed", OUTCOME.checkFailed],
    ["busy", OUTCOME.busy],
    ["not_sent", OUTCOME.notSent],
  ] as const)("%s shows its one string, keeps the typed text, takes focus", async (kind, text) => {
    action.mockResolvedValue({ kind });
    render(<ContactForm />);
    const v = fill();
    solve();
    await send();
    const block = screen.getByTestId(`contact-${kind}`);
    expect(block.getAttribute("role")).toBe("alert");
    expect(block.textContent).toContain(text);
    expect(document.activeElement).toBe(block);
    expect((screen.getByLabelText(COPY.messageLabel) as HTMLTextAreaElement).value).toBe(v.message);
    expect((screen.getByLabelText(COPY.emailLabel) as HTMLInputElement).value).toBe(v.email);
  });

  it("busy carries the exit block; the others do not", async () => {
    action.mockResolvedValue({ kind: "busy" });
    render(<ContactForm />);
    fill();
    solve();
    await send();
    expect(within(screen.getByTestId("contact-busy")).getByTestId("contact-exit").textContent).toContain(EXIT.line1);
    cleanup();
    action.mockResolvedValue({ kind: "not_sent" });
    render(<ContactForm />);
    fill();
    solve();
    await send();
    expect(within(screen.getByTestId("contact-not_sent")).queryByTestId("contact-exit")).toBeNull();
  });

  it("unavailable replaces the form with the unavailable block and its exit", async () => {
    action.mockResolvedValue({ kind: "unavailable" });
    render(<ContactForm />);
    fill();
    solve();
    await send();
    const block = screen.getByTestId("contact-unavailable");
    expect(within(block).getByRole("heading", { name: EXIT.unavailableHeading })).toBeTruthy();
    expect(block.textContent).toContain(EXIT.unavailableBody);
    expect(block.textContent).toContain(EXIT.line1);
    expect(screen.queryByTestId("contact-form")).toBeNull();
  });

  it("a thrown action becomes not_sent and keeps the text", async () => {
    action.mockRejectedValue(new Error("network"));
    render(<ContactForm />);
    const v = fill();
    solve();
    await send();
    expect(screen.getByTestId("contact-not_sent").textContent).toContain(OUTCOME.notSent);
    expect((screen.getByLabelText(COPY.messageLabel) as HTMLTextAreaElement).value).toBe(v.message);
  });
});

describe("invalid: the error summary and the field errors (Copy B)", () => {
  const invalid = (fieldErrors: Extract<HelpContactOutcome, { kind: "invalid" }>["fieldErrors"]): HelpContactOutcome => ({ kind: "invalid", fieldErrors });

  it("the summary takes focus, lists every error as a link to its field, and each field names its error", async () => {
    action.mockResolvedValue(invalid({ topic: "required", email: "bad_format", message: "too_short", name: "too_long", congregation: "too_long" }));
    render(<ContactForm />);
    const v = fill({ topic: "none", email: "nope", message: "short" });
    solve();
    await send();
    const summary = screen.getByTestId("contact-error-summary");
    expect(document.activeElement).toBe(summary);
    expect(summary.getAttribute("role")).toBe("alert");
    expect(summary.textContent).toContain(COPY.errorSummary);
    const links = within(summary).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#contact-topic", "#contact-name", "#contact-email", "#contact-congregation", "#contact-message"]);
    expect(links.map((a) => a.textContent)).toEqual([OUTCOME.topic, OUTCOME.nameTooLong, OUTCOME.emailBadFormat, OUTCOME.congregationTooLong, OUTCOME.messageShort]);
    const email = screen.getByLabelText(COPY.emailLabel);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toContain("contact-email-error");
    expect(document.getElementById("contact-email-error")!.textContent).toBe(OUTCOME.emailBadFormat);
    expect((email as HTMLInputElement).value).toBe(v.email);
  });

  it("maps every (field, code) to its string, and a long message names its length", async () => {
    const cases: [Parameters<typeof invalid>[0], string][] = [
      [{ email: "required" }, OUTCOME.emailRequired],
      [{ email: "too_long" }, OUTCOME.emailTooLong],
      [{ message: "required" }, OUTCOME.messageShort],
      [{ message: "too_long" }, OUTCOME.messageTooLong(2500)],
    ];
    for (const [errors, text] of cases) {
      cleanup();
      action.mockResolvedValue(invalid(errors));
      render(<ContactForm />);
      fill({ message: "m".repeat(2500) });
      solve();
      await send();
      expect(screen.getByTestId("contact-error-summary").textContent, text).toContain(text);
    }
  });

  it("keeps the token: the widget is NOT remounted after invalid, and the button stays enabled", async () => {
    action.mockResolvedValue(invalid({ email: "bad_format" }));
    render(<ContactForm />);
    fill();
    solve();
    expect(mounts).toBe(1);
    await send();
    expect(mounts).toBe(1);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears the summary once the next attempt succeeds", async () => {
    action.mockResolvedValueOnce(invalid({ email: "bad_format" })).mockResolvedValueOnce({ kind: "sent" });
    render(<ContactForm />);
    fill();
    solve();
    await send();
    expect(screen.getByTestId("contact-error-summary")).toBeTruthy();
    await send();
    expect(screen.queryByTestId("contact-error-summary")).toBeNull();
    expect(screen.getByTestId("contact-sent")).toBeTruthy();
  });
});

describe("the token is single-use (edge case 7)", () => {
  it.each(["check_failed", "busy", "not_sent"] as const)("%s remounts the widget and clears the token, so the button is off again", async (kind) => {
    action.mockResolvedValue({ kind });
    render(<ContactForm />);
    fill();
    solve();
    expect(mounts).toBe(1);
    await send();
    expect(mounts).toBe(2);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(COPY.waiting)).toBeTruthy();
  });
});

describe("the counter (Copy A)", () => {
  const live = () => screen.getByTestId("contact-counter-live").textContent;
  const type = (n: number) => fireEvent.change(screen.getByLabelText(COPY.messageLabel), { target: { value: "x".repeat(n) } });

  it("shows the running count in characters, with thousands separators", () => {
    render(<ContactForm />);
    type(1234);
    expect(screen.getByText("1,234 of 2,000 characters")).toBeTruthy();
  });

  it("counts an emoji as one character", () => {
    render(<ContactForm />);
    fireEvent.change(screen.getByLabelText(COPY.messageLabel), { target: { value: "\u{1F600}".repeat(5) } });
    expect(screen.getByText("5 of 2,000 characters")).toBeTruthy();
  });

  it("announces only when it crosses 1,800 and 2,000, never per keystroke", () => {
    render(<ContactForm />);
    type(100);
    expect(live()).toBe("");
    type(1799);
    expect(live()).toBe("");
    type(1800);
    expect(live()).toBe(COPY.counterUsed(1800));
    type(1850);
    expect(live()).toBe(COPY.counterUsed(1800)); // unchanged inside the band
    type(1999);
    expect(live()).toBe(COPY.counterUsed(1800));
    type(2000);
    expect(live()).toBe(COPY.counterLimit);
    type(2100);
    expect(live()).toBe(COPY.counterLimit);
    type(1000);
    expect(live()).toBe(""); // back under: silent
  });

  it("the live region is polite and visually hidden", () => {
    render(<ContactForm />);
    const region = screen.getByTestId("contact-counter-live");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.className).toContain("sr-only");
  });

  it("an over-limit count is marked in text weight and colour, and the visible count is still the number", () => {
    render(<ContactForm />);
    type(2100);
    const count = document.getElementById("contact-message-count")!;
    expect(count.textContent).toBe("2,100 of 2,000 characters");
    expect(count.className).toContain("font-semibold");
  });
});

describe("the check did not load (FC9)", () => {
  it("the widget's own error shows the note with the exit block, and the reason line gives way to it", () => {
    render(<ContactForm />);
    expect(screen.queryByTestId("contact-check-note")).toBeNull();
    fireEvent.click(screen.getByText("widget-error"));
    const note = screen.getByTestId("contact-check-note");
    expect(note.textContent).toContain(EXIT.checkDidNotLoad);
    expect(within(note).getByTestId("contact-exit").textContent).toContain(EXIT.line1);
    expect(screen.queryByText(COPY.waiting)).toBeNull();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("after 8 seconds with no window.turnstile the note appears; before that it does not", () => {
    vi.useFakeTimers();
    render(<ContactForm />);
    act(() => void vi.advanceTimersByTime(7900));
    expect(screen.queryByTestId("contact-check-note")).toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByTestId("contact-check-note")).toBeTruthy();
  });

  it("a script that DID load (window.turnstile is set) is a slow challenge, not a failure: no note", () => {
    vi.useFakeTimers();
    (window as unknown as { turnstile: object }).turnstile = { render: () => "x", remove: () => {} };
    try {
      render(<ContactForm />);
      act(() => void vi.advanceTimersByTime(20_000));
      expect(screen.queryByTestId("contact-check-note")).toBeNull();
    } finally {
      delete (window as unknown as { turnstile?: object }).turnstile;
    }
  });

  it("a token arriving later removes the note", async () => {
    render(<ContactForm />);
    fireEvent.click(screen.getByText("widget-error"));
    expect(screen.getByTestId("contact-check-note")).toBeTruthy();
    solve();
    await waitFor(() => expect(screen.queryByTestId("contact-check-note")).toBeNull());
  });
});
