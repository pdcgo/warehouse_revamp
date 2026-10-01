import type { ElementType, ReactNode } from "react";
import { CloseButton, Dialog, Icon, Portal } from "@chakra-ui/react";
import { ClippedText } from "../text/ClippedText";

export type ModalSize = "xs" | "sm" | "md" | "lg" | "xl" | "full";

// Modal is the app's generic dialog: a controlled Chakra Dialog with a titled header and an optional
// close affordance.
//
// ⚠ A MODAL IS FOR AN ACTION, NEVER FOR READING A RECORD. "See the full user / team / warehouse" is
// a PAGE with its own route (CLAUDE.md) — a detail view in a dialog cannot be linked, cannot be
// bookmarked, loses its place on a back-navigation, and traps the reader in a layer above the list
// they were working through. Create, edit and confirm belong here; "show me this record" does not.
//
// The title CLIPS rather than wraps: a dialog header that grows to two lines pushes the body down and
// makes the dialog jump in height between records with long and short names.
export const description =
  "The app's generic dialog — a controlled Chakra Dialog with a titled header. For an ACTION (create/edit/confirm); a record you READ belongs on its own route instead.";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Title Case, per the app's dialog rule — "Delete Product", not "Delete product".
  title?: string;
  // A lucide component shown before the title.
  icon?: ElementType;
  size?: ModalSize;
  // Show the ✕. Off for a dialog that must be resolved by one of its own buttons — a modal you can
  // dismiss by accident is the wrong shape for an irreversible action.
  closable?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  icon,
  size = "md",
  closable = true,
  children,
  footer,
}: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => onOpenChange(e.open)}
      size={size}
      // Dismissing by backdrop/Escape is exactly as available as the ✕ — offering one without the
      // other is a dialog whose two exits disagree about whether it may be abandoned.
      closeOnInteractOutside={closable}
      closeOnEscape={closable}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="modal">
            {title && (
              <Dialog.Header>
                <Dialog.Title display="flex" alignItems="center" gap="2" minW="0">
                  {icon && <Icon as={icon} boxSize="4" />}
                  <ClippedText fontWeight="inherit" fontSize="inherit">
                    {title}
                  </ClippedText>
                </Dialog.Title>
              </Dialog.Header>
            )}

            <Dialog.Body>{children}</Dialog.Body>

            {footer && <Dialog.Footer>{footer}</Dialog.Footer>}

            {closable && (
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" data-testid="modal-close" />
              </Dialog.CloseTrigger>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
