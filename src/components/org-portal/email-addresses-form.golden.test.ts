/**
 * Characterization tests for the address-list editor's schema through the real
 * `zodResolver` (what the three hosting forms run), added when the zod 4 upgrade
 * met the person-emails release (docs/work-log/2026-10-23-zod-4.md, "Phase 4 -
 * post-merge conversion"). Messages come from `EMAIL_COPY`, written out here.
 */
import { describe, expect, it } from "vitest";
import { resolveForm } from "@/lib/testing/zod-golden";
import { blankEmailRow, contactEmailsSchema, type EmailRowValue } from "./email-addresses-form";
import { z } from "zod";

const host = z.object({ contact: z.object({ emails: contactEmailsSchema }) });
const row = (value: string, extra: Partial<EmailRowValue> = {}): EmailRowValue => ({
  value,
  subtype: "",
  isPrimary: false,
  doNotContact: false,
  ...extra,
});
const run = (emails: unknown) => resolveForm(host, { contact: { emails } });

describe("contactEmailsSchema through the resolver", () => {
  it("returns a valid list unchanged, optional keys absent, ids of any shape, labels incl. the empty option", async () => {
    const emails = [
      row("a@example.invalid", { id: "00000000-0000-0000-0000-000000000005", subtype: "work", isPrimary: true }),
      row("b@example.invalid", { id: "d9100000-0000-0000-0000-000000000010", createdAt: "2026-01-01T00:00:00Z" }),
      blankEmailRow(false),
    ];
    expect(await run(emails)).toEqual({ values: { contact: { emails } }, errors: {}, failed: false });
  });

  it("pins each message at contact.emails.<index>.value", async () => {
    expect((await run([row("", { id: "x" })])).errors).toEqual({
      "contact.emails.0.value": "Enter an email address, or remove this row.",
    });
    expect((await run([row("nope")])).errors).toEqual({
      "contact.emails.0.value": "Enter a valid email address.",
    });
    expect((await run([row("ok@example.invalid"), row(" OK@example.invalid ")])).errors).toEqual({
      "contact.emails.1.value": "This address is already in the list.",
    });
    expect((await run([row(`${"x".repeat(250)}@e.invalid`)])).errors).toEqual({
      "contact.emails.0.value": "That email address is too long. Use 254 characters or fewer.",
    });
  });

  it("skips the list rule after a fatal row-level type failure", async () => {
    // A fatal type failure (subtype outside the vocabulary) is path-only: enums
    // carry no message here, and the list-level refinement does not run after it.
    const out = await run([row("nope", { subtype: "home" as never })]);
    expect(Object.keys(out.errors)).toEqual(["contact.emails.0.subtype"]);
  });

  it("fails (path only) when a row's flag is not a boolean", async () => {
    expect(Object.keys((await run([{ ...row("a@example.invalid"), isPrimary: "yes" }])).errors)).toEqual([
      "contact.emails.0.isPrimary",
    ]);
  });
});
