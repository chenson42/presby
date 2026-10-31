"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ContinueButton } from "./continue-button";
import { RecoveryCodesPanel } from "./recovery-codes-panel";

/**
 * Holds the one-time recovery codes after first enrolment (F166, DECISION-292).
 *
 * Why it exists, and why it is the root of every branch of the page. Finishing
 * enrolment marks the session verified, which writes the session cookie, and in
 * Next 16 any cookie written inside a server action re-renders the current route.
 * So the page re-renders, as an enrolled person's management view, one moment
 * after the codes arrive. React keeps a client component's state through that
 * only when the component at the same place has the same type and key. This
 * component is therefore the root of EVERY return in `page.tsx` (same type, same
 * position, no key; pinned by page.test.tsx P1 and P4), and the codes live in its
 * state, not in the enrolment form that the re-render unmounts.
 *
 * The codes exist nowhere else: no cookie, no storage, no URL. A reload loses
 * them by design ("shown once"); the management view's Regenerate, after
 * confirming the second factor, is the way to a new set.
 *
 * `callbackUrl` is the server-sanitized value, passed as a prop. This file never
 * reads the query string or the location, and never touches the session or the
 * two-factor grant (pinned by enrolment-handoff.test.tsx H7 and the boundaries
 * test G4).
 */

type Delivery = { codes: string[]; sessionVerified: boolean };

const PresentContext = createContext<((delivery: Delivery) => void) | null>(null);

/** Returns `present`, which `TotpEnrollForm` calls with the codes when enrolment succeeds. */
export function useRecoveryCodesHandoff(): (delivery: Delivery) => void {
  const present = useContext(PresentContext);
  if (!present) {
    throw new Error("useRecoveryCodesHandoff must be used inside <EnrolmentHandoff>.");
  }
  return present;
}

function Delivered({
  delivery,
  callbackUrl,
}: {
  delivery: Delivery;
  callbackUrl: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The form that had focus is gone: move it to the new heading so a keyboard or
  // screen-reader user is not left on nothing.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="max-w-xl">
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-2xl font-semibold outline-none"
      >
        Two-factor authentication enabled
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your authenticator app is now linked. Save these recovery codes now.
        They are shown only once: if you reload or leave this page, we cannot
        show them again.
      </p>
      <div className="mt-6">
        <RecoveryCodesPanel
          heading="Recovery codes — save these now"
          headingLevel={2}
          intro="Each code lets you sign in once if you lose your authenticator."
          codes={delivery.codes}
        />
      </div>
      {!delivery.sessionVerified && (
        <p className="mt-4 text-sm text-muted-foreground">
          You may be asked for a code from your app once more before you reach
          your destination.
        </p>
      )}
      <ContinueButton href={callbackUrl} />
    </div>
  );
}

export function EnrolmentHandoff({
  callbackUrl,
  children,
}: {
  callbackUrl: string;
  children: ReactNode;
}) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  return (
    <PresentContext.Provider value={setDelivery}>
      {delivery ? <Delivered delivery={delivery} callbackUrl={callbackUrl} /> : children}
    </PresentContext.Provider>
  );
}
