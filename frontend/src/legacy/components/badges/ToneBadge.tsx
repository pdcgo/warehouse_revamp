import { Badge, type BadgeProps } from "@chakra-ui/react";
import { palette, type Tone } from "../tone";

// ToneBadge is the GENERIC badge every domain badge is built from: a Chakra Badge that takes one of
// the design system's seven semantic tones instead of a raw colour palette.
//
// Why it exists rather than callers just writing `<Badge colorPalette="green">`: the tone is the
// thing that carries meaning across the app ("this is a success", "this is neutral"), and routing
// every badge through `palette()` is what keeps "success" one colour instead of green in the table
// and teal in the drawer. A domain badge (RoleBadge, TeamTypeBadge) picks the tone; this decides
// how a tone looks.
//
// The default variant is `subtle` — a badge sits inside dense rows, and a solid fill at that size
// competes with the row's own content for attention.
export const description =
  "The generic badge: a Chakra Badge keyed by one of the seven semantic tones rather than a raw colour. Every domain badge builds on it.";

export interface ToneBadgeProps extends Omit<BadgeProps, "colorPalette"> {
  tone?: Tone;
}

export function ToneBadge({ tone, variant = "subtle", ...rest }: ToneBadgeProps) {
  return <Badge colorPalette={palette(tone)} variant={variant} {...rest} />;
}
