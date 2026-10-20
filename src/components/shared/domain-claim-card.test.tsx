// @vitest-environment jsdom
/**
 * The claim card and the shared pieces it composes, in every phase the checklist
 * can reach (Phase 3 Component / Page Plan; G11, G29, G30, G31, tech-lead
 * ruling 3b). Renders the REAL view-model from `buildChecklist`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  FIXTURE_TARGETS,
  fixtureGroup,
  fixturePair,
  fixtureGroups,
  observation,
} from "@/lib/domains/checklist-fixtures";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DomainClaimCard } from "./domain-claim-card";

afterEach(cleanup);

const card = (group = fixtureGroup("pending"), props: Partial<React.ComponentProps<typeof DomainClaimCard>> = {}) =>
  render(<DomainClaimCard group={group} idPrefix="c0" {...props} />);

describe("DomainClaimCard - proving (the first screen after Start)", () => {
  it("shows the domain, a waiting chip, the four steps with step 1 current, and the ONE proof record", () => {
    card();
    expect(screen.getByRole("heading", { level: 2, name: "church-one.invalid" })).toBeTruthy();
    expect(screen.getByText("Waiting for your ownership record")).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Progress" });
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]!.getAttribute("aria-current")).toBe("step");
    expect(items[1]!.getAttribute("aria-current")).toBeNull();
    const records = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-record-kind"));
    expect(records).toHaveLength(1);
    expect(records[0]!.textContent).toContain("_presby-challenge.church-one.invalid");
    expect(records[0]!.textContent).toMatch(/presby-verify=/);
    expect(screen.getByText(/proves you own the domain and changes nothing on your live site/)).toBeTruthy();
  });

  it("gives each record Copy controls with distinct accessible names, and a mailto link plus 'copy all'", () => {
    card();
    expect(screen.getByRole("button", { name: "Copy the record name" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the record value" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Copy all records as text/ })).toBeTruthy();
    const mail = screen.getByRole("link", { name: /Email these to my DNS person/ });
    expect(mail.getAttribute("href")).toMatch(/^mailto:\?subject=/);
  });

  it("names the claim expiry and shows the troubleshooting button, collapsed", () => {
    card();
    expect(screen.getByText(/Publish this record by 2030-01-08/)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Why isn.t it working\?/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("warns, before the church flips anything, when the site is not published yet", () => {
    card(fixtureGroups(fixturePair("pending"), { siteStatus: "provisioning", platformSiteUrl: "p.invalid/site/x" })[0]);
    expect(screen.getByText("Your site isn't published yet. Point your domain here after it is.")).toBeTruthy();
  });
});

describe("DomainClaimCard - connecting and securing", () => {
  const withTargets = (state: "attach_pending" | "attached", extra = {}) =>
    fixtureGroup(state, { observation: observation({ targets: FIXTURE_TARGETS, ...extra }) });

  it("shows the routing records with their own status chips: Correct, Missing, Wrong value, Conflicting, Couldn't check - words, never colour alone", () => {
    const rows = fixturePair("attached", {
      observation: observation({ targets: FIXTURE_TARGETS }),
    });
    rows[0] = { ...rows[0]!, observation: observation({ targets: FIXTURE_TARGETS, routing: { records: [{ hostname: "church-one.invalid", status: "wrong_value" }] } }) };
    rows[1] = { ...rows[1]!, observation: observation({ targets: FIXTURE_TARGETS, routing: { records: [{ hostname: "www.church-one.invalid", status: "correct" }] } }) };
    render(<DomainClaimCard group={fixtureGroups(rows)[0]!} idPrefix="c0" />);
    const statuses = Array.from(document.querySelectorAll("[data-status]")).map((el) => el.textContent);
    expect(statuses).toContain("Correct");
    expect(statuses).toContain("Wrong value");
    expect(statuses).toContain("Couldn't check"); // the proof record has no observation yet
  });

  it("renders every record status as an icon and its words", () => {
    for (const [status, words] of [
      ["correct", "Correct"],
      ["missing", "Missing"],
      ["wrong_value", "Wrong value"],
      ["conflicting", "Conflicting"],
      ["unknown", "Couldn't check"],
    ] as const) {
      const rows = fixturePair("attached", { observation: observation({ targets: FIXTURE_TARGETS }) });
      rows[1] = { ...rows[1]!, observation: observation({ targets: FIXTURE_TARGETS, routing: { records: [{ hostname: "www.church-one.invalid", status }] } }) };
      const { unmount } = render(<DomainClaimCard group={fixtureGroups(rows)[0]!} idPrefix="c0" />);
      const routing = document.querySelector('[data-record-kind="routing"] [data-status]');
      expect(routing?.textContent, status).toBe(words);
      expect(routing?.querySelector("svg"), `${status} has an icon`).toBeTruthy();
      unmount();
    }
  });

  it("securing says so and shows 'Securing your site...'", () => {
    card(withTargets("attached"));
    expect(screen.getByText("Securing your site")).toBeTruthy();
    expect(screen.getByText(/Securing your site\.\.\. this usually takes a few minutes\./)).toBeTruthy();
    expect(screen.getByText("Keep this record in place; it protects your domain from being claimed by someone else.", { selector: "li span" })).toBeTruthy();
  });

  it("a bare domain gets the A-record / ALIAS explanation; a proxied record gets the grey-cloud instruction and is flagged in the troubleshooting list", () => {
    const rows = fixturePair("attached", { observation: observation({ targets: FIXTURE_TARGETS }) });
    rows[0] = {
      ...rows[0]!,
      observation: observation({ targets: FIXTURE_TARGETS, routing: { records: [{ hostname: "church-one.invalid", status: "conflicting", hint: "proxied", apex: true }] } }),
    };
    render(<DomainClaimCard group={fixtureGroups(rows)[0]!} idPrefix="c0" />);
    expect(screen.getByText(/Set it to DNS only \(grey cloud\)/)).toBeTruthy();
    const aRecord = document.querySelector('[data-record-type="A"]');
    expect(aRecord?.textContent).toContain("203.0.113.9");
    // the proxied cause is marked "We see this" inside the (collapsed) panel
    expect(document.querySelector('[data-cause="proxied"]')?.textContent).toContain("We see this");
    expect(document.querySelector('[data-cause="caa"]')?.textContent).not.toContain("We see this");
  });

  it("the generic-targets qualifier shows only when the provider's own recommendation was never readable (ruling 3b)", () => {
    card(fixtureGroup("attached", { observation: observation({ targets: { ...FIXTURE_TARGETS, source: "generic" } }) }));
    expect(screen.getByTestId("generic-targets-note").textContent).toMatch(/standard values/);
    cleanup();
    card(withTargets("attached"));
    expect(screen.queryByTestId("generic-targets-note")).toBeNull();
  });

  it("an unavailable provider reads as safe-to-proceed, with no provider text", () => {
    card(fixtureGroup("attach_pending", { lastCheckClass: "provider_unavailable", observation: observation({ targets: FIXTURE_TARGETS }) }));
    expect(screen.getByText(/Connecting is temporarily unavailable\. Your DNS changes are safe to make/)).toBeTruthy();
  });

  it("a failed lookup says 'We couldn't check right now', never 'missing'", () => {
    card(fixtureGroup("pending", { lastCheckClass: "dns_unknown" }));
    expect(screen.getByText("We couldn't check right now. Try again in a few minutes.")).toBeTruthy();
  });
});

describe("DomainClaimCard - live", () => {
  it("is live, links to the site in a new tab with a safe rel, and shows primary and alias roles", () => {
    card(fixtureGroup("live", { observation: observation({ targets: FIXTURE_TARGETS }) }));
    expect(screen.getByText("Live", { selector: "[data-slot='badge']" })).toBeTruthy();
    const link = screen.getByRole("link", { name: /View your site/ });
    expect(link.getAttribute("href")).toBe("https://www.church-one.invalid/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Primary address · Live/)).toBeTruthy();
    expect(screen.getByText(/Sends visitors to your primary address · Live/)).toBeTruthy();
  });

  it("offers the per-host slot (make primary) and the action slot", () => {
    card(fixtureGroup("live"), {
      actions: <button type="button">Group action</button>,
      hostActions: (h) => (h.role === "alias" ? <button type="button">Make {h.displayHostname} primary</button> : null),
    });
    expect(screen.getByRole("button", { name: "Group action" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /primary$/ })).toHaveLength(1);
  });

  it("a paused host says Paused in the chip and in its row, and no live link is offered", () => {
    card(fixtureGroup("live", { platformHold: "paused" }));
    expect(screen.getByText("Paused", { selector: "[data-slot='badge']" })).toBeTruthy();
    expect(screen.getAllByText(/Paused by PresbyPortal support/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /View your site/ })).toBeNull();
    expect(screen.getByText(/Your domain is paused by PresbyPortal support\. Your site is still available at presbyportal\.invalid\/site\/alder-creek\./)).toBeTruthy();
  });

  it("a disputed host reads as under review", () => {
    card(fixtureGroup("live", { platformHold: "disputed" }));
    expect(screen.getAllByText(/Under review by PresbyPortal support/).length).toBeGreaterThan(0);
  });

  it("shows when it was last checked", () => {
    card(fixtureGroup("live", { lastCheckedAt: new Date("2030-01-02T03:04:05Z") }));
    expect(screen.getByText(/Last checked/)).toBeTruthy();
  });
});

describe("DomainClaimCard - lapsed, parked, releasing (the exit)", () => {
  it("lapsed asks for the record back and says where the site serves meanwhile", () => {
    card(fixtureGroup("lapsed"));
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText(/We can no longer find your verification record\. Your site is serving from presbyportal\.invalid\/site\/alder-creek until it's restored\./)).toBeTruthy();
    expect(screen.getByText(/Put this record back at your DNS provider/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Progress" })).toBeNull(); // no step list once it has lapsed
  });

  it("parked shows the offboarding checklist: valid-HTTPS-first, the records to delete, keep the TXT, weekly check, the date", () => {
    card(
      fixtureGroup("parked", {
        graceEndsAt: new Date("2030-02-01T00:00:00Z"),
        observation: observation({ targets: FIXTURE_TARGETS }),
      }),
    );
    const off = screen.getByTestId("offboarding-card");
    expect(within(off).getByText(/Before you delete anything,/)).toBeTruthy();
    expect(within(off).getByText(/valid HTTPS/)).toBeTruthy();
    expect(within(off).getByRole("heading", { name: "Delete these records from your DNS" })).toBeTruthy();
    expect(within(off).getByRole("heading", { name: "Keep this one until the domain is released" })).toBeTruthy();
    expect(off.textContent).toMatch(/once a week/);
    expect(off.textContent).toMatch(/MX, SPF/);
    // no DNS-record editing controls inside the exit list
    expect(within(off).queryByRole("button", { name: /^Copy/ })).toBeNull();
    // and the main records section is hidden once parked
    expect(screen.queryByRole("heading", { name: "DNS records" })).toBeNull();
  });

  it("releasing says so and still shows the exit list", () => {
    card(fixtureGroup("release_pending"));
    expect(screen.getByText("Releasing", { selector: "[data-slot='badge']" })).toBeTruthy();
    expect(screen.getByText("We're releasing this domain. You can delete its DNS records now.")).toBeTruthy();
    expect(screen.getByTestId("offboarding-card")).toBeTruthy();
  });

  it("with no routing record cached, the exit list says there is nothing we know of to delete", () => {
    card(fixtureGroup("parked"));
    expect(screen.getByText(/There are no records pointing at us that we know of/)).toBeTruthy();
  });
});

describe("DomainClaimCard - failure states the church can reach", () => {
  it("held elsewhere is an alert and names no organization", () => {
    card(fixtureGroup("pending", { lastCheckClass: "held_elsewhere" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("This domain is already connected to another organization. Contact support.");
  });

  it("a name the hosting provider refused says to contact support, without provider text", () => {
    card(fixtureGroup("attach_pending", { lastCheckClass: "provider_rejected" }));
    expect(screen.getByRole("alert").textContent).toBe("We couldn't connect this name. Contact support.");
  });
});

describe("the troubleshooting panel is a button-controlled region, never <details>", () => {
  it("renders no <details> or <summary> anywhere in a card", () => {
    const { container } = card(fixtureGroup("attached"));
    expect(container.querySelector("details, summary")).toBeNull();
  });
});
