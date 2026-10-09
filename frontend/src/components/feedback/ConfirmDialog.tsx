import { useState } from "react";
import type { ReactNode } from "react";
import { Button, CloseButton, Dialog, Portal, Stack, Text } from "@chakra-ui/react";

interface ConfirmDialogProps {
  // Optional: when this dialog is opened from a menu item, the page controls `open` and there is
  // no inline trigger. Left absent, the dialog triggers itself (products/categories still do).
  trigger?: ReactNode;
  title: string;
  message?: string;
  /**
   * A QUESTION THE CONFIRMATION HAS TO ASK, rendered under the message — "did the money come back?",
   * an optional reason. It lives inside the one dialog rather than in a second one after it, because
   * the answer is part of the act being confirmed: a cancel without it is not the same cancel.
   */
  children?: ReactNode;
  confirmLabel?: string;
  /** The dismiss button. "Cancel" by default — rename it where the act itself is a cancel. */
  dismissLabel?: string;
  /** Hold the confirm button until the body's question is answered. */
  confirmDisabled?: boolean;
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
  children,
  confirmLabel = "Confirm",
  dismissLabel = "Cancel",
  confirmDisabled = false,
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
              <Stack gap="field">
                {message && <Text>{message}</Text>}
                {children}
              </Stack>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{dismissLabel}</Button>
              </Dialog.ActionTrigger>

              <Button
                colorPalette={destructive ? "error" : "brand"}
                loading={busy}
                disabled={confirmDisabled}
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
