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
