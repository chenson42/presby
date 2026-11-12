/**
 * T1 - the Spot the scam content module (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3
 * Tests T1; Copy G6 and G7; DECISION-335). Pure. Pins what the operator approved byte for
 * byte, and closes the fictional world: no live text, no phone-shaped string, no domain
 * outside the closed `.invalid` set.
 */
import { describe, expect, it } from "vitest";
import { CHURCH, LAST_REVIEWED, RULES, SCENARIOS, VERSION } from "./content";
import { FRAME } from "./copy";

/** Every string in a scenario, with where it came from. */
function strings(): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  SCENARIOS.forEach((s, i) => {
    const w = `scenario ${i + 1}`;
    for (const key of ["from", "fromAddress", "subject", "meta", "direction", "verdictTitle", "lesson"] as const) {
      const v = s[key];
      if (typeof v === "string") out.push({ where: `${w}.${key}`, text: v });
    }
    s.body.forEach((t, j) => out.push({ where: `${w}.body[${j}]`, text: t }));
    s.tells.forEach((t, j) => out.push({ where: `${w}.tells[${j}]`, text: t }));
  });
  RULES.forEach((t, i) => out.push({ where: `rule ${i + 1}`, text: t }));
  out.push({ where: "CHURCH.name", text: CHURCH.name }, { where: "CHURCH.domain", text: CHURCH.domain });
  return out;
}

describe("the set", () => {
  it("is seven messages with the voicemail LAST, and six rules", () => {
    expect(SCENARIOS).toHaveLength(7);
    expect(SCENARIOS.map((s) => s.channel)).toEqual(["email", "email", "text", "email", "email", "email", "voicemail"]);
    expect(RULES).toHaveLength(6);
  });

  it("has at least one genuine and one scam message, and every scam has at least 3 tells (5 scams, 2 genuine)", () => {
    const scams = SCENARIOS.filter((s) => s.isScam);
    expect(scams).toHaveLength(5);
    expect(SCENARIOS.filter((s) => !s.isScam)).toHaveLength(2);
    for (const s of scams) expect(s.tells.length, s.verdictTitle).toBeGreaterThanOrEqual(3);
  });

  it("the count and the lede move together: SCENARIOS.length === 7 and the lede begins with the word `Seven`", () => {
    expect(SCENARIOS.length).toBe(7);
    expect(FRAME.lede.startsWith("Seven ")).toBe(true);
  });

  it("VERSION is a positive integer and LAST_REVIEWED an ISO date", () => {
    expect(Number.isInteger(VERSION) && VERSION > 0).toBe(true);
    expect(LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(LAST_REVIEWED))).toBe(false);
  });

  it("names the one made-up church, on a .invalid domain", () => {
    expect(CHURCH).toEqual({ name: "Thistledown Presbyterian Church", domain: "thistledownpres.invalid" });
  });

  it("every message carries the fields its channel renders", () => {
    for (const s of SCENARIOS) {
      expect(s.body.length, s.verdictTitle).toBeGreaterThan(0);
      expect(s.verdictTitle.length).toBeGreaterThan(0);
      expect(s.lesson.length).toBeGreaterThan(0);
      if (s.channel === "email") {
        expect(s.fromAddress, s.from).toMatch(/^[a-z.-]+@[a-z-]+(\.[a-z]+)+$/);
        expect(s.subject, s.from).toBeTruthy();
      } else {
        expect(s.fromAddress, s.from).toBeUndefined();
        expect(s.subject, s.from).toBeUndefined();
        expect(s.meta, s.from).toBeTruthy();
      }
    }
  });
});

