/**
 * notify.ts (Phase 3 T7, G28): who is told, what they are told, and that a
 * failure to tell never takes the change down. The recipient SQL is exercised
 * against a real database in service.db.test.ts; this file is the pure and
 * mocked half.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mockEnqueue = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ enqueueEmail: mockEnqueue }));

import {
  buildDomainNotification,
  collectNotificationContext,
  sendDomainNotification,
  type DomainNotification,
  type NotificationContext,
} from "./notify";

const CTX: NotificationContext = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  organizationName: "Alder Creek Presbyterian Church",
  slug: "alder-creek",
  recipients: ["clerk@example.invalid", "operator@example.invalid"],
};

beforeEach(() => {
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue({ id: "q", sentInline: true });
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.platform.example");
  vi.stubEnv("NODE_ENV", "production");
});

describe("buildDomainNotification", () => {
  it("names the organization and the domain, who did it, and links the domains page on the platform origin", () => {
    const m = buildDomainNotification(CTX, {
      event: "claimed",
      hostnames: ["church-one.invalid", "www.church-one.invalid"],
      actorKind: "tenant",
    });
    expect(m.subject).toBe("A domain was added - Alder Creek Presbyterian Church");
    for (const part of [m.text, m.html]) {
      expect(part).toContain("church-one.invalid");
      expect(part).toContain("www.church-one.invalid");
      expect(part).toContain("Alder Creek Presbyterian Church");
      expect(part).toContain("https://www.platform.example/o/alder-creek/admin/domains");
    }
    expect(m.text).toContain("your organization's administrators");
  });

  it.each([
    ["tenant", "your organization's administrators"],
    ["platform", "PresbyPortal support"],
    ["machine", "an automated check"],
  ] as const)("a %s actor reads as %j", (actorKind, phrase) => {
    const m = buildDomainNotification(CTX, { event: "removed", hostnames: ["a.invalid"], actorKind });
    expect(m.text).toContain(phrase);
  });

  it("HTML-escapes every interpolated string (the email XSS invariant)", () => {
    const m = buildDomainNotification(
      { ...CTX, organizationName: `<script>alert("x")</script> & Co` },
      { event: "claimed", hostnames: [`<img src=x onerror=alert(1)>.invalid`], actorKind: "tenant" },
    );
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&lt;img");
  });

  it("omits the link when no safe platform origin is configured, rather than guessing one", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const m = buildDomainNotification(CTX, { event: "claimed", hostnames: ["a.invalid"], actorKind: "tenant" });
    expect(m.text).not.toContain("/admin/domains");
    expect(m.html).not.toContain("/admin/domains");
  });

  it("every event has its own subject, and none mentions a proof token or a provider", () => {
    const events = [
      "claimed", "canonical_changed", "removed", "reconnected", "lapsed", "parked", "released", "force_released", "hold_set", "hold_cleared",
    ] as const;
    const subjects = new Set<string>();
    for (const event of events) {
      const m = buildDomainNotification(CTX, { event, hostnames: ["a.invalid"], actorKind: "platform" });
      subjects.add(m.subject);
      expect(m.subject + m.html + m.text).not.toMatch(/vercel|resend|cloudflare|presby-verify|token/i);
    }
    expect(subjects.size).toBe(events.length);
  });
});

describe("sendDomainNotification", () => {
  const n: DomainNotification = { event: "claimed", hostnames: ["a.invalid"], actorKind: "tenant" };

  it("enqueues one ACCOUNT-class message per recipient (templateKey domain_notification), never with a custom From", async () => {
    await sendDomainNotification(CTX, n);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    const calls = mockEnqueue.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls.map((c) => c.to)).toEqual(CTX.recipients);
    for (const c of calls) {
      expect(c.templateKey).toBe("domain_notification");
      expect(c).not.toHaveProperty("from");
      expect(c).not.toHaveProperty("replyTo");
    }
  });

  it("a null context or an empty recipient list is a quiet no-op", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendDomainNotification(null, n);
    await sendDomainNotification({ ...CTX, recipients: [] }, n);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).not.toContain("@");
    warn.mockRestore();
  });

  it("never throws: an enqueue failure is logged with ids only and the next recipient is still tried", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockEnqueue.mockRejectedValueOnce(new Error("smtp down for clerk@example.invalid"));
    await expect(sendDomainNotification(CTX, n)).resolves.toBeUndefined();
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).not.toContain("clerk@example.invalid");
    expect(logged).not.toContain("smtp down");
    err.mockRestore();
  });
});

describe("collectNotificationContext", () => {
  it("returns null, never throws, and logs only the organization id when the lookup fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const tx = {
      transaction: async () => {
        throw new Error('permission denied for table users near "secret"');
      },
    } as never;
    await expect(collectNotificationContext(tx, CTX.organizationId)).resolves.toBeNull();
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain(CTX.organizationId);
    expect(logged).not.toContain("secret");
    err.mockRestore();
  });

  it("returns null when the organization row is missing", async () => {
    const tx = {
      transaction: async (fn: (sp: unknown) => Promise<unknown>) =>
        fn({ execute: async () => ({ rows: [] }) }),
    } as never;
    await expect(collectNotificationContext(tx, CTX.organizationId)).resolves.toBeNull();
  });

  it("returns the name, slug and de-duplicated, sorted recipients (holders plus platform admins)", async () => {
    let call = 0;
    const tx = {
      transaction: async (fn: (sp: unknown) => Promise<unknown>) =>
        fn({
          execute: async () => {
            call += 1;
            if (call === 1) return { rows: [{ name: "Alder Creek", slug: "alder-creek" }] };
            if (call === 2) return { rows: [{ email: "b@example.invalid" }, { email: "a@example.invalid" }] };
            return { rows: [{ email: "a@example.invalid" }, { email: "ops@example.invalid" }] };
          },
        }),
    } as never;
    expect(await collectNotificationContext(tx, CTX.organizationId)).toEqual({
      organizationId: CTX.organizationId,
      organizationName: "Alder Creek",
      slug: "alder-creek",
      recipients: ["a@example.invalid", "b@example.invalid", "ops@example.invalid"],
    });
  });
});

