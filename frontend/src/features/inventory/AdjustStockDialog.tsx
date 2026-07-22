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
import { rpcError } from "../../api/clients";
import type { StockAdjustRequest } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/Toaster";
import { RackSelect, UNPLACED } from "../../components/RackSelect";
import { useAdjustStock } from "../../features/inventory/queries";

// placeToOneof turns RackSelect's plain string into the request's `place` oneof. It is total over the
// picker's two legal answers only — `""` (unanswered) has no encoding, which is the point: the
// contract has no way to say "somewhere", so submit is blocked before it gets here.
function placeToOneof(place: string): StockAdjustRequest["place"] {
  if (place === UNPLACED) {
    return { case: "unplaced", value: true };
  }

  return { case: "rackId", value: BigInt(place) };
}

// AdjustStockDialog corrects the on-hand of one product at ONE PLACE in a warehouse to a counted
// figure (absolute).
//
// A stock-take is physically a count of a shelf: someone stands at A-01-3 and counts what is on it.
// So the place is required (#139) — the server refuses a count that does not say where, and this
// dialog refuses to send one, because a correction applied to the wrong shelf is worse than no
// correction at all: it is believed.
export function AdjustStockDialog({
  warehouseId,
  product,
  currentOnHand,
  open,
  onOpenChange,
}: {
  warehouseId: bigint;
  product: Product;
  currentOnHand: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [onHand, setOnHand] = useState(currentOnHand.toString());
  const [place, setPlace] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  // A correction changes what a SHELF holds, so the rack views go stale with the stock ones — the
  // hook fans that out (#177).
  const adjust = useAdjustStock();
  const busy = adjust.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();

    // Checked before the figure: without a place there is nothing a count could correct, so this is
    // the more fundamental of the two answers.
    if (place === "") {
      setError(t("inventory.placeRequiredError"));
      return;
    }

    const counted = Number(onHand);
    if (!Number.isInteger(counted) || counted < 0) {
      setError(t("inventory.countedOnHandError"));
      return;
    }

    setError("");

    adjust.mutate(
      {
        warehouseId,
        productId: product.id,
        onHand: BigInt(counted),
        reason,
        place: placeToOneof(place),
      },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.adjustedToast", { sku: product.sku, counted }),
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

                  {/* Where, then how many — the order someone actually works in: you stand at the
                      shelf before you count it. It also puts the field that scopes the whole
                      correction above the figure it scopes. */}
                  <Field.Root required>
                    <Field.Label>{t("inventory.placeCounted")}</Field.Label>
                    <RackSelect warehouseId={warehouseId} value={place} onChange={setPlace} />
                    <Field.HelperText>{t("inventory.placeCountedHelper")}</Field.HelperText>
                  </Field.Root>

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

                {/* Belt and braces with the check in submit(): the button is disabled so the dialog
                    never LOOKS submittable without a place, and submit() still guards it so a form
                    submitted by Enter cannot slip past. */}
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={place === ""}
                  data-testid="submit-adjust"
                >
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