describe("no live text, no phone-shaped string (F439, A5)", () => {
  it("no http(s)://, www., tel:, mailto:, markup, entity or backtick in any string", () => {
    for (const { where, text } of strings()) {
      expect(text, where).not.toMatch(/https?:\/\//i);
      expect(text, where).not.toMatch(/\bwww\./i);
      expect(text, where).not.toMatch(/\btel:/i);
      expect(text, where).not.toMatch(/\bmailto:/i);
      expect(text, where).not.toMatch(/[<>&`]/);
    }
  });

  it("no phone-shaped string and no run of 7 or more digits (the grouped routing and account numbers pass)", () => {
    for (const { where, text } of strings()) {
      expect(text, where).not.toMatch(/\d{7,}/);
      // 3-3-4 or 3-4 in any separator style, with an optional (area code).
      expect(text, where).not.toMatch(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/);
      expect(text, where).not.toMatch(/\b\d{3}[\s.-]\d{4}\b/);
      expect(text, where).not.toMatch(/\+\d/);
    }
  });

  it("no date or time a data detector would offer to act on", () => {
    for (const { where, text } of strings()) {
      // The voicemail header's `0:41` is a duration, not a time of day (it is pinned below).
      if (text !== "Voicemail · 0:41") expect(text, where).not.toMatch(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/i);
      expect(text, where).not.toMatch(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/);
      expect(text, where).not.toMatch(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i);
    }
  });
});

describe("the fictional world is closed", () => {
  // The closed set of domains a message may mention.
  const CLOSED = new Set([
    "thistledownpres.invalid",
    "thistledown-pres.invalid",
    "brightwatersupply.invalid",
    "brightwater-supply.invalid",
    "mailbox-quota-alerts.invalid",
  ]);

  it("every domain-shaped token (`@x.y` or a bare `x.y`) is in the closed set, and the set is actually exercised", () => {
    const found = new Set<string>();
    for (const { where, text } of strings()) {
      // Drop an address's local part (`ellis.hartwell@`), then find labels joined by dots. A
      // sentence end (`word.` then a space) has no letters after the dot, so it is not one.
      const bare = text.replace(/[\w.+-]+@/g, "@");
      for (const m of bare.matchAll(/(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g)) {
        const token = m[0].toLowerCase();
        found.add(token);
        expect(CLOSED.has(token), `${where}: ${token}`).toBe(true);
      }
    }
    expect([...found].sort()).toEqual([...CLOSED].sort());
  });

  it("every look-alike is a hyphen swap of a real domain, and the real ones are the made-up church's and vendor's", () => {
    const addrs = SCENARIOS.filter((s) => s.fromAddress).map((s) => s.fromAddress!.split("@")[1]!);
    expect(new Set(addrs)).toEqual(
      new Set(["thistledown-pres.invalid", "thistledownpres.invalid", "brightwater-supply.invalid", "mailbox-quota-alerts.invalid"]),
    );
    // The genuine messages come from the church's real domain; every scam email from something else.
    for (const s of SCENARIOS.filter((x) => x.channel === "email")) {
      const domain = s.fromAddress!.split("@")[1]!;
      if (s.isScam) expect(domain, s.verdictTitle).not.toBe(CHURCH.domain);
      else expect(domain, s.verdictTitle).toBe(CHURCH.domain);
    }
  });

  it("the routing number's first two digits are outside every Federal Reserve range, so it is invalid by construction", () => {
    const line = SCENARIOS[3]!.body.find((b) => b.startsWith("Routing:"));
    expect(line).toBe("Routing: 9900 00001 · Account: 0000 1234 5678");
    const first = Number(line!.match(/Routing: (\d{2})/)![1]);
    // ABA prefixes in use: 00-12, 21-32, 61-72, 80. (Thrift 01-12 +20, electronic 21-32 +60, 80.)
    const valid = (n: number) => (n >= 0 && n <= 12) || (n >= 21 && n <= 32) || (n >= 61 && n <= 72) || n === 80;
    expect(valid(first)).toBe(false);
  });

  it("names no council, synod, presbytery or real company or place", () => {
    for (const { where, text } of strings()) {
      // "Presbyterian" is the made-up church's own name and is the only allowed use.
      const without = text.replace(/Thistledown Presbyterian Church/g, "");
      expect(without, where).not.toMatch(/\b(presbytery|synod|general assembly|PC\(USA\)|walmart|target|kroger|amazon|apple|google|paypal|venmo|zelle|irs|aarp)\b/i);
    }
  });
});

describe("the operator-approved voicemail (scenario 7, 2026-11-11), byte for byte", () => {
  const v = SCENARIOS[6]!;

  it("channel, header, sender, direction and the absence of an address", () => {
    expect(v.channel).toBe("voicemail");
    expect(v.meta).toBe("Voicemail · 0:41");
    expect(v.from).toBe("Unknown caller");
    expect(v.direction).toBe("(crying, out of breath)");
    expect(v.fromAddress).toBeUndefined();
    expect(v.isScam).toBe(true);
  });

  it("the transcript", () => {
    expect(v.body).toEqual([
      "\"Grandma? Grandma, it's me. Please don't be mad. I was in a car accident and they're saying it was my fault, and I'm at the police station. My nose is broken, so I sound weird. Please don't call Mom and Dad, they'll kill me. There's a lawyer here, Mr. Grant. He's going to call you back in a few minutes and tell you what to do. Please, Grandma, I'm so scared. I love you.\"",
    ]);
  });

  it("the verdict title and the five tells", () => {
    expect(v.verdictTitle).toBe("This is the \"grandchild in trouble\" scam, now with a cloned voice.");
    expect(v.tells).toEqual([
      "The voice can sound exactly right. A few seconds of someone's voice from a video online is enough for AI to copy it. A voice that sounds like your grandchild no longer proves it's your grandchild.",
      "It explains away anything that sounds off. \"My nose is broken, so I sound weird\" is there so you won't trust your doubts.",
      "It asks you to keep it secret. \"Don't call Mom and Dad\" stops you from checking with the one person who could clear it up in a minute.",
      "It's a crisis that only money fixes. A \"lawyer\" will call next asking for bail, often cash handed to a courier who comes to your door, or gift cards.",
      "It's built to rush you. Fear and love are used so you act before you think.",
    ]);
  });

  it("the lesson", () => {
    expect(v.lesson).toBe(
      "Hang up and call your grandchild yourself, on the number you already have. If they don't answer, call their parents, even though the message told you not to. Then agree on a family code word that only your family knows, and ask for it whenever a call like this comes in. Police and courts never take bail in cash at your door or in gift cards.",
    );
  });

  it("the sixth rule is the approved sentence; the other five are the prototype's, unchanged", () => {
    expect(RULES[5]).toBe(
      "A familiar voice is not proof. Hang up and call back on a number you already have — and agree on a family code word.",
    );
    expect(RULES.slice(0, 5)).toEqual([
      "Verify through a second channel you already trust — call the number you have, not the one in the message.",
      "No pastor, treasurer, or church body will ever ask for gift-card codes. That request alone settles it.",
      "Urgency + secrecy = stop. Real ministry survives a one-day pause to check.",
      "Look at the actual sending address or number, not the display name.",
      "Never sign in through an emailed link — go to the site the way you always do.",
    ]);
  });
});

describe("the six rewritten messages carry the approved Copy G6 text", () => {
  it("scenario 1: the pastor gift-card scam", () => {
    const s = SCENARIOS[0]!;
    expect([s.from, s.fromAddress, s.subject, s.isScam]).toEqual([
      "Pastor Ellis Hartwell",
      "ellis.hartwell@thistledown-pres.invalid",
      "Quiet favor — please keep between us",
      true,
    ]);
    expect(s.verdictTitle).toBe("This is the classic pastor gift-card scam.");
    expect(s.body[2]).toBe("I'm heading into a hospital visit and can't take calls. Please do this quickly and keep it between us.");
    expect(s.tells).toHaveLength(4);
  });

  it("scenario 2 and 6 are genuine and from the church's real domain; scenario 3 is a text with no number", () => {
    expect(SCENARIOS[1]!.verdictTitle).toBe("This one is genuine.");
    expect(SCENARIOS[5]!.verdictTitle).toBe("This one is genuine.");
    expect(SCENARIOS[2]!.meta).toBe("Text message · A number you don't have saved");
    expect(SCENARIOS[2]!.fromAddress).toBeUndefined();
  });

  it("scenario 4 is a vendor invoice aimed at the treasurer, with no council named", () => {
    const s = SCENARIOS[3]!;
    expect(s.verdictTitle).toBe("This is business email compromise, aimed at your treasurer.");
    expect(s.body[0]).toBe("Dear Treasurer,");
  });

  it("scenario 5: the button is bracketed text, not a control", () => {
    expect(SCENARIOS[4]!.body[2]).toBe("[A large button reads: KEEP MY ACCOUNT ACTIVE]");
  });
});
