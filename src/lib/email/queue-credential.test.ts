/**
 * Credential-body redaction and the transaction-aware queue halves
 * (DECISION-186, docs/work-log/2026-10-21-invitations.md Phase 3, F154/F158).
 * Unit level, mocked db. The real-database behaviour (the row left `queued`
 * with the link when the provider fails, the later worker success redacting
 * it) is proven in src/lib/onboarding/issue.db.test.ts.
 */
vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => {
  const calls = {
    insertValues: [] as unknown[],
    updateSets: [] as Array<Record<string, unknown>>,
    selectRows: [] as unknown[][],
    executeRows: [] as unknown[],
  };
  const makeInsert = (sink: unknown[], rowFor: () => unknown) => () => ({
    values: (v: unknown) => {
      sink.push(v);
      return { returning: async () => [rowFor()] };
    },
  });
  const makeUpdate = (sink: Array<Record<string, unknown>>, returning: unknown[][]) => () => ({
    set: (v: Record<string, unknown>) => {
      sink.push(v);
      return {
        where: () => {
          const p = Promise.resolve([] as unknown[]) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
          p.returning = async () => returning.shift() ?? [];
          return p;
        },
      };
    },
  });
  const state = { nextRow: {} as Record<string, unknown> };
  return { calls, makeInsert, makeUpdate, state };
});
const { calls, makeInsert, makeUpdate, state } = h;

vi.mock("@/lib/db", () => ({
  db: {
    insert: h.makeInsert(h.calls.insertValues, () => h.state.nextRow),
    update: h.makeUpdate(h.calls.updateSets, []),
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => h.calls.selectRows.shift() ?? [] }) }),
    }),
    execute: async () => ({ rows: h.calls.executeRows }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  emailQueue: {
    id: { name: "id" },
    status: { name: "status" },
    templateKey: { name: "template_key" },
    htmlBody: { name: "html_body" },
    textBody: { name: "text_body" },
    lastAttemptAt: {},
  },
  auditEvents: {},
}));
vi.mock("@/lib/audit", () => ({ AUDIT_ACTIONS: { EMAIL_QUEUE_PERMANENT_FAILURE: "email.queue.permanent_failure" } }));
const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock("./send", () => ({ sendEmail: mockSendEmail }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: vi.fn(() => "eq"), lt: vi.fn(() => "lt"), and: vi.fn(() => "and") };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CREDENTIAL_TEMPLATE_KEYS,
  REDACTED_BODY_MARKER,
  attemptQueuedSend,
  cancelQueuedEmail,
  enqueueEmail,
  insertQueueRowInTx,
  isCredentialTemplateKey,
  processQueueBatch,
} from "./queue";
import { ACCOUNT_INVITATION_TEMPLATE_KEY, ACCOUNT_SIGN_IN_TEMPLATE_KEY } from "@/lib/onboarding/invitation-email";
import { renderEmail } from "./render";

const MSG = renderEmail({ subject: "s", heading: "h", blocks: [{ kind: "p", text: "p" }] });

const TOKEN_LINK = "https://app.example.invalid/invite?token=abc";

function row(templateKey: string, extra: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    toEmail: "someone@example.invalid",
    fromEmail: null,
    replyTo: null,
    subject: "s",
    htmlBody: `<a href="${TOKEN_LINK}">x</a>`,
    textBody: TOKEN_LINK,
    templateKey,
    status: "queued",
    attemptCount: 0,
    maxAttempts: 8,
    ...extra,
  };
}

beforeEach(() => {
  calls.insertValues.length = 0;
  calls.updateSets.length = 0;
  calls.selectRows.length = 0;
  calls.executeRows.length = 0;
  mockSendEmail.mockReset();
  delete process.env.EMAIL_DEV_INTERCEPT;
  delete process.env.EMAIL_DEV_REDIRECT_TO;
});

describe("CREDENTIAL_TEMPLATE_KEYS", () => {
  it("holds exactly the two invitation template keys (F154: the other three are a follow-up)", () => {
    expect([...CREDENTIAL_TEMPLATE_KEYS].sort()).toEqual(
      [ACCOUNT_INVITATION_TEMPLATE_KEY, ACCOUNT_SIGN_IN_TEMPLATE_KEY].sort(),
    );
    expect(isCredentialTemplateKey("account_invitation")).toBe(true);
    expect(isCredentialTemplateKey("account_sign_in_invitation")).toBe(true);
    expect(isCredentialTemplateKey("password_reset")).toBe(false);
  });
});

