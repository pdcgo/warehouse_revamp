import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { inventoryClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { toaster } from "../components/Toaster";

// ReceiveStockDialog records incoming goods (a +quantity movement) for one product at a warehouse.
export function ReceiveStockDialog({
  warehouseId,
  product,
  open,
  onOpenChange,
  onDone,
}: {
  warehouseId: bigint;
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError(t("inventory.quantityPositiveError"));
      return;
    }

    setBusy(true);
    setError("");

    try {
      await inventoryClient.stockReceive({
        warehouseId,
        productId: product.id,
        quantity: BigInt(qty),
        reason,
        ref: "",
      });

      toaster.create({
        type: "success",
        title: t("inventory.receivedToast", { qty, sku: product.sku }),
      });
      onOpenChange(false);
      onDone();
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
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
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="receive-error">
                      {error}
                    </Text>
                  )}

                  <Text fontSize="sm" color="fg.muted">
                    {product.name} ({product.sku})
                  </Text>

                  <Field.Root required>
                    <Field.Label>{t("inventory.quantity")}</Field.Label>
                    <Input
                      type="number"
                      min="1"
                      value={quantity}
                      data-testid="receive-quantity"
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("inventory.reason")}</Field.Label>
                    <Input
                      value={reason}
                      placeholder={t("inventory.receiveReasonPlaceholder")}
                      data-testid="receive-reason"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("inventory.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-receive">
                  {t("inventory.receive")}
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
