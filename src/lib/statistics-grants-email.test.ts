/**
 * buildStatisticsGrantEmail (DECISION-191): the grant message. Pure; the module
 * is imported under the same mocks `statistics-grants-error-redaction.test.ts`
 * documents (the module graph reaches next-auth and a database pool).
 */
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {}, getPlatformDb: vi.fn() }));
vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }));
vi.mock("@/lib/email", () => ({ enqueueEmail: vi.fn() }));

import { describe, expect, it, vi } from "vitest";
import { buildStatisticsGrantEmail } from "./statistics-grants";

const URL_WITH_TOKEN = "https://app.example.invalid/file-statistics?token=abc_DEF-123&x=1";
const base = {
  recipientName: "Pat Clerk",
  congregationName: "Alder Creek Presbyterian Church",
  reportYear: 2090,
  expiresAt: new Date("2090-05-04T23:30:00Z"),
  submitUrl: URL_WITH_TOKEN,
};

describe("buildStatisticsGrantEmail", () => {
  it("names the congregation and year, and links the form unchanged in href, printed link and text", () => {
    const m = buildStatisticsGrantEmail(base);
    expect(m.subject).toBe("File Alder Creek Presbyterian Church's 2090 statistical report");
    const escaped = URL_WITH_TOKEN.replace(/&/g, "&amp;");
    expect(m.html).toContain(`href="${escaped}"`);
    expect(m.html).toContain(`>${escaped}</a>`);
    expect(m.text).toContain(`\n${URL_WITH_TOKEN}\n`);
    expect(m.html).toContain(">Open the report form</a>");
    expect(m.text).toContain("Alder Creek Presbyterian Church has been asked to file its 2090 annual statistical report.");
  });

  it("states the expiry as a fixed, labelled UTC day, identically in html and text", () => {
    const m = buildStatisticsGrantEmail(base);
    const line = "This link expires on May 4, 2090 (UTC) and can be used once.";
    expect(m.html).toContain(line);
    expect(m.text).toContain(line);
  });

  it("escapes a hostile name once in html and keeps it raw in text and subject", () => {
    const m = buildStatisticsGrantEmail({
      ...base,
      recipientName: "<img src=x onerror=1> & Co",
      congregationName: "Faith & <b>Hope</b>",
    });
    expect(m.subject).toBe("File Faith & <b>Hope</b>'s 2090 statistical report");
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<b>Hope</b>");
    expect(m.html).toContain("Hi &lt;img src=x onerror=1&gt; &amp; Co,");
    expect(m.html).toContain("Faith &amp; &lt;b&gt;Hope&lt;/b&gt; has been asked");
    expect(m.html).not.toContain("&amp;amp;");
    expect(m.text).toContain("Hi <img src=x onerror=1> & Co,");
  });

  it("carries the safety footnote", () => {
    const m = buildStatisticsGrantEmail(base);
    expect(m.text).toContain("If you were not expecting this, you can safely ignore this email.");
  });
});
