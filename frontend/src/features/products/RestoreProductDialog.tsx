import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Input, Portal, Text } from "@chakra-ui/react";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";

interface RestoreProductDialogProps {
  /** The archived product whose restore was refused, or null when the dialog is closed. */
  product: Product | null;
  /** What the server said — it names the active product now holding the SKU. */
  reason: string;
  onClose: () => void;
  onRestore: (sku: string) => Promise<void>;
}

// The way out of the one conflict a restore can hit: archiving FREES the SKU, so by the time somebody
// restores, another live product may be answering to it.
//
// This dialog exists because refusing alone would be a dead end — an archived product cannot be
// edited either (ProductUpdate only touches active rows), so "rename it first" would be advice the
// user cannot act on. Restoring under a new SKU is the single step that resolves it.
export function RestoreProductDialog({ product, reason, onClose, onRestore }: RestoreProductDialogProps) {
  const { t } = useTranslation();
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);

  const open = product !== null;
  // The old SKU is what was refused, so it cannot be the default — the user has to type a new one.
  const unchanged = sku.trim() === "" || sku.trim() === product?.sku;

  async function submit() {
    setBusy(true);

    try {
      await onRestore(sku.trim());
      setSku("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) {
          setSku("");
          onClose();
        }
      }}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="restore-conflict-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("products.restoreDialog.title")}</Dialog.Title>
            </Dialog.Header>

            <Dialog.Body>
              <Text mb="field" color="fg.muted">
                {reason}
              </Text>

              <Field.Root>
                <Field.Label>{t("products.restoreDialog.newSku")}</Field.Label>
                <Input
                  value={sku}
                  placeholder={product?.sku}
                  data-testid="restore-new-sku"
                  onChange={(e) => setSku(e.target.value)}
                />
                <Field.HelperText>{t("products.restoreDialog.newSkuHelp")}</Field.HelperText>
              </Field.Root>
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("common.cancel")}</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="brand"
                loading={busy}
                disabled={unchanged}
                data-testid="restore-with-new-sku"
                onClick={submit}
              >
                {t("products.restoreDialog.confirmLabel")}
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
