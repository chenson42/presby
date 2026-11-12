// @vitest-environment jsdom
/**
 * T2 - the Spot the scam island (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 Tests T2;
 * the "behaviour spec"). A full run, the score arithmetic, the result copy, focus
 * management, the idempotent reducer, "no link anywhere", and the spies that prove it
 * touches no network, storage or cookie. Native keyboard activation (Enter and Space on a
 * focused button) is not something jsdom emulates: the controls are real `<button>`
 * elements, and the Playwright spec presses the keys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SCENARIOS } from "@/lib/learn/spot-the-scam/content";
import { TRAINER } from "@/lib/learn/spot-the-scam/copy";

// Hydration is a switch here: the gate's own behaviour is DECISION-159's; this file only needs
// "hydrated" and "not yet hydrated".
const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/components/shared/use-hydrated", () => ({
  useHydrated: () => hydrated.value,
}));

import { ScamTrainer } from "./scam-trainer";

const TOTAL = SCENARIOS.length;

const heading = (level: number, name: RegExp | string) => screen.getByRole("heading", { level, name });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

/** Answers the CURRENT message: correctly (the true verdict) or not. */
function answer(index: number, correct: boolean) {
  const scam = SCENARIOS[index]!.isScam;
  const guessScam = correct ? scam : !scam;
  click(guessScam ? TRAINER.somethingsOff : TRAINER.looksGenuine);
}

/** Answers then advances, returning once the next message (or the result) is on screen. */
function step(index: number, correct: boolean) {
  answer(index, correct);
  click(index === TOTAL - 1 ? TRAINER.seeResult : TRAINER.next);
}

let spies: Record<string, ReturnType<typeof vi.fn>>;
let cookieSetter: ReturnType<typeof vi.fn<(value: string) => void>>;

beforeEach(() => {
  hydrated.value = true;
  const fetchSpy = vi.fn(() => Promise.reject(new Error("the island must not fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  const xhrSend = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: beacon,
    configurable: true,
    writable: true,
  });
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  cookieSetter = vi.fn<(value: string) => void>();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
    set: cookieSetter,
  });
  spies = { fetch: fetchSpy, xhrSend, beacon, setItem, getItem };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // @ts-expect-error - remove the own property so the prototype's cookie accessor returns
  delete document.cookie;
});

