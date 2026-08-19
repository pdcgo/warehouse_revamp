import type { ReactNode } from "react";
import { CloseButton, Drawer, Portal } from "@chakra-ui/react";

// How wide the panel is. These are the two that exist because they mean different things:
//   sm — a detail panel beside the list you are still working through
//   md — a panel with a form or a table of its own in it
//   full — the panel IS the task; the list behind it is only a way back
export type PopBoxSize = "sm" | "md" | "full";

// PopBox is a side panel that slides in from the right over the current screen.
//
// It is the shape for "look at / act on ONE row without leaving the list". A person working a queue
// — an inbound to approve, an order to check, a rack to re-shelve — is going to do the same thing to
// the next row and the row after that, and a full page navigation loses the list's scroll position,
// its filters and its page, then makes them re-find their place on the way back. The panel keeps the
// list on screen and keeps the reader's place in it.
//
// ⚠ THAT IS A DIFFERENT JOB FROM `Modal`, and from a detail PAGE:
//   Modal   — a focused action that must be resolved before anything else (confirm, a short form)
//   PopBox  — one row's detail beside the list, in a queue you are working through
//   a route — the full record, linkable and bookmarkable, when it is the destination and not a step
//
// It does NOT trap focus the way a modal does, because the list behind it stays legitimately usable.
export const description =
  "A right-hand slide-over for working ONE row without losing the list behind it — its scroll, filters and page. A modal blocks; this sits beside.";

export interface PopBoxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  size?: PopBoxSize;
  children?: ReactNode;
  footer?: ReactNode;
  // Dim the page behind it. On by default — without it the panel reads as part of the table rather
  // than as a layer over it. Turn it off for a panel meant to be used ALONGSIDE the list (picking a
  // row and watching the panel update).
  backdrop?: boolean;
}

export function PopBox({
  open,
  onOpenChange,
  title,
  size = "sm",
  children,
  footer,
  backdrop = true,
}: PopBoxProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      placement="end"
      size={size === "full" ? "full" : size === "md" ? "lg" : "sm"}
      // Not modal when there is no backdrop: with the list behind it still meant to be clickable, a
      // focus trap would make the panel impossible to leave except through its own close button.
      modal={backdrop}
    >
      <Portal>
        {backdrop && <Drawer.Backdrop />}
        <Drawer.Positioner>
          <Drawer.Content data-testid="popbox">
            {title && (
              <Drawer.Header>
                <Drawer.Title>{title}</Drawer.Title>
              </Drawer.Header>
            )}

            <Drawer.Body>{children}</Drawer.Body>

            {footer && <Drawer.Footer>{footer}</Drawer.Footer>}

            <Drawer.CloseTrigger asChild>
              <CloseButton size="sm" data-testid="popbox-close" />
            </Drawer.CloseTrigger>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
}
