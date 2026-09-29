import { useCallback, useEffect, useRef, useState } from "react";

import type { SectionKey } from "./sections";
import { SECTIONS, sectionDomId } from "./sections";

// WHICH SECTION YOU ARE READING — and a way to jump to one.
//
// THE RULE: the active section is the last one whose top has passed the READING LINE, a little below
// the sticky header — the line your eye is on when the header is out of the way. When the page can
// scroll no further, the LAST section is active instead, because a short final section may never reach
// the line before the page runs out.
//
// ⚠ "AT THE END" MEANS THE SCROLLER IS AT ITS END — not "the bottom of the page is visible". An earlier
// version used a sentinel after the last section and lit Withdrawal the moment it came into view, which
// on a normal screen is while you are still reading Shipping: a wheel scroll went Items → Withdrawal and
// skipped three sections.
//
// ⚠ IT FINDS ITS OWN SCROLLER. In the app the desktop shell scrolls `<main>`; in Storybook the window
// scrolls. The listener is captured on `window` — scroll does not bubble, but it CAN be captured, so one
// listener hears whichever ancestor is moving — and the end test walks up from the sections to the
// nearest ancestor that actually scrolls. Nested scrollers BELOW the page (a table's own box, the phone's
// chip strip) are not ancestors and so can never be mistaken for it.
//
// ⚠ A CLICK LOCKS IT while the smooth scroll runs. Otherwise the highlight walks through every section in
// between on the way down, which reads as the nav arguing with the click.

/** How far below the header's bottom edge the reading line sits. */
const LINE_OFFSET = 24;

/** How long a click's smooth scroll is allowed before position takes over again. */
const LOCK_MS = 1000;

/** The element whose scrolling moves `el` — the nearest scrollable ancestor, else the document. */
function scrollerOf(el: Element): Element {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);

    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }

  return document.scrollingElement ?? document.documentElement;
}

export function useScrollSpy(
  ready: boolean,
  headerRef: { current: HTMLElement | null },
  /**
   * The sections scrolling may light. Omitted = all of them.
   *
   * ⚠ WITH A SIDE COLUMN, ONLY THE MAIN ONE. The side cards are short reference facts sitting BESIDE
   * the main column, so their tops pass the reading line early and one of them would win while the
   * reader is halfway down the items. They light when clicked; scrolling tracks the column being read.
   */
  candidates?: SectionKey[],
): {
  active: SectionKey;
  scrollTo: (key: SectionKey) => void;
} {
  const first = SECTIONS[0]!.key;
  const last = SECTIONS[SECTIONS.length - 1]!.key;

  const [active, setActive] = useState<SectionKey>(first);
  const lockedUntil = useRef(0);

  useEffect(() => {
    // The sections only exist once the order has loaded.
    if (!ready) {
      return;
    }

    let frame = 0;

    const decide = () => {
      if (Date.now() < lockedUntil.current) {
        return;
      }

      const firstEl = document.getElementById(sectionDomId(first));

      if (!firstEl) {
        return;
      }

      const scroller = scrollerOf(firstEl);
      const atEnd =
        scroller.scrollTop > 0 &&
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2;

      if (atEnd) {
        setActive(candidates?.[candidates.length - 1] ?? last);
        return;
      }

      const line = (headerRef.current?.getBoundingClientRect().bottom ?? 0) + LINE_OFFSET;

      // ⚠ THE CLOSEST SECTION ABOVE THE LINE, not the last one in list order. With the side column the
      // page is no longer one stack: Penerima (side) can sit higher on screen than Timeline (main) while
      // coming later in the list, so "last in the list whose top has passed" lit a side card while the
      // reader was in the middle of the main column.
      let current: SectionKey = first;
      let best = -Infinity;

      for (const section of SECTIONS) {
        if (candidates && !candidates.includes(section.key)) {
          continue;
        }

        const top = document.getElementById(sectionDomId(section.key))?.getBoundingClientRect().top;

        if (top !== undefined && top <= line && top > best) {
          best = top;
          current = section.key;
        }
      }

      setActive(current);
    };

    // One decision per frame, however many scroll events the frame produced.
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(decide);
    };

    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    decide();

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [ready, first, last, headerRef, candidates]);

  const scrollTo = useCallback((key: SectionKey) => {
    const el = document.getElementById(sectionDomId(key));

    if (!el) {
      return;
    }

    // Reduced motion means no smooth scroll — a jump, and only a moment's lock.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setActive(key);
    lockedUntil.current = Date.now() + (reduce ? 100 : LOCK_MS);

    // `scrollMarginTop` on the section keeps its title clear of the sticky header.
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);

  return { active, scrollTo };
}
