import { useState } from "react";
import type { ReactNode } from "react";
import { Dialog, Portal } from "@ark-ui/react";
import { Loader2, X } from "lucide-react";

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
//
// Built on Ark UI's Dialog (the same Zag.js machine Chakra v3 used) so the focus-trap, scroll-lock,
// Escape/backdrop dismissal, Portal and role="alertdialog" a11y come for free; Tailwind styles it.
// The public API (props + the `confirm-action` testid) is unchanged from the Chakra version.
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

  const confirmClasses = destructive
    ? "bg-red-600 hover:bg-red-700 text-white"
    : "bg-brand-600 hover:bg-brand-700 text-white";

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      role="alertdialog"
      lazyMount
      unmountOnExit
    >
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}

      <Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Content className="relative w-full max-w-md rounded-card border border-line bg-surface shadow-pop">
            <div className="px-5 pt-5 pb-2">
              <Dialog.Title className="text-[15px] font-semibold text-fg">{title}</Dialog.Title>
            </div>

            <Dialog.Description className="block px-5 pb-4 text-sm text-fg-muted">
              {message}
            </Dialog.Description>

            <div className="flex justify-end gap-2 px-5 pb-5">
              <Dialog.CloseTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Cancel
                </button>
              </Dialog.CloseTrigger>

              <button
                type="button"
                data-testid="confirm-action"
                disabled={busy}
                onClick={() => void confirm()}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 ${confirmClasses}`}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {confirmLabel}
              </button>
            </div>

            <Dialog.CloseTrigger asChild>
              <button
                type="button"
                aria-label="Close"
                className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-control text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="size-4" />
              </button>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
