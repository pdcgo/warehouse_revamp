import { useState } from "react";
import type { FormEvent } from "react";
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
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Quantity must be a positive whole number.");
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

      toaster.create({ type: "success", title: `Received ${qty} × ${product.sku}` });
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
                <Dialog.Title>Receive Stock</Dialog.Title>
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
                    <Field.Label>Quantity</Field.Label>
                    <Input
                      type="number"
                      min="1"
                      value={quantity}
                      data-testid="receive-quantity"
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>Reason</Field.Label>
                    <Input
                      value={reason}
                      placeholder="e.g. PO #123, supplier delivery"
                      data-testid="receive-reason"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>

                <Button type="submit" colorPalette="brand" loading={busy} data-testid="submit-receive">
                  Receive
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
