import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  CloseButton,
  Dialog,
  Field,
  Icon,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Hourglass, Send } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { StockAdjustRequest } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { StockAdjustReason } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/feedback/Toaster";
import { RackSelect } from "../../components/pickers/RackSelect";
import { CharCount } from "../../components/inputs/CharCount";
import { useAdjustStock, useProductBatches, useProductPlaces } from "./queries";
import { useReportFound } from "./foundRequests";
import { QuantityInput } from "../../components/inputs/QuantityInput";

export const description =
  "Corrects one product on one rack. The reason drives what it asks: a Recount takes the counted figure for the rack, Damaged and Lost take a batch and a quantity. Found names no batch (an-adjust-found-waits-for-the-owner-or-admin): it reports the units through FoundRequestCreate to the warehouse Owner or Admin and says plainly that nothing changes until one of them — never the reporter — approves.";

// The reason drives the model (#211): a RECOUNT reconciles the whole shelf to a counted figure, DAMAGED/LOST take a
// specific batch's units, and a FOUND is a request that waits for approval.
type Reason = "recount" | "damaged" | "lost" | "found";

// StockAdjust's reasons; a found never goes through StockAdjust (the server refuses it there).
const REASON_ENUM: Record<Exclude<Reason, "found">, StockAdjustReason> = {
  recount: StockAdjustReason.RECOUNT,
  damaged: StockAdjustReason.DAMAGED,
  lost: StockAdjustReason.LOST,
};

// StockAdjustRequest.reason's max_len — the box stops where the server would refuse (a-limited-field-shows-its-count).
const NOTE_MAX = 200;

// Every unit is on a rack (there-is-no-unplaced-pile), so the place is always a rack.
function placeToOneof(place: string): StockAdjustRequest["place"] {
  return { case: "rackId", value: BigInt(place) };
}