describe("a full run", () => {
  it("starts at message 1 of 7 with 0 correct and no verdict, and does not steal focus on load", () => {
    render(<ScamTrainer />);
    expect(heading(3, TRAINER.progress(1, TOTAL))).toBeTruthy();
    expect(screen.getByText(TRAINER.correctSoFar(0))).toBeTruthy();
    expect(screen.queryByTestId("reveal")).toBeNull();
    expect(screen.getByRole("button", { name: TRAINER.looksGenuine })).toBeTruthy();
    expect(screen.getByRole("button", { name: TRAINER.somethingsOff })).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });

  it("all seven right: 'Right.' each time, the score counts up, and the perfect result", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL; i += 1) {
      expect(heading(3, TRAINER.progress(i + 1, TOTAL))).toBeTruthy();
      expect(screen.getByText(TRAINER.correctSoFar(i))).toBeTruthy();
      answer(i, true);
      const reveal = screen.getByTestId("reveal");
      expect(reveal.getAttribute("data-correct")).toBe("true");
      expect(heading(4, new RegExp(`^${TRAINER.right.replace(".", "\\.")} `)).textContent).toContain(
        SCENARIOS[i]!.verdictTitle,
      );
      click(i === TOTAL - 1 ? TRAINER.seeResult : TRAINER.next);
    }
    expect(heading(3, TRAINER.resultHeading(TOTAL, TOTAL))).toBeTruthy();
    expect(screen.getByText(TRAINER.perfect)).toBeTruthy();
    expect(screen.queryByText(TRAINER.notPerfect)).toBeNull();
    expect(screen.getByText(TRAINER.printNote)).toBeTruthy();
  });

  it("a mixed run: 'Not quite.' for a miss, the tells and the lesson show either way, the arithmetic is the count of right answers", () => {
    render(<ScamTrainer />);
    const pattern = [true, false, true, true, false, false, true]; // 4 right
    let score = 0;
    pattern.forEach((right, i) => {
      answer(i, right);
      const reveal = screen.getByTestId("reveal");
      expect(reveal.getAttribute("data-correct")).toBe(right ? "true" : "false");
      expect(reveal.textContent).toContain(right ? TRAINER.right : TRAINER.notQuite);
      expect(reveal.textContent).toContain(SCENARIOS[i]!.verdictTitle);
      expect(reveal.textContent).toContain(SCENARIOS[i]!.lesson);
      expect(reveal.textContent).toContain(TRAINER.whatToNotice);
      for (const tell of SCENARIOS[i]!.tells) expect(reveal.textContent).toContain(tell);
      if (right) score += 1;
      click(i === TOTAL - 1 ? TRAINER.seeResult : TRAINER.next);
      if (i < TOTAL - 1) expect(screen.getByText(TRAINER.correctSoFar(score))).toBeTruthy();
    });
    expect(score).toBe(4);
    expect(heading(3, TRAINER.resultHeading(4, TOTAL))).toBeTruthy();
    expect(screen.getByText(TRAINER.notPerfect)).toBeTruthy();
    expect(screen.queryByText(TRAINER.perfect)).toBeNull();
  });

  it("zero right: '0 of 7 correct' and the encouraging line", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL; i += 1) step(i, false);
    expect(heading(3, TRAINER.resultHeading(0, TOTAL))).toBeTruthy();
    expect(screen.getByText(TRAINER.notPerfect)).toBeTruthy();
  });

  it("'Practice again' resets to message 1 with 0 correct, and a second run counts from zero", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL; i += 1) step(i, true);
    click(TRAINER.restart);
    expect(heading(3, TRAINER.progress(1, TOTAL))).toBeTruthy();
    expect(screen.getByText(TRAINER.correctSoFar(0))).toBeTruthy();
    expect(screen.queryByTestId("reveal")).toBeNull();
    for (let i = 0; i < TOTAL; i += 1) step(i, i === 0); // one right
    expect(heading(3, TRAINER.resultHeading(1, TOTAL))).toBeTruthy();
  });

  it("the last message offers 'See your result', every other 'Next message'", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL; i += 1) {
      answer(i, true);
      expect(
        screen.queryByRole("button", {
          name: i === TOTAL - 1 ? TRAINER.next : TRAINER.seeResult,
        }),
      ).toBeNull();
      click(i === TOTAL - 1 ? TRAINER.seeResult : TRAINER.next);
    }
  });
});

describe("what each channel renders", () => {
  it("an email shows From: (name and address) and Subject:; a text shows its header and a bubble; the voicemail shows the transcript, its caption and no recording", () => {
    render(<ScamTrainer />);
    // message 1: email
    const email = screen.getByTestId("message");
    expect(email.getAttribute("data-channel")).toBe("email");
    expect(email.textContent).toContain(TRAINER.from);
    expect(email.textContent).toContain(`<${SCENARIOS[0]!.fromAddress}>`);
    expect(email.textContent).toContain(TRAINER.subject);
    expect(email.textContent).toContain(SCENARIOS[0]!.subject!);
    step(0, true);
    step(1, true);
    // message 3: text
    const text = screen.getByTestId("message");
    expect(text.getAttribute("data-channel")).toBe("text");
    expect(text.textContent).toContain("Text message · A number you don't have saved");
    expect(text.textContent).toContain(SCENARIOS[2]!.body[0]!);
    for (let i = 2; i < TOTAL - 1; i += 1) step(i, true);
    // message 7: voicemail
    const vm = screen.getByTestId("message");
    expect(vm.getAttribute("data-channel")).toBe("voicemail");
    expect(vm.textContent).toContain("Voicemail · 0:41");
    expect(vm.textContent).toContain("Unknown caller");
    expect(vm.textContent).toContain(TRAINER.voicemailCaption);
    expect(vm.textContent).toContain("(crying, out of breath)");
    expect(vm.textContent).toContain(SCENARIOS[6]!.body[0]!);
    expect(vm.querySelector("audio, video, [role='slider'], button")).toBeNull();
  });

  it("the in-message 'button' of the credential-phishing scenario is bracketed plain text, never a control", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < 4; i += 1) step(i, true);
    const msg = screen.getByTestId("message");
    expect(msg.textContent).toContain("[A large button reads: KEEP MY ACCOUNT ACTIVE]");
    expect(msg.querySelector("button, [role='button'], input")).toBeNull();
  });
});

