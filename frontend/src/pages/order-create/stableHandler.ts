import { useCallback, useLayoutEffect, useRef } from "react";

// A HANDLER THAT IS THE SAME FUNCTION ON EVERY RENDER, AND STILL DOES WHAT THE LATEST RENDER'S WOULD (#135,
// the-speed-audits-old-findings-are-fixed-smallest-first) — what lets a memoised card or dialog take one of the page's
// handlers (Create Anyway, Place Anyway, the leave guard's answers) without re-rendering on every keystroke typed
// anywhere else on the form.
//
// The handlers keep reading the render they were written in — `runChecks` the ref and the price as they stand, Try
// Again's `sent` — so the page's logic is unchanged: the stable function only forwards to the newest of them. It is
// re-pointed in a LAYOUT effect, which runs in the commit itself, before the browser can deliver a click or a key: no
// event ever reaches the function of an older render.
//
// ⚠ For EVENTS only — never call one while rendering (a child computing a label from it): during a render the newest
// function is not yet in place. A value a card renders from is passed as a prop (or a `useCallback` over what it
// reads, like the refusal's `labelOf`), so the card re-renders when it changes.
export function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const latest = useRef(handler);

  useLayoutEffect(() => {
    latest.current = handler;
  });

  return useCallback((...args: A) => latest.current(...args), []);
}
