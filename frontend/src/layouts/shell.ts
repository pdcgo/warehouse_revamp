import { useEffect, useState } from "react";

// The fact BOTH shells need, and neither owns: `useIsMobile` decides which one mounts. It lives out here because a copy
// in each shell is a copy that drifts — and the second one drifting is invisible, since you only ever see one shell at a
// time.
//
// ⚠ NO PAGE HAS A CANVAS OF ITS OWN (owner, on the batch page: *"kenapa latar belakang di batch detail beda sendiri?"*,
// then *"kerjakan"*, every-page-is-on-one-canvas). A route-chosen grey canvas (`usesGreyCanvas`) painted the batch page
// alone, from the repo's first commit and no decision; every other detail page is white, and the batch page is their
// shape. Both shells leave <main> unpainted, so every page sits on the app's own ground.

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
