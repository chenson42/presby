/**
 * tickets-notifications.ts: every ticket lifecycle email is a rendered message
 * (DECISION-191): the subject is a raw plain-text header (F162), html carries
 * each string escaped exactly once, a plain-text part exists, and the "view"
 * button is an absolute link on the platform origin (F165), omitted when none
 * is safe. The operator-pool query is mocked; this file is the message half.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockEnqueue = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ enqueueEmail: mockEnqueue }));

const mockPool = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin"]) chain[m] = () => chain;
  chain.where = () => mockPool();
  return { db: { selectDistinct: () => chain } };
});

import {
  notifyOperatorsOfNewTicket,
  notifyOperatorsOfSubmitterReply,
  notifySubmitterOfOperatorReply,
  notifySubmitterOfPromotion,
  notifySubmitterOfResolution,
} from "./tickets-notifications";

type Sent = {
  to: string;
  templateKey: string;
  message: { subject: string; html: string; text: string };
};
const sent = () => mockEnqueue.mock.calls.map((c) => c[0] as Sent);

const OPERATORS = [
  { userId: "u1", email: "ops-a@example.invalid", name: "A" },
  { userId: "u2", email: "ops-b@example.invalid", name: "B" },
];

const HOSTILE_SUBJECT = `Q&A <img src=x onerror=1> "quoted"\r\nBcc: x@example.invalid`;

beforeEach(() => {
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue({ id: "q", sentInline: true });
  mockPool.mockReset();
  mockPool.mockResolvedValue(OPERATORS);
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.platform.example");
  vi.stubEnv("NODE_ENV", "production");
});

function expectPlainSubjectAndEscapedBody(m: Sent["message"]) {
  // F162: a subject is a plain-text header - raw, never HTML-escaped, one line.
  expect(m.subject).not.toContain("&amp;");
  expect(m.subject).not.toMatch(/[\r\n]/);
  expect(m.subject).toContain("Q&A <img src=x onerror=1>");
  // html: hostile markup is inert and escaped exactly once.
  expect(m.html).not.toContain("<img");
  expect(m.html).toContain("Q&amp;A &lt;img src=x onerror=1&gt;");
  expect(m.html).not.toContain("&amp;amp;");
  // text: a plain-text part exists and carries the raw string.
  expect(m.text.length).toBeGreaterThan(0);
  expect(m.text).toContain("Q&A <img src=x onerror=1>");
}

describe("notifyOperatorsOfNewTicket", () => {
  const params = {
    ticketId: "t-1",
    slug: "alder-creek",
    organizationName: "Alder & Creek <Church>",
    subject: HOSTILE_SUBJECT,
    changeClass: "bug",
    area: "directory",
    priority: "normal",
    submitterName: "Pat <b>Lee</b>",
  };

  it("sends one rendered message per operator, with an absolute admin link", async () => {
    await notifyOperatorsOfNewTicket(params);
    const calls = sent();
    expect(calls.map((c) => c.to)).toEqual(OPERATORS.map((o) => o.email));
    for (const c of calls) {
      expect(c.templateKey).toBe("ticket_new");
      expectPlainSubjectAndEscapedBody(c.message);
      expect(c.message.html).toContain('href="https://www.platform.example/admin/tickets/t-1"');
      expect(c.message.text).toContain("https://www.platform.example/admin/tickets/t-1");
      expect(c.message.html).toContain("Alder &amp; Creek &lt;Church&gt;");
      expect(c.message.text).toContain("Organization: Alder & Creek <Church>");
      expect(c.message.text).toContain("Submitted by: Pat <b>Lee</b>");
    }
  });

  it("omits the button, never inventing a relative link, when no safe platform origin is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    await notifyOperatorsOfNewTicket(params);
    const m = sent()[0]!.message;
    expect(m.html).not.toContain("/admin/tickets/");
    expect(m.text).not.toContain("/admin/tickets/");
  });

  it("never throws: a failing enqueue is logged and swallowed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEnqueue.mockRejectedValue(new Error("down"));
    await expect(notifyOperatorsOfNewTicket(params)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("notifySubmitterOfOperatorReply", () => {
  it("renders the reply as a quote with the full-thread link", async () => {
    await notifySubmitterOfOperatorReply({
      ticketId: "t-2",
      slug: "alder-creek",
      submitterEmail: "filer@example.invalid",
      submitterName: "Filer",
      operatorName: "Op <i>erator</i>",
      subject: HOSTILE_SUBJECT,
      excerpt: "Line one & <two>\nLine three",
    });
    const [c] = sent();
    expect(c!.templateKey).toBe("ticket_operator_reply");
    expect(c!.to).toBe("filer@example.invalid");
    expectPlainSubjectAndEscapedBody(c!.message);
    expect(c!.message.html).toContain("Op &lt;i&gt;erator&lt;/i&gt; replied");
    expect(c!.message.html).toContain("Line one &amp; &lt;two&gt;<br>Line three");
    expect(c!.message.text).toContain("> Line one & <two>\n> Line three");
    expect(c!.message.html).toContain('href="https://www.platform.example/o/alder-creek/tickets/t-2"');
    expect(c!.message.html).toContain(">View the full thread</a>");
  });
});

describe("notifyOperatorsOfSubmitterReply", () => {
  it("goes to the assignee only when there is one, with the admin link", async () => {
    await notifyOperatorsOfSubmitterReply({
      ticketId: "t-3",
      subject: HOSTILE_SUBJECT,
      submitterName: "Sub & Mitter",
      excerpt: "Thanks <3",
      assignee: OPERATORS[0]!,
    });
    expect(sent().map((c) => c.to)).toEqual(["ops-a@example.invalid"]);
    const c = sent()[0]!;
    expect(c.templateKey).toBe("ticket_submitter_reply");
    expectPlainSubjectAndEscapedBody(c.message);
    expect(c.message.html).toContain("Sub &amp; Mitter replied");
    expect(c.message.html).toContain('href="https://www.platform.example/admin/tickets/t-3"');
  });

  it("falls back to the whole operator pool when there is no assignee", async () => {
    await notifyOperatorsOfSubmitterReply({
      ticketId: "t-3",
      subject: "Plain",
      submitterName: "S",
      excerpt: "x",
      assignee: null,
    });
    expect(sent().map((c) => c.to)).toEqual(OPERATORS.map((o) => o.email));
  });
});

describe("notifySubmitterOfResolution", () => {
  it("names the terminal status in the subject, heading and body", async () => {
    await notifySubmitterOfResolution({
      ticketId: "t-4",
      slug: "alder-creek",
      submitterEmail: "filer@example.invalid",
      submitterName: "Filer",
      subject: HOSTILE_SUBJECT,
      status: "declined",
    });
    const c = sent()[0]!;
    expect(c.templateKey).toBe("ticket_resolved");
    expect(c.message.subject.startsWith("Your ticket has been declined: Q&A")).toBe(true);
    expectPlainSubjectAndEscapedBody(c.message);
    expect(c.message.text).toContain("has been marked declined.");
    expect(c.message.html).toContain('href="https://www.platform.example/o/alder-creek/tickets/t-4"');
  });
});

describe("notifySubmitterOfPromotion", () => {
  it("greets the submitter by escaped name and links the ticket", async () => {
    await notifySubmitterOfPromotion({
      ticketId: "t-5",
      slug: "alder-creek",
      submitterEmail: "filer@example.invalid",
      submitterName: "Fil <b>er</b>",
      subject: HOSTILE_SUBJECT,
    });
    const c = sent()[0]!;
    expect(c.templateKey).toBe("ticket_feedback_promoted");
    expectPlainSubjectAndEscapedBody(c.message);
    expect(c.message.html).toContain("Hi Fil &lt;b&gt;er&lt;/b&gt;,");
    expect(c.message.text).toContain("Hi Fil <b>er</b>,");
    expect(c.message.html).toContain(">View the ticket</a>");
  });
});
