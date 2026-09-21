import { Spinner as ChakraSpinner } from "@chakra-ui/react";
import type { SpinnerProps as ChakraSpinnerProps } from "@chakra-ui/react";
import { palette, type Tone } from "../tone";

// Spinner is the app's loading spinner: a Chakra Spinner pinned to the design system's tones and to
// two sizes.
//
// It exists to remove a decision rather than to add capability. A spinner is the single most
// re-invented element in any app — every screen picks its own size and colour, and the result is a
// dozen subtly different spinners that read as different components doing different things. Two
// sizes and one tone scale is the whole API on purpose.
//
// `sm` goes inline beside a label (a statistic still loading its number); `md` is the standalone
// case (a panel with nothing in it yet).
export const description =
  "The app's spinner — a Chakra Spinner fixed to the design tones and two sizes, inline (`sm`) or standalone (`md`).";

export interface SpinnerProps extends Omit<ChakraSpinnerProps, "colorPalette" | "size"> {
  tone?: Tone;
  size?: "sm" | "md";
}

export function Spinner({ tone = "active", size = "md", ...rest }: SpinnerProps) {
  return (
    <ChakraSpinner
      colorPalette={palette(tone, "active")}
      // Explicit box sizes rather than Chakra's size scale: the two sizes here mean "inline with
      // text" and "alone in a panel", which is a layout question the theme's control scale does not
      // answer.
      boxSize={size === "sm" ? "4" : "8"}
      borderWidth={size === "sm" ? "2px" : "3px"}
      data-testid="spinner"
      {...rest}
    />
  );
}
