import type { Location } from "react-router-dom";

// WHERE A PAGE WAS OPENED FROM, carried in the navigation's `state` by the screen that opened it — so a form can go back
// to the screen somebody actually came from (owner, on the product form: *"kembalinya bisa ga baca route sebelumnya,
// kalau sebelumnya di detail maka ke situ, jika tidak ke list"*).
//
// The state, not the browser's history: `navigate(-1)` after a save would step back onto the form's own past, and a
// page opened from a pasted link has no "before" at all. The state travels only with an in-app navigation, so a deep
// link simply has none and the page falls back to its own default.

/** The navigation state that records the current screen — the path AND its query, so a filtered list comes back filtered. */
export function fromHere(location: Pick<Location, "pathname" | "search">): { from: string } {
  return { from: location.pathname + location.search };
}

/** The screen this page was opened from, or undefined when it was reached any other way. */
export function cameFrom(location: Pick<Location, "state">): string | undefined {
  const state = location.state as { from?: unknown } | null;
  return typeof state?.from === "string" ? state.from : undefined;
}
