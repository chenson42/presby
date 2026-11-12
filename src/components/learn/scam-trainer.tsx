"use client";

import { useEffect, useId, useReducer, useRef } from "react";
import { ArrowRight, CircleAlert, CircleCheck, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { SCENARIOS, type Scenario } from "@/lib/learn/spot-the-scam/content";
import { TRAINER } from "@/lib/learn/spot-the-scam/copy";

/**
 * The Spot the scam practice - the ONE client island in the Learn feature
 * (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3 "The island (`scam-trainer.tsx`),
 * behaviour spec"; DECISION-333, DECISION-336).
 *
 * SEALED. It makes no request, uses no storage or cookie, calls no server action, and
 * renders no link: it imports only `react`, `lucide-react`, the `Button` primitive, the
 * `HydrationGate` and the two pure content files (`boundaries.test.ts` pins the import
 * list and the forbidden tokens, `scam-trainer.test.tsx` spies on every network and
 * storage API). It takes no props and reads the content module directly. A visitor's
 * answers live in this component's state and nowhere else.
 *
 * FOCUS. The pressed button unmounts on every step, so focus is moved deliberately,
 * never left on <body>: after an answer to the verdict heading, after "Next message" and
 * after "Practice again" to the message heading, after the last message to the result
 * heading. The verdict heading IS the announcement (a focus move plus a live region would
 * read twice). The effect has nothing to do on a page load, so a page load never steals
 * focus.
 *
 * STATE IS NEVER COLOUR ALONE (DECISION-336): "Right." and "Not quite." are words, plus
 * an icon, plus a different border (solid `border-primary` vs dashed `border-foreground`),
 * so the difference survives a monochrome printout and a dark brand. Tokens only; nothing
 * smaller than `text-lg`; answer, next and restart are `size="touch"` (44px) and stack at
 * the narrowest widths. The island root is `print:hidden`: only the rules card prints.
 */

interface State {
  index: number;
  /** The visitor's guess that the message is a scam; null until they answer. */
  answered: boolean | null;
  score: number;
  done: boolean;
}

type Action = { type: "answer"; guessIsScam: boolean } | { type: "next" } | { type: "restart" };

const INITIAL: State = { index: 0, answered: null, score: 0, done: false };

/** Pure, and idempotent where it must be: a second answer, or a Next before an answer, changes nothing. */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "answer": {
      if (state.done || state.answered !== null) return state;
      const scenario = SCENARIOS[state.index];
      if (!scenario) return state;
      const correct = action.guessIsScam === scenario.isScam;
      return {
        ...state,
        answered: action.guessIsScam,
        score: state.score + (correct ? 1 : 0),
      };
    }
    case "next": {
      if (state.done || state.answered === null) return state;
      if (state.index >= SCENARIOS.length - 1) return { ...state, done: true };
      return { ...state, index: state.index + 1, answered: null };
    }
    case "restart":
      return INITIAL;
  }
}

type FocusTarget = "message" | "verdict" | "result";