// AdjustStockDialog corrects a shelf's stock (#139/#211). The REASON drives what it collects and does:
// a Recount is a whole-shelf count (absolute), while Damaged / Lost take a specific batch's units by a
// quantity. The place is always required — a correction applied to the wrong shelf is worse than none,
// because it is believed.
//
// A FOUND WAITS FOR THE OWNER OR ADMIN (an-adjust-found-waits-for-the-owner-or-admin): Found asks for no batch — the
// units go to the approval list (pages/found-requests) through FoundRequestCreate and nothing posts until another Owner
// or Admin approves them; the approval puts them into batches the way a stock count's found does.
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
  const report = useReportFound();
  const busy = adjust.isPending || report.isPending;

  // A found waits for approval: it names no batch and moves nothing now.
  const awaitsApproval = reasonType === "found";
  const isBatch = reasonType !== "recount";
  const needsBatch = isBatch && !awaitsApproval;

  const batches = useProductBatches({ warehouseId, productId: product.id });
  const batchList = batches.data ?? [];

  // The shelves this product sits on, for the delta preview's current figure.
  const placesQuery = useProductPlaces({ warehouseId, productIds: [product.id] });
  const places = placesQuery.data ?? [];

  function shelfOnHand(p: string): bigint {
    if (p === "") return 0n;
    const rackId = BigInt(p);
    return places.find((x) => x.rackId === rackId)?.onHand ?? 0n;
  }

  const amountNum = Number(amount);
  const amountValid = Number.isInteger(amountNum) && (isBatch ? amountNum >= 1 : amountNum >= 0);
  const canSubmit = place !== "" && amountValid && (!needsBatch || batch !== "");

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
    if (needsBatch && batch === "") {
      setError(t("inventory.adjustBatchRequiredError"));
      return;
    }
    if (!amountValid) {
      setError(t("inventory.countedOnHandError"));
      return;
    }

    setError("");

    if (awaitsApproval) {
      // The found as a REQUEST: no batch, nothing posted — it waits for the warehouse Owner or Admin.
      report.mutate(
        {
          teamId: warehouseId,
          productId: product.id,
          rackId: BigInt(place),
          quantity: BigInt(amountNum),
          note,
        },
        {
          onSuccess: () => {
            toaster.create({
              type: "success",
              title: t("inventory.adjustFoundSentToast", { productCode: product.productCode, count: amountNum }),
              description: t("inventory.adjustFoundSentToastDetail"),
            });
            onOpenChange(false);
          },
          onError: (err) => setError(rpcError(err)),
        },
      );
      return;
    }

    adjust.mutate(
      {
        warehouseId,
        productId: product.id,
        place: placeToOneof(place),
        reason: note,
        reasonType: REASON_ENUM[reasonType as Exclude<Reason, "found">],
        // A recount carries the counted on-hand; the batch reasons carry the batch + magnitude.
        onHand: isBatch ? 0n : BigInt(amountNum),
        batchId: isBatch ? BigInt(batch) : 0n,
        quantity: isBatch ? BigInt(amountNum) : 0n,
      },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("inventory.adjustedToast", { productCode: product.productCode, counted: amountNum }),
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
          <Dialog.Content data-testid="adjust-dialog">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("inventory.adjustStockTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="card">
                  {error && (
                    <Text color="error.fg" data-testid="adjust-error">
                      {error}
                    </Text>
                  )}

                  <Text fontSize="sm" color="fg.muted">
                    {t("inventory.adjustProductSummary", {
                      name: product.name,
                      productCode: product.productCode,
                      onHand: currentOnHand.toString(),
                    })}
                  </Text>

                  <Field.Root required>
                    <Field.Label>{t("inventory.placeCounted")}</Field.Label>
                    <RackSelect warehouseId={warehouseId} value={place} onChange={setPlace} allowUnplaced={false} />
                    <Field.HelperText>{t("inventory.placeCountedHelper")}</Field.HelperText>
                  </Field.Root>

                  {/* The reason first — it decides whether a batch and which quantity the rest asks for. */}
                  <Field.Root required>
                    <Field.Label>{t("inventory.adjustReasonType")}</Field.Label>
                    <NativeSelect.Root>
                      <NativeSelect.Field
                        value={reasonType}
                        data-testid="adjust-reason-type"
                        onChange={(e) => {
                          const next = e.target.value as Reason;
                          setReasonType(next);
                          // A found report starts at one unit, not at the rack's whole on-hand — the figure the field
                          // opens with is a recount's.
                          if (next === "found") setAmount("1");
                        }}
                      >
                        <option value="recount">{t("inventory.adjustReasonRecount")}</option>
                        <option value="damaged">{t("inventory.adjustReasonDamaged")}</option>
                        <option value="lost">{t("inventory.adjustReasonLost")}</option>
                        <option value="found">{t("inventory.adjustReasonFound")}</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Field.Root>

                  {/* A found that waits names no batch and changes nothing yet — said before the figures, so nobody
                      reads the form as a correction that has already happened. */}
                  {/* ONE LINE (owner: *"alertnya kepanjangan, ada yang lebih ringkas?"*, a-found-waits-in-one-line) — what
                      it claims back on approval is the hover's, for whoever asks. */}
                  {awaitsApproval && (
                    <Alert.Root
                      status="info"
                      title={t("inventory.adjustFoundWaitsApproval")}
                      data-testid="adjust-found-waits"
                    >
                      <Alert.Indicator>
                        <Icon as={Hourglass} boxSize="4" />
                      </Alert.Indicator>
                      <Alert.Content>
                        <Alert.Title fontWeight="normal">{t("inventory.foundWaits")}</Alert.Title>
                      </Alert.Content>
                    </Alert.Root>
                  )}

                  {/* Which delivery's units — only for the batch reasons; a recount is batch-agnostic, and a found that
                      waits is put into batches by its approval. */}
                  {needsBatch && (
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
                    <QuantityInput
                      min={isBatch ? 1 : 0}
                      width="full"
                      size="sm"
                      value={amount}
                      testId="adjust-amount"
                      onChange={setAmount}
                    />
                    <Field.HelperText>
                      {awaitsApproval ? t("inventory.adjustFoundHelper") : t("inventory.adjustHelper")}
                    </Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("inventory.adjustNote")}</Field.Label>
                    <Input
                      value={note}
                      maxLength={NOTE_MAX}
                      placeholder={
                        awaitsApproval ? t("inventory.adjustFoundNotePlaceholder") : t("inventory.adjustReasonPlaceholder")
                      }
                      data-testid="adjust-reason"
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <CharCount value={note} max={NOTE_MAX} testId="adjust-reason-count" />
                  </Field.Root>

                  {/* The delta preview — what the shelf reads before → after, so a correction is never a
                      blind commit (#211). A found that waits moves nothing, so it has none. */}
                  {canSubmit && !awaitsApproval && (
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
                        <Text as="span" color={signedDelta < 0n ? "error.fg" : "success.fg"}>
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
                  {awaitsApproval && <Icon as={Send} boxSize="4" />}
                  {awaitsApproval ? t("inventory.adjustFoundSend") : t("inventory.adjust")}
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
