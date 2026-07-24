import { useState } from "react";
import type { ReactNode } from "react";
import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react";

interface ConfirmDialogProps {
  // Optional: when this dialog is opened from a menu item, the page controls `open` and there is
  // no inline trigger. Left absent, the dialog triggers itself (products/categories still do).
  trigger?: ReactNode;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Every destructive action goes through this. It is not decoration: delete and suspend are the
// two things in this app that cannot be undone with a click, and both are one menu-item away.
export function ConfirmDialog({
  trigger,
  title,
  message,
  confirmLabel = "Confirm",
  destructive = true,
  onConfirm,
  open: openProp,
  onOpenChange,
}: ConfirmDialogProps) {
  // Controlled when `open` is supplied; otherwise the dialog owns its own open state.
  const isControlled = openProp !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? openProp : uncontrolledOpen;
  const [busy, setBusy] = useState(false);

  function setOpen(next: boolean) {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setUncontrolledOpen(next);
    }
  }

  async function confirm() {
    setBusy(true);

    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} role="alertdialog">
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Text>{message}</Text>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette={destructive ? "red" : "brand"}
                loading={busy}
                onClick={() => void confirm()}
                data-testid="confirm-action"
              >
                {confirmLabel}
              </Button>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
