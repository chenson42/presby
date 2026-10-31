import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getPool = vi.fn();
const insertRow = vi.fn();
const attempt = vi.fn();
const afterFn = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => transaction(fn) },
}));
vi.mock("@/lib/tickets-notifications", () => ({ getTicketOperatorPool: () => getPool() }));
vi.mock("@/lib/email/queue", () => ({
  insertQueueRowInTx: (tx: unknown, input: unknown) => insertRow(tx, input),
  attemptQueuedSend: (id: string) => attempt(id),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterFn(fn) }));

import { buildHelpContactEmail, notifyOperatorsOfContactMessage } from "./notify";
import { HELP_CONTACT_EMAIL_COPY } from "./copy";

const operators = [
  { userId: "u1", email: "operator.one@example.invalid", name: "Op One" },
  { userId: "u2", email: "operator.two@example.invalid", name: null },
];

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getPool.mockReset().mockResolvedValue(operators);
  let n = 0;
  insertRow.mockReset().mockImplementation(async () => ({ id: `q${(n += 1)}` }));
  attempt.mockReset().mockResolvedValue({ sentInline: true });
  afterFn.mockReset();
  transaction.mockReset().mockImplementation(async (fn) => fn({ tx: true }));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockRestore();
  error.mockRestore();
});

describe("buildHelpContactEmail", () => {
  it("is the constant, content-free message with a button to the inbox", () => {
    const email = buildHelpContactEmail();
    expect(email.subject).toBe(HELP_CONTACT_EMAIL_COPY.subject);
    for (const text of [email.html, email.text]) {
      expect(text).toContain("A new contact message");
      expect(text).toContain("The message is not in this email.");
      expect(text).toContain("http://localhost:3000/admin/messages");
    }
    expect(email.text).toContain("at most once an hour");
  });
  it("takes no argument, so no visitor text can be in it", () => {
    expect(buildHelpContactEmail.length).toBe(0);
    expect(buildHelpContactEmail()).toEqual(buildHelpContactEmail());
  });
  it("omits the button when no safe platform origin exists, rather than inventing one", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const email = buildHelpContactEmail();
    expect(email.html).not.toContain("/admin/messages");
  });
});

describe("notifyOperatorsOfContactMessage", () => {
  it("queues one row per operator, in one transaction, with the template key and the operator's ACCOUNT address", async () => {
    expect(await notifyOperatorsOfContactMessage()).toEqual({ queued: 2 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertRow).toHaveBeenCalledTimes(2);
    expect(insertRow.mock.calls.map(([, input]) => (input as { to: string }).to)).toEqual(operators.map((o) => o.email));
    for (const [tx, input] of insertRow.mock.calls) {
      expect(tx).toEqual({ tx: true });
      expect((input as { templateKey: string }).templateKey).toBe("help_contact_notification");
    }
  });
  it("sends the same constant message to everyone", async () => {
    await notifyOperatorsOfContactMessage();
    const messages = insertRow.mock.calls.map(([, input]) => (input as { message: unknown }).message);
    expect(messages[0]).toEqual(buildHelpContactEmail());
    expect(messages[1]).toEqual(messages[0]);
  });
  it("queues BEFORE the response and sends only in after(): nothing is attempted until after() runs", async () => {
    await notifyOperatorsOfContactMessage();
    expect(afterFn).toHaveBeenCalledTimes(2);
    expect(attempt).not.toHaveBeenCalled();
    for (const [fn] of afterFn.mock.calls) await (fn as () => Promise<void>)();
    expect(attempt.mock.calls.map(([id]) => id)).toEqual(["q1", "q2"]);
  });
  it("one failed send attempt in after() does not stop the next, and is logged by class", async () => {
    attempt.mockRejectedValueOnce(new Error("resend down: operator.one@example.invalid"));
    await notifyOperatorsOfContactMessage();
    for (const [fn] of afterFn.mock.calls) await (fn as () => Promise<void>)();
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain("operator.one@example.invalid");
    expect(JSON.stringify(error.mock.calls)).toContain("Error");
  });
  it("with no operator it warns and queues nothing", async () => {
    getPool.mockResolvedValue([]);
    expect(await notifyOperatorsOfContactMessage()).toEqual({ queued: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(afterFn).not.toHaveBeenCalled();
  });
  it("a failed enqueue is swallowed and logged by class, and sends nothing", async () => {
    transaction.mockRejectedValue(new Error("connection reset"));
    expect(await notifyOperatorsOfContactMessage()).toEqual({ queued: 0 });
    expect(afterFn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
  it("a failed operator lookup is swallowed too", async () => {
    getPool.mockRejectedValue(new Error("db down"));
    expect(await notifyOperatorsOfContactMessage()).toEqual({ queued: 0 });
  });
  it("after() throwing outside a request scope leaves the rows queued for the cron and still reports them", async () => {
    afterFn.mockImplementation(() => {
      throw new Error("after() outside a request scope");
    });
    expect(await notifyOperatorsOfContactMessage()).toEqual({ queued: 2 });
    expect(attempt).not.toHaveBeenCalled();
  });
  it("takes no argument: the typed name, address, congregation and message cannot reach it (C5, C9)", () => {
    expect(notifyOperatorsOfContactMessage.length).toBe(0);
  });
});
