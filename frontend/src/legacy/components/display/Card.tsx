import { Card as ChakraCard } from "@chakra-ui/react";
import type { CardRootProps } from "@chakra-ui/react";

// Card is the app's surface: a bordered, rounded container for one coherent thing.
//
// It adds three states to Chakra's Card that keep re-appearing across the screens here, so that they
// look the same everywhere instead of being re-derived per page:
//
//   hoverable — the card is a click target (a row rendered as a card on mobile). Without a hover
//               response a clickable card is indistinguishable from a static one until you try it.
//   active    — the card is the currently SELECTED one in a set. Distinct from hover: hover is where
//               the pointer is, active is what the app is showing you elsewhere on screen.
//   table     — the card wraps a table, so it drops its own padding. A table brings its own cell
//               padding, and nesting the two puts a visible double gutter around every table.
export const description =
  "The standard bordered surface, with the three states screens keep needing: hoverable (it is a click target), active (it is the selected one), and table (it wraps a table, so no padding of its own).";

export interface CardProps extends CardRootProps {
  hoverable?: boolean;
  active?: boolean;
  table?: boolean;
}

export function Card({ hoverable, active, table, children, ...rest }: CardProps) {
  return (
    <ChakraCard.Root
      size="sm"
      // Selection is expressed as a real ARIA state, not only as colour — a selected card must be
      // announced as selected, not merely tinted.
      aria-selected={active || undefined}
      borderColor={active ? "colorPalette.solid" : undefined}
      bg={active ? "colorPalette.subtle" : undefined}
      colorPalette={active ? "brand" : undefined}
      cursor={hoverable ? "pointer" : undefined}
      transition="background-color 150ms, border-color 150ms"
      _hover={hoverable ? { bg: "bg.muted", borderColor: "border.emphasized" } : undefined}
      data-testid="card"
      data-active={active ? "true" : undefined}
      {...rest}
    >
      {/* A table brings its own padding; a card adding more produces a double gutter. */}
      <ChakraCard.Body p={table ? "0" : undefined}>{children}</ChakraCard.Body>
    </ChakraCard.Root>
  );
}
