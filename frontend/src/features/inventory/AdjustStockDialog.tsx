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
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { rpcError } from "../../api/clients";
import type { StockAdjustRequest } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { StockAdjustReason } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/Toaster";
import { RackSelect, UNPLACED } from "../../components/RackSelect";
import { useAdjustStock, useProductBatches, useProductPlaces } from "../../features/inventory/queries";

// The reason drives the model (#211): a RECOUNT reconciles the whole shelf to a counted figure, while
// DAMAGED/LOST/FOUND change a specific batch's units.
type Reason = "recount" | "damaged" | "lost" | "found";

const REASON_ENUM: Record<Reason, StockAdjustReason> = {
  recount: StockAdjustReason.RECOUNT,
  damaged: StockAdjustReason.DAMAGED,
  lost: StockAdjustReason.LOST,
  found: StockAdjustReason.FOUND,
};

function placeToOneof(place: string): StockAdjustRequest["place"] {
  if (place === UNPLACED) {
    return { case: "unplaced", value: true };
  }

  return { case: "rackId", value: BigInt(place) };
}

// AdjustStockDialog corrects a shelf's stock (#139/#211). The REASON drives what it collects and does:
// a Recount is a whole-shelf count (absolute), while Damaged / Lost / Found touch a specific batch's
// units by a quantity. The place is always required — a correction applied to the wrong shelf is worse
// than none, because it is believed.
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
  const [reasonType, setReasonType] = useState<Reason>("recount");
  const [place, setPlace] = useState("");
  const [batch, setBatch] = useState("");
  // One figure, read per reason: the counted on-hand for a recount, the magnitude for the others.
  const [amount, setAmount] = useState(currentOnHand.toString());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const adjust = useAdjustStock();
  const busy = adjust.isPending;

  const isBatch = reasonType !== "recount";

  const batches = useProductBatches({ warehouseId, productId: product.id });
  const batchList = batches.data ?? [];

  // The shelves this product sits on, for the delta preview's current figure.
  const placesQuery = useProductPlaces({ warehouseId, productIds: [product.id] });
  const places = placesQuery.data ?? [];

  function shelfOnHand(p: string): bigint {
    if (p === "") return 0n;
    const rackId = p === UNPLACED ? 0n : BigInt(p);
    return places.find((x) => x.rackId === rackId)?.onHand ?? 0n;
  }

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && (isBatch ? amountNum >= 1 : amountNum >= 0);
  const canSubmit = place !== "" && amountValid && (!isBatch || batch !== "");

  // What the shelf reads before → after, for the preview.
  const current = shelfOnHand(place);
  const signedDelta = isBatch
    ? (reasonType === "found" ? BigInt(amountValid ? amountNum : 0) : -BigInt(amountValid ? amountNum : 0))
    : BigInt(amountValid ? amountNum : 0) - current;
  const next = isBatch ? current + signedDelta : BigInt(amountValid ? amountNum : 0);

  const amountLabel =
    reasonType === "recount"
      ? t("inventory.adjustQtyRecount")
      : t(`inventory.adjustQty_${reasonType}`);

  function submit(event: FormEvent) {
    event.preventDefault();

    if (place === "") {
      setError(t("inventory.placeRequiredError"));
      return;
    }
    if (isBatch && batch === "") {
      setError(t("inventory.adjustBatchRequiredError"));
      return;
    }
    if (!amountValid) {
      setError(t("inventory.countedOnHandError"));
      return;
    }

    setError("");

    adjust.mutate(
      {
        warehouseId,
        productId: product.id,
        place: placeToOneof(place),
        reason: note,
        reasonType: REASON_ENUM[reasonType],
        // A recount carries the counted on-hand; the batch reasons carry the batch + magnitude.
        onHand: isBatch ? 0n : BigInt(amountNum),
        batchId: isBatch ? BigInt(batch) : 0n,
        quantity: isBatch ? BigInt(amountNum) : 0n,
      },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.adjustedToast", { sku: product.sku, counted: amountNum }),
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

                  <Field.Root required>
                    <Field.Label>{t("inventory.placeCounted")}</Field.Label>
                    <RackSelect warehouseId={warehouseId} value={place} onChange={setPlace} />
                    <Field.HelperText>{t("inventory.placeCountedHelper")}</Field.HelperText>
                  </Field.Root>

                  {/* The reason first — it decides whether a batch and which quantity the rest asks for. */}
                  <Field.Root required>
                    <Field.Label>{t("inventory.adjustReasonType")}</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={reasonType}
                        data-testid="adjust-reason-type"
                        onChange={(e) => setReasonType(e.target.value as Reason)}
                      >
                        <option value="recount">{t("inventory.adjustReasonRecount")}</option>
                        <option value="damaged">{t("inventory.adjustReasonDamaged")}</option>
                        <option value="lost">{t("inventory.adjustReasonLost")}</option>
                        <option value="found">{t("inventory.adjustReasonFound")}</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>

                  {/* Which delivery's units — only for the batch reasons; a recount is batch-agnostic. */}
                  {isBatch && (
                    <Field.Root required>
                      <Field.Label>{t("inventory.adjustBatch")}</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={batch}
                          data-testid="adjust-batch"
                          onChange={(e) => setBatch(e.target.value)}
                        >
                          <option value="" disabled>
                            {t("inventory.adjustBatchPlaceholder")}
                          </option>
                          {batchList.map((b) => (
                            <option key={b.id.toString()} value={b.id.toString()}>
                              {t("inventory.moveBatchOption", {
                                id: b.deliveryId.toString(),
                                ready: b.ready.toString(),
                              })}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>
                  )}

                  <Field.Root required>
                    <Field.Label>{amountLabel}</Field.Label>
                    <Input
                      type="number"
                      min={isBatch ? "1" : "0"}
                      value={amount}
                      data-testid="adjust-amount"
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <Field.HelperText>{t("inventory.adjustHelper")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("inventory.adjustNote")}</Field.Label>
                    <Input
                      value={note}
                      placeholder={t("inventory.adjustReasonPlaceholder")}
                      data-testid="adjust-reason"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {/* The delta preview — what the shelf reads before → after, so a correction is never a
                      blind commit (#211). */}
                  {canSubmit && (
                    <Box
                      borderWidth="1px"
                      borderColor="border"
                      borderRadius="md"
                      bg="bg.muted"
                      p="card"
                      data-testid="adjust-delta"
                    >
                      <Text fontSize="sm" fontVariantNumeric="tabular-nums">
                        <b>{current.toString()}</b> → <b>{next.toString()}</b>{" "}
                        <Text as="span" color={signedDelta < 0n ? "red.fg" : "green.fg"}>
                          ({signedDelta > 0n ? "+" : ""}
                          {signedDelta.toString()})
                        </Text>
                      </Text>
                    </Box>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">{t("inventory.cancel")}</Button>
                </Dialog.ActionTrigger>

                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!canSubmit}
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
