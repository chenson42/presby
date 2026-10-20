import { describe, expect, it } from "vitest";
import type { ChecklistGroup } from "./checklist";
import { recordsAsText, recordsMailto } from "./records-text";

const group: Pick<ChecklistGroup, "displayName" | "records"> = {
  displayName: "church-one.invalid",
  records: [
    { kind: "proof", type: "TXT", name: "_presby-challenge.church-one.invalid", value: "presby-verify=abc", status: "missing", hint: "keep_record", keep: true },
    { kind: "routing", type: "A", name: "church-one.invalid", value: "203.0.113.10", status: "missing", hint: "apex_alias", keep: false },
  ],
};

describe("recordsAsText", () => {
  it("lists every record's type, name and value, and the keep note on the proof", () => {
    const text = recordsAsText(group);
    expect(text).toContain("DNS records to add for church-one.invalid");
    expect(text).toContain("Type: TXT");
    expect(text).toContain("Name: _presby-challenge.church-one.invalid");
    expect(text).toContain("Value: presby-verify=abc");
    expect(text).toContain("Value: 203.0.113.10");
    expect(text).toContain("Keep this record in place");
  });

  it("never tells anyone to delete an MX or SPF record (it says the opposite)", () => {
    const text = recordsAsText(group);
    expect(text).toMatch(/Do not change or delete any existing MX or SPF/);
    expect(text).not.toMatch(/delete (the |your )?(MX|SPF)/i);
  });
});

describe("recordsMailto", () => {
  it("is a mailto: with no recipient (the church picks one) and the records encoded in the body", () => {
    const url = recordsMailto(group);
    expect(url.startsWith("mailto:?subject=")).toBe(true);
    const body = new URL(url.replace("mailto:", "http://x.invalid/")).searchParams.get("body");
    expect(body).toBe(recordsAsText(group));
    expect(url).not.toMatch(/mailto:[^?]/);
  });
});
