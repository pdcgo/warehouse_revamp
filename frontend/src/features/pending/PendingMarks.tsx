import { createContext, useContext } from "react";
import type { ReactNode } from "react";

// WHETHER THE BUILD-STATUS MARKS ARE DRAWN AT ALL (owner, 2026-09-29).
//
// The ⚠ marks and the folded strip above them say what a screen cannot do yet. They are honest and
// they are also scaffolding — and the owner reviewing a LAYOUT needs to see the screen without them,
// because a row of triangles is the loudest thing on a table and it is not part of the design.
//
// ⚠ IT IS NOT A CONTROL IN THE APP (owner: *"tidak ada di tampilan"*). Somebody using the warehouse
// must never be able to turn off the notice that a number on their screen is invented — that is the
// whole reason the marks exist. So there is no switch on any page; the only thing that flips it today
// is Storybook's toolbar, where the audience is the person designing the screen.
//
// ⚠ DEFAULT ON, AND THE DEFAULT IS THE ONE THAT MATTERS. A provider is opt-in and the context's own
// default is `true`, so a screen mounted with no provider at all — which is every screen in the real
// app — shows its marks. Getting this backwards would hide them everywhere and nobody would notice,
// because a missing warning looks exactly like nothing being wrong.
//
// The day a real setting is wanted (a per-user flag, a build flag) it feeds THIS provider and nothing
// below it changes.

const PendingMarksContext = createContext<boolean>(true);

/** Wraps a subtree in a decision about the marks. Storybook's toolbar is its only caller today. */
export function PendingMarksProvider({ show, children }: { show: boolean; children: ReactNode }) {
  return <PendingMarksContext.Provider value={show}>{children}</PendingMarksContext.Provider>;
}

/** `true` unless something above has deliberately turned the marks off. */
export function usePendingMarks(): boolean {
  return useContext(PendingMarksContext);
}
