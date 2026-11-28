// HOW A THING THAT OPENS ANSWERS THE POINTER AND THE THUMB (`motion-is-small-quick-and-shared`) — the timing is the
// theme's (`durations.hover`), so these say only WHAT moves. Spread on a Chakra element: `<Stack {...PRESSABLE}>`.

// A block that opens something — a phone's row, a figure block: it lights up under a pointer, and gives a little under
// a thumb, so a tap is felt before the next screen arrives.
export const PRESSABLE = {
  cursor: "pointer",
  transitionProperty: "background-color, scale",
  transitionDuration: "hover",
  _hover: { bg: "bg.muted" },
  _active: { bg: "bg.muted", scale: "0.99" },
} as const;

// A card that opens something — it rises a little and casts a shadow under a pointer, then settles back under the
// press. For a grid of cards, where lighting up alone does not say which one is about to open.
export const LIFTS = {
  cursor: "pointer",
  transitionProperty: "background-color, translate, box-shadow, scale",
  transitionDuration: "hover",
  _hover: { bg: "bg.muted", translate: "0 -2px", shadow: "md" },
  _active: { bg: "bg.muted", translate: "0", scale: "0.99", shadow: "sm" },
} as const;

/** How far apart two blocks of a page that arrives in order start — a beat short of `enter` itself, so they overlap. */
export const ENTER_STEP_MS = 50;

// A PAGE THAT ARRIVES IN ORDER (owner, on a batch's page: *"tambah animasi"*, the-batch-page-arrives-in-order) — each
// block takes the page's own `enter` (a fade and an 8px rise), one step after the one above it, so the eye is led down
// the page: the heading, then the figures, then the sections. The PAGE root then carries no `enter` of its own — a rise
// inside a rise reads as 16px.
//
//   step 0  heading  ░▒█
//   step 1  figures    ░▒█             50ms apart, 180ms each — the last block of four settled by 330ms
//   step 2  section      ░▒█
//
// `backwards` holds a block at the first keyframe (invisible) until its step comes, so nothing shows and then jumps
// back. Played on mount only, like every `enter`; a device that asks for less motion gets none (theme.ts).
export function enterStep(step: number) {
  return {
    animationStyle: "enter",
    animationDelay: `${step * ENTER_STEP_MS}ms`,
    animationFillMode: "backwards",
  } as const;
}