export function ScamTrainer() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const uid = useId();
  const messageHeading = useRef<HTMLHeadingElement>(null);
  const verdictHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  // Runs after every render and does nothing unless an event asked for a focus move.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el =
      target === "message"
        ? messageHeading.current
        : target === "verdict"
          ? verdictHeading.current
          : resultHeading.current;
    el?.focus();
  });

  const total = SCENARIOS.length;
  const scenario = SCENARIOS[state.index];

  const answer = (guessIsScam: boolean) => {
    if (state.answered !== null || state.done) return;
    pendingFocus.current = "verdict";
    dispatch({ type: "answer", guessIsScam });
  };
  const next = () => {
    if (state.answered === null || state.done) return;
    pendingFocus.current = state.index >= total - 1 ? "result" : "message";
    dispatch({ type: "next" });
  };
  const restart = () => {
    pendingFocus.current = "message";
    dispatch({ type: "restart" });
  };

  if (state.done) {
    const perfect = state.score === total;
    return (
      <div className="space-y-4 text-lg print:hidden" data-testid="trainer">
        <section
          aria-labelledby={`${uid}-result`}
          className="space-y-4 rounded-lg border-2 border-primary bg-card p-4 text-card-foreground sm:p-6"
        >
          <p className="font-semibold">{TRAINER.resultEyebrow}</p>
          <h3
            id={`${uid}-result`}
            ref={resultHeading}
            tabIndex={-1}
            className="text-2xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {TRAINER.resultHeading(state.score, total)}
          </h3>
          <p>{perfect ? TRAINER.perfect : TRAINER.notPerfect}</p>
          <p>{TRAINER.printNote}</p>
          <HydrationGate>
            <Button type="button" size="touch" className="w-full text-lg sm:w-auto" onClick={restart}>
              <RotateCcw className="size-5" aria-hidden />
              {TRAINER.restart}
            </Button>
          </HydrationGate>
        </section>
      </div>
    );
  }

  if (!scenario) return null;
  const answered = state.answered !== null;
  const correct = answered && state.answered === scenario.isScam;
  const isLast = state.index >= total - 1;

  return (
    <div className="space-y-4 text-lg print:hidden" data-testid="trainer">
      <div className="space-y-1">
        <h3
          ref={messageHeading}
          tabIndex={-1}
          className="text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {TRAINER.progress(state.index + 1, total)}
        </h3>
        <p className="text-muted-foreground">{TRAINER.correctSoFar(state.score)}</p>
      </div>

      <MessageView scenario={scenario} />

      {!answered ? (
        <div className="space-y-3">
          <p id={`${uid}-prompt`} className="font-semibold">
            {TRAINER.prompt}
          </p>
          <HydrationGate>
            <div role="group" aria-labelledby={`${uid}-prompt`} className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" size="touch" className="w-full text-lg sm:w-auto" onClick={() => answer(false)}>
                {TRAINER.looksGenuine}
              </Button>
              <Button type="button" size="touch" className="w-full text-lg sm:w-auto" onClick={() => answer(true)}>
                {TRAINER.somethingsOff}
              </Button>
            </div>
          </HydrationGate>
        </div>
      ) : (
        <section
          aria-labelledby={`${uid}-verdict`}
          className={
            correct
              ? "space-y-4 rounded-lg border-2 border-solid border-primary bg-card p-4 text-card-foreground sm:p-6"
              : "space-y-4 rounded-lg border-2 border-dashed border-foreground bg-card p-4 text-card-foreground sm:p-6"
          }
          data-testid="reveal"
          data-correct={correct ? "true" : "false"}
        >
          <h4
            id={`${uid}-verdict`}
            ref={verdictHeading}
            tabIndex={-1}
            className="flex items-start gap-2 text-xl font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {correct ? (
              <CircleCheck className="mt-1 size-6 shrink-0" aria-hidden />
            ) : (
              <CircleAlert className="mt-1 size-6 shrink-0" aria-hidden />
            )}
            <span>
              {correct ? TRAINER.right : TRAINER.notQuite} {scenario.verdictTitle}
            </span>
          </h4>
          <div className="space-y-2">
            <p className="font-semibold">{TRAINER.whatToNotice}</p>
            <ul className="list-disc space-y-2 pl-6">
              {scenario.tells.map((tell) => (
                <li key={tell}>{tell}</li>
              ))}
            </ul>
          </div>
          <p>{scenario.lesson}</p>
          <HydrationGate>
            <Button type="button" size="touch" className="w-full text-lg sm:w-auto" onClick={next}>
              {isLast ? TRAINER.seeResult : TRAINER.next}
              <ArrowRight className="size-5" aria-hidden />
            </Button>
          </HydrationGate>
        </section>
      )}
    </div>
  );
}

/** One practice message. Plain text only: no link, no player, nothing tappable (an in-message "button" is bracketed text). */
function MessageView({ scenario }: { scenario: Scenario }) {
  if (scenario.channel === "email") {
    return (
      <article
        className="overflow-hidden rounded-lg border border-input bg-card text-card-foreground"
        data-testid="message"
        data-channel="email"
      >
        <dl className="space-y-1 bg-muted p-4 text-muted-foreground">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{TRAINER.from}</dt>
            <dd className="[overflow-wrap:anywhere]">
              <span>{scenario.from}</span> <span>{`<${scenario.fromAddress ?? ""}>`}</span>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">{TRAINER.subject}</dt>
            <dd className="[overflow-wrap:anywhere]">{scenario.subject}</dd>
          </div>
        </dl>
        <div className="space-y-3 p-4 [overflow-wrap:anywhere]">
          {scenario.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </article>
    );
  }

  if (scenario.channel === "text") {
    return (
      <article className="space-y-2" data-testid="message" data-channel="text">
        <p className="text-muted-foreground [overflow-wrap:anywhere]">{scenario.meta}</p>
        <div className="space-y-2 rounded-2xl border border-input bg-card p-4 text-card-foreground [overflow-wrap:anywhere]">
          {scenario.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </article>
    );
  }

  return (
    <article
      className="overflow-hidden rounded-lg border border-input bg-card text-card-foreground"
      data-testid="message"
      data-channel="voicemail"
    >
      <div className="space-y-1 bg-muted p-4 text-muted-foreground">
        <p className="font-semibold">{scenario.meta}</p>
        <p>{scenario.from}</p>
        <p>{TRAINER.voicemailCaption}</p>
      </div>
      <div className="space-y-3 p-4 [overflow-wrap:anywhere]">
        {scenario.direction ? <p className="italic">{scenario.direction}</p> : null}
        {scenario.body.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </article>
  );
}
