// @vitest-environment jsdom
/**
 * `useUnsavedChangesGuard` — H3 (docs/reviews/2026-08-26-portal-ux.md). A
 * small harness component exercises the hook the way every guarded form in
 * this batch actually uses it: a dirty flag it controls, an explicit
 * "Cancel" button wired to `guardedNavigate`, a plain `<a>` link elsewhere on
 * the "page" it did NOT wire up itself (standing in for the admin shell's
 * "Back to portal" link one layout up), and the rendered
 * `UnsavedChangesDialog`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";

function Harness() {
  const [dirty, setDirty] = useState(false);
  const { discardOpen, setDiscardOpen, guardedNavigate, confirmDiscard } =
    useUnsavedChangesGuard(dirty);

  return (
    <div>
      <input
        aria-label="a field"
        onChange={() => setDirty(true)}
      />
      <button onClick={() => guardedNavigate("/explicit-cancel")}>
        Cancel
      </button>
      {/* Stands in for a link the guarded component did NOT itself render —
          the admin shell's shared "Back to portal" link, or a "Back to
          roles" link a server page renders above the client form. */}
      <a href="/elsewhere">Back to portal</a>
      <a href="https://example.invalid/off-site">Off-site link</a>
      <a href="#section">Jump link</a>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </div>
  );
}

afterEach(() => {
  cleanup();
  mockPush.mockClear();
});

describe("useUnsavedChangesGuard — clean form", () => {
  it("navigates immediately via the explicit Cancel button when not dirty", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockPush).toHaveBeenCalledWith("/explicit-cancel");
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
  });

  it("does not intercept a same-origin link click when not dirty", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }));
    // jsdom doesn't actually navigate on a real <a> click; the assertion
    // here is that no dialog opened to stop it.
    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
  });
});

describe("useUnsavedChangesGuard — dirty form, explicit Cancel", () => {
  it("opens the discard dialog instead of navigating immediately", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
  });

  it("Stay closes the dialog without navigating", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /^stay$/i }));

    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("Discard closes the dialog and completes the navigation", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));

    expect(mockPush).toHaveBeenCalledWith("/explicit-cancel");
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });
});

describe("useUnsavedChangesGuard — dirty form, an in-app link NOT wired by the form itself", () => {
  it("intercepts a same-origin <a> click and opens the dialog instead of navigating", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });

    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }), {
      button: 0,
    });

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(mockPush).toHaveBeenCalledWith("/elsewhere");
  });

  it("does NOT intercept a middle-click / modified click (lets the browser handle new-tab opens)", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });

    fireEvent.click(screen.getByRole("link", { name: /back to portal/i }), {
      metaKey: true,
    });

    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("does NOT intercept an off-site link", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });

    fireEvent.click(screen.getByRole("link", { name: /off-site link/i }));

    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("does NOT intercept a same-page fragment link", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });

    fireEvent.click(screen.getByRole("link", { name: /jump link/i }));

    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });
});

describe("useUnsavedChangesGuard — beforeunload", () => {
  it("registers a beforeunload handler only while dirty, and it cancels the event", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/a field/i), {
      target: { value: "x" },
    });

    const event = new Event("beforeunload", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("does not cancel beforeunload when clean", () => {
    render(<Harness />);

    const event = new Event("beforeunload", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});
