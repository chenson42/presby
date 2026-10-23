// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const success = vi.hoisted(() => vi.fn());
const note = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => note(...args), { success }),
}));

import {
  notifySaved,
  savedMessage,
  sharedNoteDescription,
  sharedNoteTitle,
  SHARED_NOTE_DURATION_MS,
} from "./person-save-notes";

afterEach(() => {
  success.mockClear();
  note.mockClear();
});

describe("sharedNoteTitle", () => {
  it("one, two, and many names", () => {
    expect(sharedNoteTitle({ names: ["A B"], more: 0 })).toBe("Also on file for A B");
    expect(sharedNoteTitle({ names: ["A B", "C D"], more: 0 })).toBe("Also on file for A B and C D");
    expect(sharedNoteTitle({ names: ["A B", "C D", "E F"], more: 0 })).toBe("Also on file for A B, C D and 1 other");
    expect(sharedNoteTitle({ names: ["A B", "C D", "E F"], more: 4 })).toBe("Also on file for A B, C D and 5 others");
  });
});

describe("savedMessage / notifySaved", () => {
  it("adds the promotion to the success sentence, and nothing else changes", () => {
    expect(savedMessage("Person updated.", undefined)).toBe("Person updated.");
    expect(savedMessage("Person updated.", { promoted: { address: "w@example.invalid" } })).toBe(
      "Person updated. Now the main address: w@example.invalid.",
    );
  });

  it("raises the success toast, then one 10-second toast per shared address", () => {
    notifySaved("Person updated.", {
      shared: [
        { address: "a@example.invalid", names: ["A B"], more: 0 },
        { address: "b@example.invalid", names: ["C D"], more: 0 },
      ],
    });
    expect(success).toHaveBeenCalledWith("Person updated.");
    expect(note).toHaveBeenCalledTimes(2);
    expect(note.mock.calls[1]).toEqual([
      "Also on file for C D",
      { description: sharedNoteDescription("b@example.invalid"), duration: SHARED_NOTE_DURATION_MS },
    ]);
    expect(SHARED_NOTE_DURATION_MS).toBe(10000);
  });
});
