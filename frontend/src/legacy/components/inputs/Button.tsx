import type { ElementType } from "react";
import { Button as ChakraButton, Icon } from "@chakra-ui/react";
import type { ButtonProps as ChakraButtonProps } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";
import { palette, type Tone } from "../tone";

// Button is the app's button: a Chakra Button that speaks in TONES, takes a lucide icon directly,
// and can navigate.
//
// The navigation case is the reason it is worth a component. A button that goes somewhere has to be
// a real `<a>` — middle-click, ctrl-click, "copy link address" and the browser's own status bar all
// depend on it — but styling an anchor as a button by hand loses the disabled handling, the loading
// state and the focus ring. Chakra's answer is `asChild` plus a router Link, which is three lines of
// boilerplate repeated at every call site until somebody shortens it to an onClick that calls
// navigate() and quietly breaks middle-click everywhere.
//
// ⚠ A LINK BUTTON IGNORES `loading`. A navigation is not an async operation this button owns, and a
// spinner on an anchor promises a completion it will never report.
export const description =
  "The app's button — tones instead of raw palettes, a lucide icon prop, and an `href` that produces a REAL link so middle-click and copy-link-address keep working.";

export interface ButtonProps extends Omit<ChakraButtonProps, "colorPalette"> {
  tone?: Tone;
  // A lucide component, placed before the label.
  icon?: ElementType;
  // Navigate instead of acting: renders a router link styled as this button.
  href?: string;
  target?: string;
}

export function Button({
  tone = "active",
  icon,
  href,
  target,
  children,
  loading,
  ...rest
}: ButtonProps) {
  const content = (
    <>
      {icon && <Icon as={icon} boxSize="4" />}
      {children}
    </>
  );

  if (href) {
    return (
      <ChakraButton asChild colorPalette={palette(tone, "active")} {...rest}>
        <RouterLink to={href} target={target}>
          {content}
        </RouterLink>
      </ChakraButton>
    );
  }

  return (
    <ChakraButton colorPalette={palette(tone, "active")} loading={loading} {...rest}>
      {content}
    </ChakraButton>
  );
}
