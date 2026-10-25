"use client";

import { useEffect, useRef } from "react";

/**
 * The scroll behaviour of `ButtonGroup` (Increment 3a, section 7.1). Renders
 * nothing visible; on mount and on resize it centres the `aria-current="page"`
 * item in its parent and keeps `data-fade-left` / `data-fade-right` on the
 * parent in step with scroll position, which the parent's classes turn into an
 * edge fade. The container is scrolled directly (never `scrollIntoView`), so
 * the page itself does not jump. Before hydration nothing changes.
 */

/** The scrollLeft that centres an item, clamped to the scrollable range. */
export function centredScrollLeft(m: {
  itemLeft: number;
  itemWidth: number;
  clientWidth: number;
  scrollWidth: number;
}): number {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  const target = m.itemLeft - (m.clientWidth - m.itemWidth) / 2;
  return Math.min(max, Math.max(0, Math.round(target)));
}

/** Which edges have more content to scroll to. Nothing overflows: neither. */
export function fadeState(m: { scrollLeft: number; clientWidth: number; scrollWidth: number }): {
  left: boolean;
  right: boolean;
} {
  const max = m.scrollWidth - m.clientWidth;
  if (max <= 1) return { left: false, right: false };
  return { left: m.scrollLeft > 1, right: m.scrollLeft < max - 1 };
}

export function ButtonGroupScroll() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = marker.current?.parentElement;
    if (!container) return;

    const syncFade = () => {
      const { left, right } = fadeState(container);
      container.dataset.fadeLeft = String(left);
      container.dataset.fadeRight = String(right);
    };
    const centre = () => {
      const active = container.querySelector<HTMLElement>('[aria-current="page"]');
      if (active) {
        const c = container.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        container.scrollLeft = centredScrollLeft({
          itemLeft: container.scrollLeft + (a.left - c.left),
          itemWidth: a.width,
          clientWidth: container.clientWidth,
          scrollWidth: container.scrollWidth,
        });
      }
      syncFade();
    };

    centre();
    container.addEventListener("scroll", syncFade, { passive: true });
    // Absent in jsdom; every real browser has it.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(centre);
    observer?.observe(container);
    return () => {
      container.removeEventListener("scroll", syncFade);
      observer?.disconnect();
    };
  }, []);

  return <span ref={marker} hidden aria-hidden />;
}
