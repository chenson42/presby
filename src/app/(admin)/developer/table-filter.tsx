"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Filter for the whole data model. A reviewer arrives looking for one thing — "where does
 * roll status live", "what touches consent" — and scrolling the whole register
 * to find it is the difference between a page you read and one you skim past.
 *
 * Matches the table name, its description, AND every column description, so
 * searching "presbytery" finds the tables that talk about presbyteries rather
 * than only the one named for them.
 *
 * Filters server-rendered DOM directly rather than re-rendering in React: the
 * entries are already on the page and there is no reason to ship them twice.
 * The visible count is written straight to its node for the same reason — and
 * because setting React state from an effect on every keystroke is a re-render
 * that buys nothing here.
 */
export function TableFilter({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const countRef = useRef<HTMLSpanElement>(null);
  const emptyRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const needle = q.trim().toLowerCase();
    let visible = 0;

    for (const el of document.querySelectorAll<HTMLElement>("[data-haystack]")) {
      const hit = !needle || el.dataset.haystack!.includes(needle);
      el.hidden = !hit;
      if (hit) visible++;
    }

    // Hide a module heading whose entries have all been filtered out, so the
    // reader is not left scrolling past empty sections.
    for (const sec of document.querySelectorAll<HTMLElement>("[data-section]")) {
      sec.hidden = !sec.querySelector("[data-haystack]:not([hidden])");
    }

    if (countRef.current) {
      countRef.current.textContent = needle
        ? `${visible} of ${total}`
        : `${total} tables`;
    }

    // Filtered to nothing: say so, rather than leave a blank page.
    if (emptyRef.current) {
      emptyRef.current.hidden = visible !== 0;
    }
  }, [q, total]);

  return (
    <>
      <div className="reg__filter">
        <label className="reg__filterLabel" htmlFor="reg-filter">
          Find
        </label>
        <input
          id="reg-filter"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="table, column, or anything in a description"
          className="reg__filterInput"
          autoComplete="off"
        />
        <span className="reg__filterCount" aria-live="polite" ref={countRef}>
          {total} tables
        </span>
      </div>
      <p className="reg__empty" role="status" ref={emptyRef} hidden>
        No table matches that. Clear the search to see all {total}.
      </p>
    </>
  );
}
