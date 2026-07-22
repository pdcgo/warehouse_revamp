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
import type { StockMoveRequest } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/Toaster";
import { RackSelect, UNPLACED } from "../../components/RackSelect";
import { useMoveStock } from "../../features/inventory/queries";

// placeToOneof turns RackSelect's plain string into the request's `place` oneof — the same encoding
// AdjustStockDialog does, for the same reason: `""` (unanswered) has no representation in the
// contract, so submit is blocked before it can get here.
//
// Sending nothing would be worse than sending the wrong thing: the server reads an absent place as
// the unplaced pile, so an unanswered end would silently become a real — and probably wrong — answer.
function placeToOneof(place: string): NonNullable<StockMoveRequest["from"]>["place"] {
  if (place === UNPLACED) {
    return { case: "unplaced", value: true };
  }

  return { case: "rackId", value: BigInt(place) };
}

// MoveStockDialog moves stock between two places INSIDE one warehouse (#136). The warehouse total
// never changes — only where the goods sit — which is what makes this a different act from receiving.
//
// One dialog for both jobs the issue names, because they are one act with different arguments:
// unplaced → rack is putting away what arrived (today that is everything predating #137), and
// rack → rack is re-organising a shelf. It is also how you empty a rack you want to delete (#138).
//
// The three rules the server enforces are mirrored here — both ends answered, the two ends DIFFERENT,
// and a quantity of at least one — so the everyday mistakes never cost a round trip. The one it
// cannot mirror is moving more than the source holds: only the server knows what a place holds, so
// that comes back as an RPC error and is rendered in the dialog.
export function MoveStockDialog({
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
  // Both ends start unanswered. A default would be a guess about where the goods are, and a move
  // applied to the wrong shelf is worse than no move: the ledger would believe it.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Held as a string while editing — an empty input is not zero, and coercing it to one would make
  // a blank field look like a legitimate answer.
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  // A move is the clearest case for the cross-domain fan-out (#177): nothing about the WAREHOUSE
  // total changes, only which shelf holds it — so the rack views are the screens that go stale.
  const move = useMoveStock();
  const busy = move.isPending;

  const samePlace = from !== "" && from === to;
  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty >= 1;
  const canSubmit = from !== "" && to !== "" && !samePlace && qtyValid;

  function submit(event: FormEvent) {
    event.preventDefault();

    if (from === "" || to === "") {
      setError(t("inventory.movePlacesRequiredError"));
      return;
    }

    if (samePlace) {
      setError(t("inventory.moveSamePlaceError"));
      return;
    }

    if (!qtyValid) {
      setError(t("inventory.quantityPositiveError"));
      return;
    }

    setError("");

    move.mutate(
      {
        warehouseId,
        productId: product.id,
        from: { place: placeToOneof(from) },
        to: { place: placeToOneof(to) },
        quantity: BigInt(qty),
        reason,
      },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.movedToast", { qty, sku: product.sku }),
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
                <Dialog.Title>{t("inventory.moveStockTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="red.fg" data-testid="move-error">
                      {error}
                    </Text>
                  )}

                  <Text fontSize="sm" color="fg.muted">
                    {t("inventory.moveProductSummary", {
                      name: product.name,
                      sku: product.sku,
                      onHand: currentOnHand.toString(),
                    })}
                  </Text>

                  {/* From, then To, then how many — the order the act happens in. The two ends come
                      before the figure because they are what the figure is bounded by. */}
                  <Field.Root required invalid={samePlace}>
                    <Field.Label>{t("inventory.moveFrom")}</Field.Label>
                    <RackSelect warehouseId={warehouseId} value={from} onChange={setFrom} />
                    <Field.HelperText>{t("inventory.moveFromHelper")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required invalid={samePlace}>
                    <Field.Label>{t("inventory.moveTo")}</Field.Label>
                    <RackSelect warehouseId={warehouseId} value={to} onChange={setTo} />
                    {/* Says WHY Confirm is dead rather than leaving a disabled button unexplained —
                        the same courtesy AdjustStockDialog pays for a missing place. */}
                    {samePlace ? (
                      <Field.ErrorText data-testid="move-same-place">
                        {t("inventory.moveSamePlaceError")}
                      </Field.ErrorText>
                    ) : (
                      <Field.HelperText>{t("inventory.moveToHelper")}</Field.HelperText>
                    )}
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("inventory.quantity")}</Field.Label>
                    <Input
                      type="number"
                      min="1"
                      value={quantity}
                      data-testid="move-quantity"
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                    <Field.HelperText>{t("inventory.moveQuantityHelper")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("inventory.reason")}</Field.Label>
                    <Input
                      value={reason}
                      placeholder={t("inventory.moveReasonPlaceholder")}
                      data-testid="move-reason"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field.Root>
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("inventory.cancel")}</Button>
                </Dialog.ActionTrigger>

                {/* Belt and braces with the checks in submit(): disabled so the dialog never LOOKS
                    submittable while it is invalid, and submit() still guards so a form sent by
                    Enter cannot slip past. */}
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canSubmit}
                  data-testid="submit-move"
                >
                  {t("inventory.move")}
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