describe("inline send (enqueueEmail)", () => {
  it("redacts both bodies in the SAME update that marks a credential row sent", async () => {
    state.nextRow = row("account_invitation");
    mockSendEmail.mockResolvedValue({ id: "prov-1" });
    const result = await enqueueEmail({ to: "someone@example.invalid", message: MSG, templateKey: "account_invitation" });
    expect(result).toEqual({ id: "q-1", sentInline: true });
    expect(calls.updateSets).toHaveLength(1);
    expect(calls.updateSets[0]).toMatchObject({
      status: "sent",
      htmlBody: REDACTED_BODY_MARKER,
      textBody: REDACTED_BODY_MARKER,
    });
  });

  it("does not touch the bodies of a non-credential row", async () => {
    state.nextRow = row("password_reset");
    mockSendEmail.mockResolvedValue({ id: "prov-1" });
    await enqueueEmail({ to: "someone@example.invalid", message: MSG, templateKey: "password_reset" });
    expect(calls.updateSets[0]).toMatchObject({ status: "sent" });
    expect(calls.updateSets[0]).not.toHaveProperty("htmlBody");
    expect(calls.updateSets[0]).not.toHaveProperty("textBody");
  });

  it("leaves a failed inline attempt queued WITH the link (the named residual) for the worker", async () => {
    state.nextRow = row("account_invitation");
    mockSendEmail.mockRejectedValue(new Error("provider down"));
    const result = await enqueueEmail({ to: "someone@example.invalid", message: MSG, templateKey: "account_invitation" });
    expect(result.sentInline).toBe(false);
    expect(calls.updateSets[0]).toMatchObject({ status: "queued", failureReason: "provider down" });
    expect(calls.updateSets[0]).not.toHaveProperty("htmlBody");
  });
});

describe("a rendered credential link leaves no form behind once sent", () => {
  // The stored body is replaced WHOLE, so the raw URL and its HTML-escaped form
  // (a query with `&` is written `&amp;` in the href and the printed copy) both
  // go. The token alphabet has no `&`; this URL does, to prove both forms anyway.
  const RAW = "https://app.example.invalid/invite?token=abc&x=1";
  const ESCAPED = "https://app.example.invalid/invite?token=abc&amp;x=1";

  it("rendered html carries the escaped form (three times), text the raw form (once)", () => {
    const m = renderEmail({
      subject: "s", heading: "h", blocks: [], action: { label: "Accept", href: RAW },
    });
    expect(m.html.split(ESCAPED).length - 1).toBe(3); // button href, printed href, printed text
    expect(m.html).toContain(`href="${ESCAPED}"`);
    expect(m.text.split(RAW).length - 1).toBe(1);
  });

  it("the sent-update body columns contain neither the raw nor the escaped link", async () => {
    const m = renderEmail({
      subject: "s", heading: "h", blocks: [], action: { label: "Accept", href: RAW },
    });
    state.nextRow = row("account_invitation", { htmlBody: m.html, textBody: m.text });
    mockSendEmail.mockResolvedValue({ id: "prov-9" });
    await enqueueEmail({ to: "someone@example.invalid", message: m, templateKey: "account_invitation" });
    const set = calls.updateSets[0] as { htmlBody: string; textBody: string };
    for (const stored of [set.htmlBody, set.textBody]) {
      expect(stored).toBe(REDACTED_BODY_MARKER);
      expect(stored).not.toContain(RAW);
      expect(stored).not.toContain(ESCAPED);
      expect(stored).not.toContain("token=");
    }
  });
});

