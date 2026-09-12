// The design system's SEVEN semantic tones, and the one place they resolve to a colour.
//
// The set is inherited from the legacy design system, where each tone was a hand-written pair of
// Tailwind classes repeated in every component that offered a `theme` prop. Here a tone resolves to
// a Chakra `colorPalette`, so every toned component — badge, alert, statistic, progress, button —
// picks up the same ramp, and retuning a tone is one edit here rather than a grep across the app.
//
// A tone is a MEANING, not a colour: "success" is what the caller asserts, green is how this file
// chooses to render it. Never pass a raw Chakra palette where a tone is accepted — that is how two
// screens start disagreeing about what "warning" looks like.
export type Tone =
  | "active" // the accent — the app's own emphasis, not a status
  | "plain" // no emphasis; the neutral default
  | "primary"
  | "info"
  | "success"
  | "warning"
  | "error";

export const TONES: Tone[] = [
  "active",
  "plain",
  "primary",
  "info",
  "success",
  "warning",
  "error",
];

// tone → Chakra colorPalette. "active" maps to `brand`, the app accent defined in theme.ts, so the
// accent stays a single decision even though the ramp itself is still a placeholder identity.
const TONE_PALETTE: Record<Tone, string> = {
  active: "brand",
  plain: "gray",
  primary: "purple",
  info: "blue",
  success: "green",
  warning: "orange",
  error: "red",
};

// palette resolves a tone to the Chakra colorPalette to hand a component.
//
// It falls back to the neutral rather than throwing: a tone arriving from a server enum or a
// hand-typed prop should render something readable, not blank the row it is in.
export function palette(tone: Tone | undefined, fallback: Tone = "plain"): string {
  return TONE_PALETTE[tone ?? fallback] ?? TONE_PALETTE[fallback];
}

// WithTone is the shared prop shape for anything that accepts a tone.
export interface WithTone {
  tone?: Tone;
}
