import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog, Portal } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { rpcError } from "../../api/clients";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/Toaster";
import { useReceiveStock } from "../../features/inventory/queries";

// ReceiveStockDialog records incoming goods (a +quantity movement) for one product at a warehouse.
export function ReceiveStockDialog({
  warehouseId,
  product,
  open,
  onOpenChange,
}: {
  warehouseId: bigint;
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  // Receiving stock also makes the restock and rack views stale — the hook fans that out (#177), so
  // this dialog no longer takes an `onDone` for the parent to refetch with.
  const receive = useReceiveStock();
  const busy = receive.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError(t("inventory.quantityPositiveError"));
      return;
    }

    setError("");

    receive.mutate(
      {
        warehouseId,
        productId: product.id,
        quantity: BigInt(qty),
        reason,
        ref: "",
      },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.receivedToast", { qty, sku: product.sku }),
          });
          onOpenChange(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("inventory.receiveStockTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="flex flex-col gap-card">
                  {error && (
                    <p className="text-red-600 dark:text-red-400" data-testid="receive-error">
                      {error}
                    </p>
                  )}

                  <p className="text-sm text-fg-muted">
                    {product.name} ({product.sku})
                  </p>

                  <Field.Root required>
                    <Field.Label>{t("inventory.quantity")}</Field.Label>
                    <Field.Input
                      type="number"
                      min="1"
                      value={quantity}
                      data-testid="receive-quantity"
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("inventory.reason")}</Field.Label>
                    <Field.Input
                      value={reason}
                      placeholder={t("inventory.receiveReasonPlaceholder")}
                      data-testid="receive-reason"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field.Root>
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.CloseTrigger asChild>
                  <Button type="button" variant="outline">
                    {t("inventory.cancel")}
                  </Button>
                </Dialog.CloseTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-receive">
                  {t("inventory.receive")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <IconButton
                  type="button"
                  size="sm"
                  aria-label={t("inventory.cancel")}
                  className="absolute right-3 top-3"
                >
                  <X className="size-4" />
                </IconButton>
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
