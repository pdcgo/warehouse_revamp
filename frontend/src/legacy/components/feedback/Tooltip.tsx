import { type ReactElement, type ReactNode } from "react";
import { Portal, Tooltip as ChakraTooltip } from "@chakra-ui/react";

// Tooltip wraps Chakra's five-part Tooltip into the one-prop form the app actually uses:
// give it a child to hover and some `content`, and it does the rest.
//
// Two behaviours are baked in rather than left to each caller, because getting either wrong is
// invisible until someone hits it:
//
//  1. NO CONTENT MEANS NO TOOLTIP. Passing an empty string renders the child alone, with no
//     trigger wrapper and no listeners. Several callers here (PriceText, ClippedText) decide at
//     render time whether a tip is warranted, and the alternative — an empty bubble popping open
//     on hover — reads as a broken component.
//  2. IT PORTALS. A tooltip inside a table cell with `overflow: hidden`, or inside a Dialog, gets
//     clipped or stacked underneath without one. Portalling is the safe default; the escape hatch
//     is `portalled={false}` for the rare inline case.
export const description =
  "Hover/focus tooltip (Chakra Tooltip). Renders nothing extra when `content` is empty, and portals by default so table and dialog overflow can't clip it.";

export interface TooltipProps {
  // The tip text. Empty/undefined disables the tooltip entirely — see rule 1 above.
  content?: ReactNode;
  // The element to attach to. Must accept a ref — Chakra's Trigger clones it with `asChild`.
  children: ReactElement;
  placement?: "top" | "bottom" | "left" | "right";
  // Show an arrow pointing at the trigger. Off by default: on a dense table row the arrow is more
  // pixels than signal.
  showArrow?: boolean;
  // Escape hatch for the rare case where portalling breaks a layout that needs the tip inline.
  portalled?: boolean;
  openDelay?: number;
  closeDelay?: number;
  // Force the open state — used by tests and by the copy-confirmation flows that pop a tip open
  // programmatically after a click.
  open?: boolean;
}

export function Tooltip({
  content,
  children,
  placement = "top",
  showArrow = false,
  portalled = true,
  openDelay = 150,
  closeDelay = 100,
  open,
}: TooltipProps) {
  // Rule 1: no content, no tooltip machinery at all.
  if (content === undefined || content === null || content === "") return children;

  const positioner = (
    <ChakraTooltip.Positioner>
      <ChakraTooltip.Content data-testid="tooltip-content">
        {showArrow && (
          <ChakraTooltip.Arrow>
            <ChakraTooltip.ArrowTip />
          </ChakraTooltip.Arrow>
        )}
        {content}
      </ChakraTooltip.Content>
    </ChakraTooltip.Positioner>
  );

  return (
    <ChakraTooltip.Root
      open={open}
      openDelay={openDelay}
      closeDelay={closeDelay}
      positioning={{ placement }}
    >
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      {portalled ? <Portal>{positioner}</Portal> : positioner}
    </ChakraTooltip.Root>
  );
}
