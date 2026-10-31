"use server";

import { headers } from "next/headers";
import type { HelpContactOutcome } from "@/lib/help-contact/contract";
import { submitHelpContact } from "@/lib/help-contact/submit";

/**
 * The contact form's one public endpoint (DECISION-304). THIN: it reads the
 * request headers and delegates, so every decision lives in
 * src/lib/help-contact/submit.ts, where it is tested.
 *
 * This is the one file under the public documentation trees that reaches the
 * database, and the H19 walk treats it as a named stop: it must begin with
 * "use server", be imported only from this segment, and export exactly ONE
 * function, because every export of a "use server" file is a public endpoint
 * (shell-boundaries.test.ts pins all three). No auth(), no cookies(), no
 * searchParams: a signed-in sender is anonymous here, and the action is not
 * reachable on a church's custom host (submit.ts step 1).
 */
export async function submitHelpContactAction(formData: FormData): Promise<HelpContactOutcome> {
  return submitHelpContact(formData, await headers());
}
