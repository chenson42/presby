import { describe, expect, it } from "vitest";
import { buildStatementNotice, STATEMENT_NOTICE_TEMPLATE } from "./notice";

const base = { organizationName: "Fixture Presbyterian Church", taxYear: 2027, link: "https://app.example.invalid/o/fixture/giving", corrected: false };

describe("buildStatementNotice", () => {
  it("uses the registered template key", () => {
    expect(STATEMENT_NOTICE_TEMPLATE).toBe("giving.statement.notice");
    expect(buildStatementNotice(base).templateKey).toBe("giving.statement.notice");
  });

  it("carries no amounts and no gift detail anywhere - subject, html or text", () => {
    for (const corrected of [false, true]) {
      const n = buildStatementNotice({ ...base, corrected });
      for (const part of [n.subject, n.html, n.text]) {
        expect(part).not.toContain("$");
        expect(part).not.toMatch(/\d+\.\d{2}/);
        expect(part).not.toMatch(/\d{1,3}(,\d{3})+/);
      }
    }
  });

  it("names the organization, the year and the link", () => {
    const n = buildStatementNotice(base);
    expect(n.subject).toBe("Your 2027 giving statement from Fixture Presbyterian Church");
    expect(n.text).toContain("https://app.example.invalid/o/fixture/giving");
    expect(n.html).toContain('href="https://app.example.invalid/o/fixture/giving"');
  });

  it("says a corrected statement replaces the earlier one", () => {
    const n = buildStatementNotice({ ...base, corrected: true });
    expect(n.subject).toBe("Your corrected 2027 giving statement from Fixture Presbyterian Church");
    expect(n.text).toContain("It replaces the earlier one.");
  });

  it("escapes a hostile organization name in the html and keeps a subject to one line", () => {
    const n = buildStatementNotice({ ...base, organizationName: `<img src=x onerror=1>\r\nBcc: x@example.invalid & "co"` });
    expect(n.html).not.toContain("<img");
    expect(n.html).toContain("&lt;img src=x onerror=1&gt;");
    expect(n.html).toContain("&amp;");
    expect(n.subject).not.toMatch(/[\r\n]/);
  });
});
