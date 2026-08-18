/**
 * Unit tests for the commit-message validator.
 * Tests exercise validateCommitMessage() directly — not the file-reading hook wrapper.
 *
 * Run via: npm test
 */
import { describe, it, expect } from "vitest";
import { validateCommitMessage } from "./commit-msg.mjs";

describe("validateCommitMessage", () => {
  // ── Passing cases ──────────────────────────────────────────────────────────

  it("valid feat with Work-Log trailer", () => {
    const msg = "feat: add CSV export\n\nWork-Log: 2026-08-09-csv-export";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(true);
  });

  it("valid fix with all trailers", () => {
    const msg =
      "fix: reject bad Caught-By\n\nCaught-By: automated-test\nDiscovered-In: Phase-5\nWork-Log: 2026-08-09-csv-export";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(true);
  });

  it("optional scope", () => {
    const msg = "feat(admin): add flag toggle\n\nWork-Log: 2026-08-09-flag-toggle";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(true);
  });

  it("chore passes without Work-Log (optional outside feat/fix)", () => {
    const result = validateCommitMessage("chore: bump deps");
    expect(result.ok).toBe(true);
  });

  it("docs passes with a valid optional Work-Log", () => {
    const msg = "docs: update README\n\nWork-Log: 2026-08-09-readme-pass";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(true);
  });

  it("Merge exemption", () => {
    const result = validateCommitMessage("Merge branch 'main' into feature/x");
    expect(result.ok).toBe(true);
  });

  it("Revert exemption", () => {
    const result = validateCommitMessage('Revert "feat: add CSV export"');
    expect(result.ok).toBe(true);
  });

  it("Release exemption", () => {
    const result = validateCommitMessage("Release v0.4.0");
    expect(result.ok).toBe(true);
  });

  // ── Failing cases ──────────────────────────────────────────────────────────

  it("missing prefix", () => {
    const result = validateCommitMessage("add CSV export");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must match/);
  });

  it("invalid prefix", () => {
    const result = validateCommitMessage("bugfix: something");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must match/);
  });

  it("description too long", () => {
    const long = "feat: " + "a".repeat(101);
    const result = validateCommitMessage(long);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/must match/);
  });

  it("feat missing Work-Log", () => {
    const result = validateCommitMessage("feat: add CSV export");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/feat commits require a "Work-Log/);
  });

  it("fix missing Work-Log (other trailers present)", () => {
    const msg =
      "fix: something\n\nCaught-By: automated-test\nDiscovered-In: Phase-5";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fix commits require a "Work-Log/);
  });

  it("malformed Work-Log slug fails on any prefix", () => {
    const msg = "docs: update README\n\nWork-Log: EnforcementBatch";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a valid work-log slug/);
  });

  it("fix with no trailers at all errors on Work-Log first", () => {
    const result = validateCommitMessage("fix: something");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Work-Log/);
  });

  it("fix missing Caught-By (Work-Log present)", () => {
    const msg = "fix: something\n\nWork-Log: 2026-08-09-thing";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing Caught-By trailer|require.*Caught-By/i);
  });

  it("fix missing Discovered-In", () => {
    const msg =
      "fix: something\n\nCaught-By: automated-test\nWork-Log: 2026-08-09-thing";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing Discovered-In trailer|require.*Discovered-In/i);
  });

  it('fix invalid Caught-By value', () => {
    const msg =
      "fix: something\n\nCaught-By: ci-bot\nDiscovered-In: Phase-5\nWork-Log: 2026-08-09-thing";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Caught-By value "ci-bot" is not valid/);
  });

  it("fix invalid Discovered-In value", () => {
    const msg =
      "fix: something\n\nCaught-By: automated-test\nDiscovered-In: Phase-7\nWork-Log: 2026-08-09-thing";
    const result = validateCommitMessage(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Discovered-In value "Phase-7" is not valid/);
  });
});