describe("focus is moved deliberately (A6; Phase 2 Note 4)", () => {
  it("answer -> the verdict heading; Next -> the new message heading; last Next -> the result heading; restart -> the message heading", () => {
    render(<ScamTrainer />);
    answer(0, true);
    expect(document.activeElement).toBe(heading(4, /Right\./));
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");

    click(TRAINER.next);
    expect(document.activeElement).toBe(heading(3, TRAINER.progress(2, TOTAL)));

    for (let i = 1; i < TOTAL; i += 1) step(i, true);
    expect(document.activeElement).toBe(heading(3, TRAINER.resultHeading(TOTAL, TOTAL)));

    click(TRAINER.restart);
    expect(document.activeElement).toBe(heading(3, TRAINER.progress(1, TOTAL)));
  });

  it("a miss moves focus to the verdict heading too (it says 'Not quite.')", () => {
    render(<ScamTrainer />);
    answer(0, false);
    expect(document.activeElement).toBe(heading(4, /Not quite\./));
  });

  it("two islands on one page keep independent ids (a bundle may place the slot twice)", () => {
    const { container } = render(
      <>
        <ScamTrainer />
        <ScamTrainer />
      </>,
    );
    const [first, second] = container.querySelectorAll<HTMLElement>("[data-testid='trainer']");
    fireEvent.click(first!.querySelectorAll("button")[0]!);
    // The first island moved to its reveal; the second is still on its first prompt.
    expect(first!.querySelector("[data-testid='reveal']")).not.toBeNull();
    expect(second!.querySelector("[data-testid='reveal']")).toBeNull();
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the reducer ignores what it should", () => {
  it("answering twice in one tick counts once (a double-tap), and the verdict is the first answer's", () => {
    render(<ScamTrainer />);
    const scam = SCENARIOS[0]!.isScam; // true
    const right = screen.getByRole("button", {
      name: scam ? TRAINER.somethingsOff : TRAINER.looksGenuine,
    });
    const wrong = screen.getByRole("button", {
      name: scam ? TRAINER.looksGenuine : TRAINER.somethingsOff,
    });
    act(() => {
      right.click();
      wrong.click();
    });
    expect(screen.getByTestId("reveal").getAttribute("data-correct")).toBe("true");
    click(TRAINER.next);
    expect(screen.getByText(TRAINER.correctSoFar(1))).toBeTruthy();
  });

  it("two clicks on Next in one tick advance once, not twice", () => {
    render(<ScamTrainer />);
    answer(0, true);
    const next = screen.getByRole("button", { name: TRAINER.next });
    act(() => {
      next.click();
      next.click();
    });
    expect(heading(3, TRAINER.progress(2, TOTAL))).toBeTruthy();
    expect(screen.queryByTestId("reveal")).toBeNull();
  });

  it("two clicks on 'See your result' in one tick show the result once and do not run past the end", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL - 1; i += 1) step(i, true);
    answer(TOTAL - 1, true);
    const see = screen.getByRole("button", { name: TRAINER.seeResult });
    act(() => {
      see.click();
      see.click();
    });
    expect(heading(3, TRAINER.resultHeading(TOTAL, TOTAL))).toBeTruthy();
  });
});

