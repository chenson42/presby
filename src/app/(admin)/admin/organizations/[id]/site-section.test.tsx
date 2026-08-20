// @vitest-environment jsdom
/**
 * Tests for <SiteSection> — `/admin/organizations/<id>`'s third section,
 * public-site provisioning. `./actions` is mocked — a "use server" module
 * whose real implementation pulls `@/lib/sites` and `getPlatformDb()` into
 * the module graph, same reasoning `brand-form.test.tsx`'s own header
 * gives for its own mock.
 *
 * What this file pins:
 *   - No site yet: shows the provision form, never the status controls.
 *   - A provisioned, live site: shows status/repo/dates and a Suspend
 *     control (behind an AlertDialog confirm — never a native `confirm()`),
 *     never a provision form or a Reactivate control.
 *   - A suspended site: shows a Reactivate control, never Suspend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PolicyResult } from "./actions";
import type { SiteAdminDetail } from "@/lib/sites";

const provisionSiteAction = vi.fn<(fd: FormData) => Promise<PolicyResult>>();
const setSiteStatusAction = vi.fn<(fd: FormData) => Promise<PolicyResult>>();
vi.mock("./actions", () => ({
  provisionSiteAction: (fd: FormData) => provisionSiteAction(fd),
  setSiteStatusAction: (fd: FormData) => setSiteStatusAction(fd),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { SiteSection } from "./site-section";

afterEach(() => {
  cleanup();
  provisionSiteAction.mockReset();
  setSiteStatusAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const LIVE_SITE: SiteAdminDetail = {
  organizationId: "org-1",
  repo: "presby-churches/site-alder-creek",
  status: "live",
  lastIngestedCommitSha: "abc123def456",
  lastIngestedAt: "2026-08-19T10:00:00Z",
  createdAt: "2026-08-01T00:00:00Z",
};

const SUSPENDED_SITE: SiteAdminDetail = { ...LIVE_SITE, status: "suspended" };

describe("SiteSection — no site provisioned", () => {
  it("shows the provision form and no status controls", () => {
    render(
      <SiteSection
        organizationId="org-1"
        organizationName="Alder Creek Presbyterian Church"
        site={null}
      />,
    );

    expect(screen.getByLabelText(/content repository/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /suspend site/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reactivate site/i }),
    ).toBeNull();
  });

  it("submits provisionSiteAction with the organizationId and repo", async () => {
    provisionSiteAction.mockResolvedValue({ ok: true });
    render(
      <SiteSection
        organizationId="org-1"
        organizationName="Alder Creek Presbyterian Church"
        site={null}
      />,
    );

    fireEvent.change(screen.getByLabelText(/content repository/i), {
      target: { value: "presby-churches/site-alder-creek" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /provision site/i }));
    });

    expect(provisionSiteAction).toHaveBeenCalledTimes(1);
    const fd = provisionSiteAction.mock.calls[0][0];
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("repo")).toBe("presby-churches/site-alder-creek");
  });
});

describe("SiteSection — a live site", () => {
  it("shows status, repo, and dates, plus a Suspend control behind a confirm dialog", () => {
    render(
      <SiteSection
        organizationId="org-1"
        organizationName="Alder Creek Presbyterian Church"
        site={LIVE_SITE}
      />,
    );

    expect(screen.getByText("live")).toBeTruthy();
    expect(screen.getByText("presby-churches/site-alder-creek")).toBeTruthy();
    expect(screen.queryByLabelText(/content repository/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reactivate site/i }),
    ).toBeNull();

    const suspendTrigger = screen.getByRole("button", {
      name: /suspend site/i,
    });
    expect(suspendTrigger).toBeTruthy();

    // Confirm dialog — never a native confirm(). Clicking the trigger opens
    // a dialog naming the organization, per A2's "every consequential
    // confirmation names the organization" precedent.
    fireEvent.click(suspendTrigger);
    expect(
      screen.getByRole("alertdialog", {
        name: /suspend alder creek presbyterian church.s public site/i,
      }),
    ).toBeTruthy();
  });

  it("calls setSiteStatusAction with status 'suspended' only after the dialog is confirmed", async () => {
    setSiteStatusAction.mockResolvedValue({ ok: true });
    render(
      <SiteSection
        organizationId="org-1"
        organizationName="Alder Creek Presbyterian Church"
        site={LIVE_SITE}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /suspend site/i }));
    expect(setSiteStatusAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, suspend alder creek/i }),
      );
    });

    expect(setSiteStatusAction).toHaveBeenCalledTimes(1);
    const fd = setSiteStatusAction.mock.calls[0][0];
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("status")).toBe("suspended");
  });
});

describe("SiteSection — a suspended site", () => {
  it("shows a Reactivate control, never Suspend", () => {
    render(
      <SiteSection
        organizationId="org-1"
        organizationName="Alder Creek Presbyterian Church"
        site={SUSPENDED_SITE}
      />,
    );

    expect(screen.getByText("suspended")).toBeTruthy();
    expect(screen.getByRole("button", { name: /reactivate site/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /suspend site/i })).toBeNull();
  });

  it("submits setSiteStatusAction with status 'live' on Reactivate", async () => {
    setSiteStatusAction.mockResolvedValue({ ok: true });
    render(
      <SiteSection
        organizationId="org-1"
        organizationName="Alder Creek Presbyterian Church"
        site={SUSPENDED_SITE}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /reactivate site/i }));
    });

    expect(setSiteStatusAction).toHaveBeenCalledTimes(1);
    const fd = setSiteStatusAction.mock.calls[0][0];
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("status")).toBe("live");
  });
});
