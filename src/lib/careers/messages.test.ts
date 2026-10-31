import { describe, expect, it } from "vitest";
import {
  FEATURE_OFF_MESSAGE,
  FORBIDDEN_MESSAGE,
  GENERIC_MESSAGE,
  INVALID_TRANSITION_MESSAGE,
  NOT_FOUND_MESSAGE,
  PUBLISH_LIMIT_MESSAGE,
  SLUG_TAKEN_MESSAGE,
  STALE_MESSAGE,
  closingDatePassedMessage,
  incompleteMessage,
} from "./messages";

describe("Copy S8 error strings, verbatim", () => {
  it("the fixed ones", () => {
    expect(FORBIDDEN_MESSAGE).toBe("You don't have permission to manage job openings.");
    expect(NOT_FOUND_MESSAGE).toBe("That job opening no longer exists.");
    expect(FEATURE_OFF_MESSAGE).toBe("Job openings aren't turned on.");
    expect(STALE_MESSAGE).toBe(
      "This opening was changed by someone else after you opened it, so your changes were not saved. Reload the page to see what changed.",
    );
    expect(SLUG_TAKEN_MESSAGE).toBe("Another opening already uses that web address. Choose a different one.");
    expect(PUBLISH_LIMIT_MESSAGE).toBe(
      "You already have 100 job openings published, which is the most we can show. Close one before publishing another.",
    );
    expect(INVALID_TRANSITION_MESSAGE).toBe("That can't be done to this opening right now. Reload the page and try again.");
    expect(GENERIC_MESSAGE).toBe("We couldn't save that. Try again.");
  });

  it("the incomplete message names only the missing fields", () => {
    expect(incompleteMessage(["summary"])).toBe("Add a summary before publishing.");
    expect(incompleteMessage(["summary", "location"])).toBe("Add a summary and location before publishing.");
    expect(incompleteMessage(["title", "summary", "location", "description"])).toBe(
      "Add a title, summary, location and description before publishing.",
    );
  });

  it("the closing-date message differs for publish and reopen", () => {
    expect(closingDatePassedMessage(false)).toBe("The closing date has already passed. Change it before publishing.");
    expect(closingDatePassedMessage(true)).toBe("The closing date has already passed. Change it, save, then reopen.");
  });
});