describe("nothing is linked, sent or stored (A5, F437)", () => {
  /** Asserts the current DOM holds no anchor and nothing with an href. */
  const noLinks = (where: string) => {
    expect(document.querySelectorAll("a"), `${where}: <a>`).toHaveLength(0);
    expect(document.querySelectorAll("[href]"), `${where}: [href]`).toHaveLength(0);
    expect(document.querySelectorAll("form"), `${where}: <form>`).toHaveLength(0);
    expect(screen.queryAllByRole("link"), `${where}: role=link`).toHaveLength(0);
  };

  it("no <a>, no [href] and no form in any state of a full run: each message, each reveal, the result", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL; i += 1) {
      noLinks(`message ${i + 1}`);
      answer(i, i % 2 === 0);
      noLinks(`reveal ${i + 1}`);
      click(i === TOTAL - 1 ? TRAINER.seeResult : TRAINER.next);
    }
    noLinks("result");
    click(TRAINER.restart);
    noLinks("after restart");
  });

  it("a full run (and a restart) never calls fetch, XMLHttpRequest.send, sendBeacon, Storage or the cookie setter", () => {
    render(<ScamTrainer />);
    for (let i = 0; i < TOTAL; i += 1) step(i, i % 3 !== 0);
    click(TRAINER.restart);
    for (let i = 0; i < TOTAL; i += 1) step(i, true);
    expect(spies.fetch).not.toHaveBeenCalled();
    expect(spies.xhrSend).not.toHaveBeenCalled();
    expect(spies.beacon).not.toHaveBeenCalled();
    expect(spies.setItem).not.toHaveBeenCalled();
    expect(spies.getItem).not.toHaveBeenCalled();
    expect(cookieSetter).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("the spies are live: they would have caught a call (a guard against a vacuous pass)", () => {
    void fetch("/x").catch(() => {});
    window.localStorage.setItem("k", "v");
    document.cookie = "a=b";
    expect(spies.fetch).toHaveBeenCalledTimes(1);
    expect(spies.setItem).toHaveBeenCalledTimes(1);
    expect(cookieSetter).toHaveBeenCalledTimes(1);
    window.localStorage.clear();
  });
});

describe("before hydration (F440, DECISION-159)", () => {
  it("every control is disabled until the page has hydrated, so a tap is never lost silently", () => {
    hydrated.value = false;
    render(<ScamTrainer />);
    const fieldset = document.querySelector("fieldset[data-slot='hydration-gate']") as HTMLFieldSetElement;
    expect(fieldset).not.toBeNull();
    expect(fieldset.disabled).toBe(true);
    const buttons = screen.getAllByRole("button", { hidden: true });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) expect(b.closest("fieldset")?.disabled, b.textContent ?? "").toBe(true);
    // The message text is readable regardless.
    expect(screen.getByTestId("message").textContent).toContain(SCENARIOS[0]!.subject!);
  });

  it("the same controls are enabled once hydrated", () => {
    hydrated.value = true;
    render(<ScamTrainer />);
    expect((document.querySelector("fieldset[data-slot='hydration-gate']") as HTMLFieldSetElement).disabled).toBe(
      false,
    );
  });
});

describe("the controls are native buttons (keyboard operation is the browser's)", () => {
  it("answer, next and restart are <button type=button> elements, so Enter and Space activate them", () => {
    render(<ScamTrainer />);
    for (const b of screen.getAllByRole("button")) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.getAttribute("type")).toBe("button");
    }
    answer(0, true);
    expect(screen.getByRole("button", { name: TRAINER.next }).tagName).toBe("BUTTON");
  });

  it("the island root is print:hidden", () => {
    render(<ScamTrainer />);
    expect(screen.getByTestId("trainer").className).toContain("print:hidden");
  });
});
