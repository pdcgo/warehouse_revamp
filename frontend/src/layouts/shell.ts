import { useEffect, useState } from "react";

// The two facts BOTH shells need, and neither owns.
//
// `useIsMobile` decides which one mounts; `usesGreyCanvas` decides what the content area is painted.
// They live out here because a copy in each shell is a copy that drifts — and the second one drifting
// is invisible, since you only ever see one shell at a time.

// The breakpoint the shell splits on — Chakra's `md` (48em), minus a hair, so this and a `hideFrom`
// /`hideBelow` inside a page can never disagree about which side of it we are on.
const MOBILE_QUERY = "(max-width: 47.9375em)";

/**
 * True on a narrow screen — the one decision that picks DesktopLayout or MobileLayout.
 *
 * ⚠ THIS IS A JS BREAKPOINT, NOT `hideFrom`/`hideBelow`, and that is the whole point of the split.
 * Hiding one shell with CSS mounts BOTH: two `<Outlet/>`s rendering every page twice, two
 * `navigation` landmarks, and two of every `data-testid` the e2e reach for. The mobile shell is a
 * different structure rather than a restyled one, so exactly one of them may exist.
 *
 * The cost is a re-mount when the viewport crosses 768px. That happens when someone drags a desktop
 * window; it does not happen on a phone.
 */
export function useIsMobile(): boolean {
  // Read synchronously on the first render, so the app never paints the wrong shell for a frame.
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches);

    // Re-read on mount too: the viewport can have changed between the initial state and the effect.
    setMobile(query.matches);
    query.addEventListener("change", onChange);

    return () => query.removeEventListener("change", onChange);
  }, []);

  return mobile;
}

/**
 * Pages that opt into the grey page canvas rather than the default white content area.
 *
 * THE SHELL OWNS THE SURFACE, and it decides by ROUTE — a page painting its own background is how
 * two screens end up drawing the same "page" two slightly different colours. Batch detail is the
 * only one so far; its detail route is /inventories/batches/:batchId.
 */
export function usesGreyCanvas(pathname: string): boolean {
  return pathname.startsWith("/inventories/batches/");
}

// The grey canvas itself, as a Chakra `bg` value.
//
// ⚠ THE LIGHT SIDE IS `base`, NOT `_light`. As an INLINE condition, `_light` composes to
// `.css-x:root .css-x` — a selector that can never match — so the grey canvas was silently missing in
// light mode and appeared only in dark. (`_light` in theme.ts is fine and stays: a semantic token is
// emitted at `:root` scope, not nested under an element's own class.)
export const GREY_CANVAS = { base: "#f6f7f9", _dark: "#0c0e12" };
