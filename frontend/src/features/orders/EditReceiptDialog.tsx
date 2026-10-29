import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Input, Portal, Spinner, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { ReceiptUpload, emptyReceipt } from "../../components/orders/ReceiptUpload";
import type { ReceiptValue } from "../../components/orders/ReceiptUpload";
import { toaster } from "../../components/feedback/Toaster";
import { useOrder, useUpdateOrderReceipt } from "./queries";

export const description =
  "Edit Resi: the selling team replaces an order's tracking number, its label file, or both, while the parcel is still in the warehouse. Only what changed is sent, and each change becomes a note on the order.";

// EDIT RESI (the-seller-edits-the-resi-until-handover) — opened from the list's kebab and the detail page's buttons
// alike, through `useOrderActions`.
//
// ⚠ THE TWO ARE EDITED ON THEIR OWN (owner: *"we can edit receipt text or receipt file only"*). Only what differs from
// the order is sent, so replacing the label never rewrites the number, and the server's note names only what moved.
//
// It reads the order itself, fresh each time it opens, rather than taking the values from the row: the list's row
// may be a refetch behind, and an edit built on a stale number would note the wrong "old".
//
// ⚠ MOUNT IT ONLY WHILE OPEN — `useOrderActions` does. Mounted, it reads the order's detail, and a list mounting
// one per row would read every row's.
export function EditReceiptDialog({
  open,
  onOpenChange,
  teamId,
  orderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selling team — the order's own. */
  teamId: bigint;
  orderId: bigint;
}) {
  const { t } = useTranslation();
  const order = useOrder({ teamId, orderId });
  const update = useUpdateOrderReceipt();

  const [code, setCode] = useState("");
  const [receipt, setReceipt] = useState<ReceiptValue>(emptyReceipt);
  const [error, setError] = useState<string | null>(null);

  const current = order.data;
  const currentCode = current?.receiptCode ?? "";
  const currentDocumentId = current?.receipt?.documentId ?? "";

  // Reset from the order every time it opens, so a cancelled edit never leaks into the next one.
  useEffect(() => {
    if (!open || !current) return;

    setError(null);
    setCode(current.receiptCode);
    setReceipt({
      documentId: current.receipt?.documentId ?? "",
      filename: current.receipt?.filename ?? "",
      mimeType: current.receipt?.mimeType ?? "",
    });
  }, [open, current]);

  const codeChanged = code.trim() !== currentCode;
  const fileChanged = receipt.documentId !== currentDocumentId;
  const busy = update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      await update.mutateAsync({
        teamId,
        orderId,
        receiptCode: codeChanged ? code.trim() : undefined,
        receipt: fileChanged ? receipt : undefined,
      });
      toaster.create({ type: "success", title: t("orders.editReceipt.saved") });
      onOpenChange(false);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="edit-receipt-dialog">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("orders.rowAction.editReceipt")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                {!current ? (
                  <Spinner size="sm" />
                ) : (
                  <Stack gap="field">
                    <Text fontSize="sm" color="fg.muted">
                      {t("orders.editReceipt.intro")}
                    </Text>

                    <Field.Root>
                      <Field.Label>{t("orders.receiptCode")}</Field.Label>
                      <Input
                        value={code}
                        placeholder={t("orders.receiptCodePlaceholder")}
                        maxLength={64}
                        data-testid="edit-receipt-code"
                        onChange={(e) => setCode(e.target.value)}
                      />
                    </Field.Root>

                    <Field.Root>
                      <Field.Label>{t("orders.editReceipt.file")}</Field.Label>
                      <ReceiptUpload teamId={teamId} value={receipt} onChange={setReceipt} disabled={busy} />
                    </Field.Root>

                    {error && (
                      <Text color="fg.error" fontSize="sm" data-testid="edit-receipt-error">
                        {error}
                      </Text>
                    )}
                  </Stack>
                )}
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!current || (!codeChanged && !fileChanged)}
                  data-testid="edit-receipt-save"
                >
                  {t("orders.editReceipt.save")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
