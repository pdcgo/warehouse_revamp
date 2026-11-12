import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  CloseButton,
  Dialog,
  Drawer,
  Field,
  Flex,
  HStack,
  Portal,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { CharCount } from "../../components/inputs/CharCount";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { useIsMobile } from "../../layouts/shell";
import { formatRupiah, formatSignedRupiah } from "../../lib/money";
import { useBatchRevalue } from "./queries";

export const description =
  "Correct Price — a batch's revaluation by the owning team's Owner or Admin (or Root): the current unit price, the new one, a required reason, and what changes (the units left, unchanged, and their value, by units × the difference); a confirm before it posts, since it is never rolled back; the server's refusal stays in the form. A bottom sheet on a phone.";

/** The reason's limit — the box stops where the server would refuse (a-limited-field-shows-its-count). */
export const REASON_MAX = 200;

/** Two prices closer than this are one price (stock-money-is-float64-compared-at-4-digits). */
const SAME_PRICE = 0.00005;

/** The batch the form corrects, as the page that opens it reads it. */
export interface CorrectPriceBatch {
  id: bigint;
  /** The OWNING team — whose goods (a-batch-carries-its-owner). */
  teamId: bigint;
  warehouseId: bigint;
  warehouseName: string;
  productName: string;
  /** The units left — the only units a correction reprices (a-late-cost-is-an-expense-not-a-revaluation). */
  units: bigint;
  /** The batch's unit price now. */
  price: number;
  /** The units left's value now — the batch's `stock_valuation`. */
  value: number;
}

