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

// AdjustStockDialog corrects on-hand to a counted figure (absolute) for one product at a warehouse.
export function AdjustStockDialog({
  warehouseId,
  product,
  currentOnHand,
  open,
  onOpenChange,
  onDone,
}: {
  warehouseId: bigint;
  product: Product;
  currentOnHand: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [onHand, setOnHand] = useState(currentOnHand.toString());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    const counted = Number(onHand);
    if (!Number.isInteger(counted) || counted < 0) {
      setError(t("inventory.countedOnHandError"));
      return;
    }

    setBusy(true);
    setError("");

    try {
      await inventoryClient.stockAdjust({
        warehouseId,
        productId: product.id,
        onHand: BigInt(counted),
        reason,
      });

      toaster.create({
        type: "success",
        title: t("inventory.adjustedToast", { sku: product.sku, counted }),
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
                <Dialog.Title>{t("inventory.adjustStockTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="adjust-error">
                      {error}
                    </Text>
                  )}

                  <Text fontSize="sm" color="fg.muted">
                    {t("inventory.adjustProductSummary", {
                      name: product.name,
                      sku: product.sku,
                      onHand: currentOnHand.toString(),
                    })}
                  </Text>

                  <Field.Root required>
                    <Field.Label>{t("inventory.countedOnHand")}</Field.Label>
                    <Input
                      type="number"
                      min="0"
                      value={onHand}
                      data-testid="adjust-onhand"
                      onChange={(e) => setOnHand(e.target.value)}
                    />
                    <Field.HelperText>{t("inventory.adjustHelper")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("inventory.reason")}</Field.Label>
                    <Input
                      value={reason}
                      placeholder={t("inventory.adjustReasonPlaceholder")}
                      data-testid="adjust-reason"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("inventory.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-adjust">
                  {t("inventory.adjust")}
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