describe("worker path (processQueueBatch)", () => {
  it("redacts a credential row on worker success", async () => {
    calls.executeRows.push({
      id: "q-1", to_email: "someone@example.invalid", from_email: null, reply_to: null, subject: "s",
      html_body: TOKEN_LINK, text_body: TOKEN_LINK, template_key: "account_invitation", status: "processing",
      attempt_count: 1, max_attempts: 8, next_attempt_at: null, last_attempt_at: null, sent_at: null,
      provider_message_id: null, failure_reason: null, delivered_at: null, opened_at: null, clicked_at: null,
      bounced_at: null, complained_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    mockSendEmail.mockResolvedValue({ id: "prov-2" });
    const result = await processQueueBatch(5);
    expect(result.sent).toBe(1);
    const sentUpdate = calls.updateSets.find((s) => s.status === "sent");
    expect(sentUpdate).toMatchObject({ htmlBody: REDACTED_BODY_MARKER, textBody: REDACTED_BODY_MARKER });
  });

  it("redacts a credential row on permanent failure", async () => {
    calls.executeRows.push({
      id: "q-2", to_email: "someone@example.invalid", from_email: null, reply_to: null, subject: "s",
      html_body: TOKEN_LINK, text_body: TOKEN_LINK, template_key: "account_invitation", status: "processing",
      attempt_count: 7, max_attempts: 8, next_attempt_at: null, last_attempt_at: null, sent_at: null,
      provider_message_id: null, failure_reason: null, delivered_at: null, opened_at: null, clicked_at: null,
      bounced_at: null, complained_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    mockSendEmail.mockRejectedValue(new Error("nope"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await processQueueBatch(5);
    errSpy.mockRestore();
    expect(result.failed).toBe(1);
    const failedUpdate = calls.updateSets.find((s) => s.status === "failed");
    expect(failedUpdate).toMatchObject({ htmlBody: REDACTED_BODY_MARKER, textBody: REDACTED_BODY_MARKER });
  });
});

describe("insertQueueRowInTx", () => {
  it("writes through the supplied transaction and never sends", async () => {
    const txInserts: unknown[] = [];
    const tx = {
      insert: makeInsert(txInserts, () => row("account_invitation")),
      update: makeUpdate([], []),
    };
    const inserted = await insertQueueRowInTx(tx as never, {
      to: "someone@example.invalid", message: MSG, templateKey: "account_invitation",
    });
    expect(inserted.id).toBe("q-1");
    expect(txInserts).toHaveLength(1);
    expect(calls.insertValues).toHaveLength(0); // never the shared db
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(txInserts[0]).toMatchObject({ templateKey: "account_invitation", maxAttempts: 8, textBody: MSG.text });
  });
});

describe("attemptQueuedSend", () => {
  it("sends a queued row and redacts it on success", async () => {
    calls.selectRows.push([row("account_invitation")]);
    mockSendEmail.mockResolvedValue({ id: "prov-3" });
    expect(await attemptQueuedSend("q-1")).toEqual({ sentInline: true });
    expect(calls.updateSets[0]).toMatchObject({ status: "sent", htmlBody: REDACTED_BODY_MARKER });
  });

  it("leaves a failed send queued for the worker", async () => {
    calls.selectRows.push([row("account_invitation")]);
    mockSendEmail.mockRejectedValue(new Error("down"));
    expect(await attemptQueuedSend("q-1")).toEqual({ sentInline: false });
    expect(calls.updateSets[0]).toMatchObject({ status: "queued" });
  });

  it("does not send a row that is gone or no longer queued (revoked before the commit landed)", async () => {
    calls.selectRows.push([]);
    expect(await attemptQueuedSend("missing")).toEqual({ sentInline: false });
    calls.selectRows.push([row("account_invitation", { status: "cancelled" })]);
    expect(await attemptQueuedSend("q-1")).toEqual({ sentInline: false });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("cancelQueuedEmail", () => {
  it("cancels through the supplied transaction, redacts credential bodies in the same update, and reports whether a row changed", async () => {
    const txUpdates: Array<Record<string, unknown>> = [];
    const returning: unknown[][] = [[{ id: "q-1" }], []];
    const tx = { insert: makeInsert([], () => ({})), update: makeUpdate(txUpdates, returning) };
    expect(await cancelQueuedEmail(tx as never, "q-1")).toBe(true);
    expect(txUpdates[0]).toMatchObject({ status: "cancelled" });
    // Both bodies are rewritten by a CASE on the credential keys.
    expect(txUpdates[0]).toHaveProperty("htmlBody");
    expect(txUpdates[0]).toHaveProperty("textBody");
    // A row that is no longer queued matches nothing.
    expect(await cancelQueuedEmail(tx as never, "q-1")).toBe(false);
  });
});