// CORRECT PRICE — a batch's REVALUATION (the-owning-team-revalues-with-a-reason): a new unit price and a reason, from the
// owning team's Owner or Admin. It is for a typo or a markdown only — a cost that arrived late is an expense
// (a-late-cost-is-an-expense-not-a-revaluation) — and it reprices ONLY the units left: no unit moves, no rack changes
// (revaluation-and-opname-are-transaction-types), and the units already used or sold keep the price they left at. So the
// form says, before anything posts, what changes: the units (unchanged) and their value, by units × the difference
// (batch.md §Change Price Flow: change_valuation = delta_price_unit × stock_count).
//
//   Koreksi Harga                                                ×
//   Minyak Goreng Sawit 2L
//   Batch #7001 · Gudang Pusat
//   Harga satuan sekarang  Rp 45.700
//   Harga satuan baru *    [Rp 44.500                       ]
//   Alasan *               [Contoh: …                       ]  0/200
//   ┌ Yang berubah ───────────────────────────────────────────┐
//   │ Unit tersisa  30 pcs · tetap                            │
//   │ Nilai stok    Rp 1.371.000 → Rp 1.335.000   −Rp 36.000  │
//   └─────────────────────────────────────────────────────────┘
//                                         [Batal] [Simpan Harga]
//
// Simpan asks first (ConfirmDialog): a revaluation is never rolled back (revaluation-and-opname-are-transaction-types), a
// wrong one is put right by another. On a phone the form is a bottom sheet with Batal | Simpan as two halves
// (a-phone-edits-the-note-in-a-sheet's shape). A tap outside never throws what was typed away.
//
// It posts InventoryService.BatchRevalue (the-correct-price-prototype-is-accepted) with the price the form showed as
// `expected_price_unit`, so a correction someone made meanwhile is refused rather than overwritten; the refusal is shown in
// the form, as typed.
export function CorrectPriceDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: CorrectPriceBatch;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const revalue = useBatchRevalue();

  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  // A fresh form each time it opens — never the last batch's half-typed price.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setPrice("");
      setReason("");
      setReasonTouched(false);
      setError("");
    }
  }

  // ── THE RULES, the form's half of the server's (inventory_v1/batch_revalue.go refuses each too) ─────────────────────
  // No units left: a correction changes only the units left, so there is nothing to correct
  // (the-correct-price-prototype-is-accepted: *"refused — a batch with no units left"*).
  const noUnits = batch.units <= 0n;
  const typed = price !== "";
  const newPrice = typed ? Number(price) : NaN;
  // Above Rp 0 (a-corrected-price-is-above-zero).
  const notPositive = typed && !(newPrice > 0);
  // The same price corrects nothing.
  const samePrice = typed && !notPositive && Math.abs(newPrice - batch.price) < SAME_PRICE;
  const priceError = notPositive ? t("correctPrice.error.notPositive") : samePrice ? t("correctPrice.error.samePrice") : "";
  // The reason is required (the-owning-team-revalues-with-a-reason: *"the reason | required"*); spaces are no reason.
  const reasonMissing = reason.trim() === "";
  const priceOk = typed && priceError === "";
  const canSave = !noUnits && priceOk && !reasonMissing && !revalue.isPending;

  // WHAT CHANGES — the units left, unchanged, and their value: units × the difference.
  const delta = priceOk ? Number(batch.units) * (newPrice - batch.price) : 0;
  const valueAfter = batch.value + delta;

  const close = () => onOpenChange(false);

  async function confirm() {
    try {
      const result = await revalue.mutateAsync({
        teamId: batch.teamId,
        batchId: batch.id,
        expectedPriceUnit: batch.price,
        newPriceUnit: newPrice,
        reason: reason.trim(),
      });
      // The batch's price and its history are read again by the hook's invalidation (both the warehouse's and the
      // owner's screens).
      toaster.create({
        type: "success",
        title: t("correctPrice.saved", {
          id: batch.id.toString(),
          from: formatRupiah(result.priceUnitBefore),
          to: formatRupiah(result.priceUnitAfter),
        }),
      });
      close();
    } catch (err) {
      // The server's refusal, in the form — the confirm closes, the form stays with what was typed.
      setError(rpcError(err));
    }
  }

  const fact = (label: string, value: ReactNode, testId: string) => (
    <Flex justify="space-between" align="baseline" gap="card" fontSize="sm">
      <Text color="fg.muted">{label}</Text>
      <Box textAlign="end" fontVariantNumeric="tabular-nums" data-testid={testId}>
        {value}
      </Box>
    </Flex>
  );

  const body = (
    <Stack gap="field">
      {/* WHICH BATCH — the product, then the batch's OWN number and where it is held (a-batch-is-picked-by-its-own-number). */}
      <Stack gap="0">
        <Text fontWeight="bold" data-testid="correct-price-product">
          {batch.productName}
        </Text>
        <Text fontSize="sm" color="fg.muted" data-testid="correct-price-batch">
          {t("correctPrice.batchLine", { id: batch.id.toString(), warehouse: batch.warehouseName })}
        </Text>
      </Stack>

      {noUnits && (
        <Alert.Root status="warning" data-testid="correct-price-no-units">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{t("correctPrice.error.noUnits")}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}

      {fact(t("correctPrice.current"), <Text fontWeight="bold">{formatRupiah(batch.price)}</Text>, "correct-price-current")}

      <Field.Root required invalid={priceError !== ""} disabled={noUnits}>
        <Field.Label>{t("correctPrice.newPrice")}</Field.Label>
        <CurrencyInput
          fraction
          value={price}
          onChange={(v) => {
            setPrice(v);
            setError("");
          }}
          data-testid="correct-price-new"
        />
        {priceError ? (
          <Field.ErrorText data-testid="correct-price-new-error">{priceError}</Field.ErrorText>
        ) : (
          // What a correction is for, and what it is not (a-late-cost-is-an-expense-not-a-revaluation).
          <Field.HelperText>{t("correctPrice.newPriceHelper")}</Field.HelperText>
        )}
      </Field.Root>

      <Field.Root required invalid={reasonTouched && reasonMissing} disabled={noUnits}>
        <Field.Label>{t("correctPrice.reason")}</Field.Label>
        <Textarea
          rows={2}
          value={reason}
          maxLength={REASON_MAX}
          placeholder={t("correctPrice.reasonPlaceholder")}
          data-testid="correct-price-reason"
          onChange={(e) => {
            setReason(e.target.value);
            setError("");
          }}
          onBlur={() => setReasonTouched(true)}
        />
        <HStack justify="space-between" align="start" gap="2" w="full">
          {reasonTouched && reasonMissing ? (
            <Field.ErrorText data-testid="correct-price-reason-error">{t("correctPrice.error.reasonRequired")}</Field.ErrorText>
          ) : (
            // Who reads it — the warehouse too (the-owning-team-revalues-with-a-reason: *"the warehouse | sees every
            // revaluation of a batch it holds"*).
            <Field.HelperText>{t("correctPrice.reasonHelper")}</Field.HelperText>
          )}
          <CharCount value={reason} max={REASON_MAX} testId="correct-price-reason-count" />
        </HStack>
      </Field.Root>

      {/* WHAT CHANGES — never a blind commit, as the stock dialog's preview (#211). A quiet box, not a card in a card. */}
      <Stack
        gap="1.5"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        bg="bg.muted"
        p="card"
        data-testid="correct-price-effect"
      >
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {t("correctPrice.effect.title")}
        </Text>
        {fact(
          t("correctPrice.effect.units"),
          t("correctPrice.effect.unitsValue", { n: batch.units.toString() }),
          "correct-price-effect-units",
        )}
        {fact(
          t("correctPrice.effect.value"),
          priceOk ? (
            <>
              {formatRupiah(batch.value)} → <b>{formatRupiah(valueAfter)}</b>
            </>
          ) : (
            formatRupiah(batch.value)
          ),
          "correct-price-effect-value",
        )}
        {fact(
          t("correctPrice.effect.delta"),
          priceOk ? (
            <Text as="span" fontWeight="bold" color={delta < 0 ? "error.fg" : delta > 0 ? "success.fg" : undefined}>
              {formatSignedRupiah(delta)}
            </Text>
          ) : (
            <Text as="span" color="fg.subtle">
              —
            </Text>
          ),
          "correct-price-effect-delta",
        )}
        <Text fontSize="xs" color="fg.muted" pt="1">
          {t("correctPrice.effect.sold")}
        </Text>
      </Stack>

      {error && (
        <Alert.Root status="warning" data-testid="correct-price-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </Stack>
  );

  // Batal and Simpan — on a phone two equal halves of the width, under the thumb.
  const halves = isMobile ? "1" : undefined;
  const buttons = (
    <HStack gap="2" justify="end" w={isMobile ? "full" : undefined}>
      <Button variant="outline" flex={halves} data-testid="correct-price-cancel" onClick={close}>
        {t("common.cancel")}
      </Button>
      <Button colorPalette="brand" flex={halves} disabled={!canSave} data-testid="correct-price-save" onClick={() => setConfirming(true)}>
        {t("correctPrice.save")}
      </Button>
    </HStack>
  );

  // ASKED FIRST — it cannot be undone; what it will do, in figures.
  const confirmDialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      destructive={false}
      title={t("correctPrice.confirm.title", { id: batch.id.toString() })}
      message={t("correctPrice.confirm.message", {
        from: formatRupiah(batch.price),
        to: priceOk ? formatRupiah(newPrice) : "",
        units: batch.units.toString(),
        delta: formatSignedRupiah(delta),
      })}
      confirmLabel={t("correctPrice.confirm.action")}
      dismissLabel={t("correctPrice.confirm.dismiss")}
      onConfirm={confirm}
    />
  );

  if (isMobile) {
    return (
      <>
        <Drawer.Root
          open={open}
          onOpenChange={(e) => onOpenChange(e.open)}
          placement="bottom"
          closeOnInteractOutside={false}
        >
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content roundedTop="l3" maxH="90dvh" data-testid="correct-price-sheet">
                <Drawer.Header>
                  <Drawer.Title>{t("correctPrice.title")}</Drawer.Title>
                </Drawer.Header>
                <Drawer.Body data-testid="correct-price-dialog">{body}</Drawer.Body>
                <Drawer.Footer>{buttons}</Drawer.Footer>
                {/* After the body, so the first field takes the focus as the sheet opens, not ×. */}
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} closeOnInteractOutside={false}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content data-testid="correct-price-dialog">
              <Dialog.Header>
                <Dialog.Title>{t("correctPrice.title")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>{body}</Dialog.Body>
              <Dialog.Footer>{buttons}</Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      {confirmDialog}
    </>
  );
}
