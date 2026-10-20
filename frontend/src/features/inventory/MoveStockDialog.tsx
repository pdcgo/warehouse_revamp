import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
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
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/feedback/Toaster";
import { RackSelect } from "../../components/pickers/RackSelect";
import { useRackMove } from "../racks/queries";
import { useProductPlaces } from "./queries";
import { QuantityInput } from "../../components/inputs/QuantityInput";

// MoveStockDialog moves one product from one rack to another INSIDE one warehouse (#136), through RackMove on the
// decided ledgers (a-move-is-one-rack-to-one-or-more-racks). The warehouse total never changes — only where the goods
// sit. Every unit is on a rack (there-is-no-unplaced-pile), and a rack counts units per product, never per batch, so a
// move names no batch. It is also how you empty a rack you want to delete (#138).
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

  // The shelves this product sits on, with each shelf's TOTAL on-hand — so the dialog can show what a
  // move does to both ends before it commits (#210).
  const placesQuery = useProductPlaces({ warehouseId, productIds: [product.id] });
  const places = placesQuery.data ?? [];

  // A RackSelect value → that rack's current on-hand. "" is unanswered.
  function shelfOnHand(place: string): bigint {
    if (place === "") return 0n;
    const rackId = BigInt(place);
    const found = places.find((p) => p.rackId === rackId);
    return found?.onHand ?? 0n;
  }

  // How a rack reads in the balance line — its code if the product already sits there, else the raw id for a rack it
  // is arriving on for the first time.
  function shelfLabel(place: string): string {
    const found = places.find((p) => p.rackId === BigInt(place));
    return found?.rackCode ?? `#${place}`;
  }

  // A move is the clearest case for the cross-domain fan-out (#177): nothing about the WAREHOUSE
  // total changes, only which shelf holds it — so the rack views are the screens that go stale.
  const move = useRackMove();
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
        teamId: warehouseId,
        fromRackId: BigInt(from),
        lines: [{ productId: product.id, quantity: BigInt(qty), toRackId: BigInt(to) }],
        description: reason,
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
                    <Text color="error.fg" data-testid="move-error">
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
                    <RackSelect warehouseId={warehouseId} value={from} onChange={setFrom} allowUnplaced={false} />
                    <Field.HelperText>{t("inventory.moveFromHelper")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root required invalid={samePlace}>
                    <Field.Label>{t("inventory.moveTo")}</Field.Label>
                    <RackSelect warehouseId={warehouseId} value={to} onChange={setTo} allowUnplaced={false} />
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
                    <QuantityInput
                      min={1}
                      width="full"
                      size="sm"
                      value={quantity}
                      testId="move-quantity"
                      onChange={setQuantity}
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

                  {/* What the move does to both ends, before it commits (#210). */}
                  {canSubmit && (
                    <Box
                      borderWidth="1px"
                      borderColor="border"
                      borderRadius="md"
                      bg="bg.muted"
                      p="card"
                      data-testid="move-balances"
                    >
                      <Text fontSize="sm" fontVariantNumeric="tabular-nums">
                        {shelfLabel(from)}: <b>{shelfOnHand(from).toString()}</b> →{" "}
                        {(shelfOnHand(from) - BigInt(qty)).toString()}
                        {"   ·   "}
                        {shelfLabel(to)}: <b>{shelfOnHand(to).toString()}</b> →{" "}
                        {(shelfOnHand(to) + BigInt(qty)).toString()}
                      </Text>
                    </Box>
                  )}
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
