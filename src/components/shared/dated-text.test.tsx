// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DatedText } from "./dated-text";

afterEach(cleanup);

describe("DatedText", () => {
  it("puts a <time> where each placeholder stood and keeps the sentence around it", () => {
    const { container } = render(
      <p>
        <DatedText
          dates={[new Date("2026-10-20T12:00:00Z"), "2026-11-03"]}
          render={(sent, expires) => `Sent ${sent}, expires ${expires}.`}
        />
      </p>,
    );
    const times = container.querySelectorAll("time");
    expect(times).toHaveLength(2);
    expect(times[0].getAttribute("datetime")).toBe("2026-10-20T12:00:00.000Z");
    // A calendar date stays a calendar date (no invented midnight).
    expect(times[1].getAttribute("datetime")).toBe("2026-11-03");
    expect(container.textContent).toMatch(/^Sent .+, expires .+\.$/);
  });

  it("renders a sentence with no dates unchanged", () => {
    const { container } = render(<p><DatedText dates={[]} render={() => "No dates here."} /></p>);
    expect(container.textContent).toBe("No dates here.");
    expect(container.querySelector("time")).toBeNull();
  });

  it("a copy function that ignores its placeholder renders no time", () => {
    const { container } = render(<p><DatedText dates={[new Date()]} render={() => "Plain."} /></p>);
    expect(container.querySelector("time")).toBeNull();
  });
});
