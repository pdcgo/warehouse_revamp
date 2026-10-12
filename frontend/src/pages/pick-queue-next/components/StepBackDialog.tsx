import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, CloseButton, Dialog, Field, Portal, Textarea } from "@chakra-ui/react";

// SENDING AN ORDER BACK TO THE QUEUE (owner: *"warning cukup, tetapi pakai alasan terdengar masuk akal"*).
//
// A warning — the progress on the order is undone — and a short reason, so the timeline says WHY the job
// came back ("not on the shelf", "damaged") rather than only that it did. The reason is required: an
// empty one is the same as no reason, and the next person to pick the order needs it.
export function StepBackDialog({
  open,
  count,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** How many orders are going back — one from a row, several from the bulk bar. */
  count: number;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  function close() {
    setReason("");
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && close()} role="alertdialog">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="step-back-dialog">
            <Dialog.Header>
              <Dialog.Title>
                {t("warehouseOrders.back.title")}
                {count > 1 ? ` (${count})` : ""}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Alert.Root status="warning" mb="field">
                <Alert.Indicator />
                <Alert.Description>{t("warehouseOrders.back.warning")}</Alert.Description>
              </Alert.Root>

              <Field.Root required>
                <Field.Label>
                  {t("warehouseOrders.back.reason")}
                  <Field.RequiredIndicator />
                </Field.Label>
                <Textarea
                  rows={2}
                  value={reason}
                  placeholder={t("warehouseOrders.back.reasonPlaceholder")}
                  data-testid="step-back-reason"
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field.Root>
            </Dialog.Body>

            <Dialog.Footer>
              <Button variant="ghost" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                colorPalette="warning"
                disabled={reason.trim() === ""}
                data-testid="step-back-confirm"
                onClick={() => {
                  onConfirm(reason.trim());
                  setReason("");
                }}
              >
                {t("warehouseOrders.back.confirm")}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
