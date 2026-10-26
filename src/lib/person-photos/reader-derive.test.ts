/**
 * U11: the photos page's status lines from the SQL snapshot (Copy C2), pure.
 * Includes the unattested remedy line and the "listed, never 'showing now'"
 * listing line. The DB half (the snapshot itself, and its parity with the public
 * roster) is `public-photo.db.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { DIRECTORY_LINES, WEBSITE_LINES, listingKinds, listingLine } from "./copy";
import { directoryLine, statusLines, websiteLine } from "./status-lines";
import type { DirectoryStatus, WebsiteStatus } from "./types";

const first = "Ada";
const KEY = "00000000-0000-4000-8000-000000000001";
const dir = (over: Partial<DirectoryStatus> = {}): DirectoryStatus => ({ photoId: null, thumbKey: null, withheld: null, ...over });
const web = (over: Partial<WebsiteStatus> = {}): WebsiteStatus => ({
  imageKey: null,
  source: null,
  withheld: null,
  unattestedDirectoryOnly: false,
  ...over,
});

describe("directory line", () => {
  it.each([
    ["a directory photo is chosen and shown", dir({ photoId: KEY, thumbKey: KEY }), DIRECTORY_LINES.shown],
    ["no directory photo chosen", dir(), DIRECTORY_LINES.none],
    ["hidden by the person's setting", dir({ photoId: KEY, withheld: "hide_photo" }), DIRECTORY_LINES.hide(first)],
    ["appears to be a minor", dir({ photoId: KEY, withheld: "minor" }), DIRECTORY_LINES.minor(first)],
    ["the toggle is off: no line (the page shows its own off state)", dir({ photoId: KEY, withheld: "toggle_off" }), null],
  ])("%s", (_name, status, expected) => {
    expect(directoryLine(first, status)).toBe(expected);
  });
});

describe("website line", () => {
  it.each([
    ["the website designation is served", web({ imageKey: KEY, source: "website" }), WEBSITE_LINES.website],
    ["the attested directory photo stands in", web({ imageKey: KEY, source: "directory_attested" }), WEBSITE_LINES.fallback],
    ["nothing chosen", web(), WEBSITE_LINES.none],
    ["an UNATTESTED directory photo and no website photo: the remedy line, naming both remedies", web({ unattestedDirectoryOnly: true }), WEBSITE_LINES.unattested],
    ["hidden by the person's setting", web({ source: "website", withheld: "hide_photo" }), WEBSITE_LINES.hide(first)],
    ["appears to be a minor", web({ source: "website", withheld: "minor" }), WEBSITE_LINES.minor(first)],
    ["merged into another record", web({ source: "website", withheld: "merged" }), WEBSITE_LINES.merged],
    ["the toggle is off: no line", web({ source: "website", withheld: "toggle_off" }), null],
  ])("%s", (_name, status, expected) => {
    expect(websiteLine(first, status)).toBe(expected);
  });

  it("a withheld answer wins over the unattested remedy (the SQL's reason is what the page reports)", () => {
    expect(websiteLine(first, web({ withheld: "minor", unattestedDirectoryOnly: true }))).toBe(WEBSITE_LINES.minor(first));
  });

  it("the unattested remedy line names both remedies, each of which the same holder performs in the designate dialog", () => {
    expect(WEBSITE_LINES.unattested).toContain("Choose a website photo");
    expect(WEBSITE_LINES.unattested).toContain("clear the directory photo for the website");
  });
});

describe("listing line", () => {
  it("says LISTED, never 'showing now': site status and the platform flags are not read", () => {
    const line = listingLine(first, ["staff"]);
    expect(line).toBe(
      "Ada is listed on your public website (staff). Photos appear there only while the person is listed and the website is published.",
    );
    expect(line).not.toMatch(/showing now|currently showing/i);
  });

  it("renders the kinds in a fixed order, with 'committee member' for a committee", () => {
    expect(listingKinds(["committee"])).toBe("committee member");
    expect(listingKinds(["committee", "staff"])).toBe("staff and committee member");
    expect(listingKinds(["committee", "officer", "staff"])).toBe("staff, officer and committee member");
  });

  it("not listed: names where listing is set, as an instruction to nobody", () => {
    expect(listingLine(first, [])).toBe(
      "Ada isn't listed on your public website, so no photo shows there. Listing is set separately, under Staff, Officers or Groups, by whoever manages those.",
    );
  });
});

describe("statusLines", () => {
  it("assembles the three lines from the three answers", () => {
    expect(
      statusLines({
        first,
        directory: dir({ photoId: KEY, thumbKey: KEY }),
        website: web({ imageKey: KEY, source: "directory_attested" }),
        listings: ["officer"],
      }),
    ).toEqual({
      directory: DIRECTORY_LINES.shown,
      website: WEBSITE_LINES.fallback,
      listing: listingLine(first, ["officer"]),
    });
  });
});
