import { useEffect, useRef, useState } from "react";

import { scrollerOf } from "./useScrollSpy";

// THE TITLE THAT STICKS ONCE IT HAS SCROLLED AWAY — a detail page's title row, and the same row in small in a bar drawn
// over the page once that title has gone behind it (the-title-row-is-the-sticky-bar). The product's page first; the
// discover detail takes the same shape (the-discover-detail-is-the-product-page), which is when it moved here.
//
// Three refs the page hangs on its elements, and what it reads back:
//
//   strip    the sticky box — on a phone it holds the section chips, which always stick
//   bar      the title bar drawn over the page, under the strip
//   title    the page's own heading — the bar shows once it has gone behind the bar
//   past     whether it has — the bar's `opacity` / `visibility`
//   height   the strip plus the bar — published as `--detail-header-h`, what a nav jump has to clear
export function useStickyTitle(ready: boolean, isMobile: boolean) {
  const strip = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [past, setPast] = useState(false);
  const [height, setHeight] = useState(0);

  // What a jump has to clear: the chips (a phone) plus the bar.
  useEffect(() => {
    const barEl = bar.current;
    const stripEl = strip.current;

    if (!barEl || !stripEl) {
      return;
    }

    const measure = () => setHeight(stripEl.getBoundingClientRect().height + barEl.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(barEl);
    observer.observe(stripEl);

    return () => observer.disconnect();
  }, [ready, isMobile]);

  // WHETHER THE TITLE HAS GONE BEHIND THE BAR — the moment the bar takes over saying it. Measured on every scroll against
  // WHERE THE BAR IS DRAWN, not with an IntersectionObserver: the observer's margin had to follow the bar's own height, so
  // the bar appearing re-armed it and it flipped back and forth (owner: *"judul stickynya ngebug di bolak balik"*), and
  // the page's entrance moves the title without the observer hearing it. Captured on `window`, so whichever ancestor
  // scrolls — `<main>` in the app, the window in Storybook — is heard, as useScrollSpy does.
  useEffect(() => {
    if (!ready) {
      return;
    }

    let frame = 0;

    const decide = () => {
      const titleEl = title.current;
      const barEl = bar.current;

      if (!titleEl || !barEl) {
        return;
      }

      // WHERE THE BAR STANDS ONCE IT STICKS — the top of whatever scrolls (`<main>` in the app, the document in
      // Storybook), plus the strip above it on a phone, plus the bar's own height. NOT where the bar is drawn right now:
      // at the top of the page the bar sits just above the title, and measured there the title read as already behind
      // it, so the bar showed from the start (owner: *"stickymu bermasalah, muncul terus"*).
      const scroller = scrollerOf(titleEl);
      const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      const stripHeight = isMobile ? (strip.current?.getBoundingClientRect().height ?? 0) : 0;
      setPast(titleEl.getBoundingClientRect().bottom <= top + stripHeight + barEl.getBoundingClientRect().height);
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(decide);
    };

    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    decide();

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ready, isMobile]);

  return { strip, bar, title, past, height };
}
