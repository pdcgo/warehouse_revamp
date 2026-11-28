import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Box,
  Button,
  CloseButton,
  Dialog,
  Drawer,
  Field,
  Grid,
  HStack,
  Icon,
  Portal,
  Stack,
  StackSeparator,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowDown, ArrowUp, Equal, Hourglass, Send } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { ProductPlace, StockAdjustRequest } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { StockAdjustReason } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { toaster } from "../../components/feedback/Toaster";
import { BatchSelect } from "../../components/pickers/BatchSelect";
import { RackSelect } from "../../components/pickers/RackSelect";
import { ProductListItem } from "../../components/products/ProductListItem";
import { useIsMobile } from "../../layouts/shell";
import { CharCount } from "../../components/inputs/CharCount";
import { RadioPills } from "../../components/inputs/RadioPills";
import { useAdjustStock, useProductPlaces } from "./queries";
import { useReportFound } from "./foundRequests";
import { QuantityInput } from "../../components/inputs/QuantityInput";

export const description =
  "Corrects one product on one rack. It leads with what it adjusts — the product and how many units it has here, and, opened from a batch's page (`fixedBatch`), that batch and its units left, its racks the only ones offered. The reason drives what it asks: a Recount takes the counted figure for the rack, Damaged and Lost take a quantity — of the page's batch, or of one picked from the product's batches. The preview shows the stock before, the calculation, and the difference with a Berkurang / Bertambah badge. Found names no batch (an-adjust-found-waits-for-the-owner-or-admin): it reports the units through FoundRequestCreate to the warehouse Owner or Admin and says plainly that nothing changes until one of them — never the reporter — approves.";

// The reason drives the model (#211): a RECOUNT reconciles the whole shelf to a counted figure, DAMAGED/LOST take a
// specific batch's units, and a FOUND is a request that waits for approval.
type Reason = "recount" | "damaged" | "lost" | "found";

// StockAdjust's reasons; a found never goes through StockAdjust (the server refuses it there).
const REASON_ENUM: Record<Exclude<Reason, "found">, StockAdjustReason> = {
  recount: StockAdjustReason.RECOUNT,
  damaged: StockAdjustReason.DAMAGED,
  lost: StockAdjustReason.LOST,
};

// The four reasons, in the order the pills show them, with their words.
const REASONS: { value: Reason; labelKey: string }[] = [
  { value: "recount", labelKey: "inventory.adjustReasonRecount" },
  { value: "damaged", labelKey: "inventory.adjustReasonDamaged" },
  { value: "lost", labelKey: "inventory.adjustReasonLost" },
  { value: "found", labelKey: "inventory.adjustReasonFound" },
];

// StockAdjustRequest.reason's max_len — the box stops where the server would refuse (a-limited-field-shows-its-count).
const NOTE_MAX = 200;

// Every unit is on a rack (there-is-no-unplaced-pile), so the place is always a rack.
function placeToOneof(place: string): StockAdjustRequest["place"] {
  return { case: "rackId", value: BigInt(place) };
}

/** A figure at the right of the dialog's top block — *Tersedia 7 unit*, *Tersisa 7 unit*. */
function SubjectFigure({ label, units, testId }: { label: string; units: bigint; testId: string }) {
  const { t } = useTranslation();

  return (
    <Stack gap="0" align="end" flexShrink={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontWeight="bold" whiteSpace="nowrap" data-testid={testId}>
        {t("inventory.adjustUnits", { count: Number(units) })}
      </Text>
    </Stack>
  );
}

/** One line of the preview — its name at the left, its figure at the right. */
function PreviewRow({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <HStack justify="space-between" gap="3">
      <Text color="fg.muted">{label}</Text>
      <Box textAlign="end" data-testid={testId}>
        {children}
      </Box>
    </HStack>
  );
}

// Which way the shelf moves — a STATUS, so its colour is a role: red when it falls, green when it rises, grey when it
// holds (the-adjust-preview-shows-its-working).
const DIRECTION = {
  down: { palette: "error", icon: ArrowDown, labelKey: "inventory.adjustDown" },
  up: { palette: "success", icon: ArrowUp, labelKey: "inventory.adjustUp" },
  same: { palette: "gray", icon: Equal, labelKey: "inventory.adjustSame" },
} as const;

function DirectionBadge({ delta }: { delta: bigint }) {
  const { t } = useTranslation();
  const direction = delta < 0n ? "down" : delta > 0n ? "up" : "same";
  const { palette, icon, labelKey } = DIRECTION[direction];

  return (
    <Badge colorPalette={palette} variant="subtle" data-testid="adjust-delta-badge" data-direction={direction}>
      <Icon as={icon} boxSize="3" />
      {t(labelKey)}
    </Badge>
  );
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
  places: placesRead,
  fixedBatch,
}: {
  warehouseId: bigint;
  product: Product;
  currentOnHand: bigint;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where the product sits now, when the page holding the dialog has read it already (the product page, a batch's,
   * #133) — the dialog then reads nothing of its own: mounted closed beside that page, its own read was the page's
   * ProductPlaces again on every load.
   */
  places?: ProductPlace[];
  /**
   * The batch the dialog was opened FROM — a batch's page. Damaged and Lost then take it without asking (owner: *"kenapa
   * di sesuaikan stok harus pilih batch lagi?"*, the-batch-page-adjusts-its-own-batch); it is said at the top, under the
   * product, with how many units it has left — and the rack is one of `rackIds`, the racks it was put on (owner:
   * *"racknya jangan tampil semua, sesuai dengan rack batchnya"*, the-adjust-dialog-leads-with-what-it-adjusts). Absent on
   * a product's pages, where Damaged and Lost pick the batch. `source` is where it came from — *Restok #503*, *Retur*.
   */
  fixedBatch?: { id: bigint; ready: bigint; source: string; rackIds?: bigint[] };
}) {
  const { t } = useTranslation();
  const [reasonType, setReasonType] = useState<Reason>("recount");
  const [place, setPlace] = useState("");
  const [picked, setPicked] = useState("");
  // The page's batch when it gave one, read on each render — the page can change batch under a dialog that stays mounted.
  const batch = fixedBatch ? fixedBatch.id.toString() : picked;
  // One figure, read per reason: the counted on-hand for a recount, the magnitude for the others.
  const [amount, setAmount] = useState(currentOnHand.toString());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const adjust = useAdjustStock();
  const report = useReportFound();
  const busy = adjust.isPending || report.isPending;
  // The preview sits beside the form where there is room, under it on a phone — a JS breakpoint, one layout mounted.
  const isMobile = useIsMobile();


  // A found waits for approval: it names no batch and moves nothing now.
  const awaitsApproval = reasonType === "found";
  const isBatch = reasonType !== "recount";
  const needsBatch = isBatch && !awaitsApproval;

  // The shelves this product sits on, for the delta preview's current figure.
  const placesQuery = useProductPlaces({ warehouseId: placesRead ? undefined : warehouseId, productIds: [product.id] });
  const places = placesRead ?? placesQuery.data ?? [];

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

  // THE PREVIEW — what the shelf held, what this reason does to it, and the difference with the total it leaves, so a
  // correction is never a blind commit (#211). Drawn as a receipt, at the form's right (owner: *"pratinjau kasih di
  // kanannya, ditemukan ada pratinjaunya, tidak perlu perhitungan kasih aja Hilang/rusak/dsb, lalu bawahnya selisih ada
  // totalnya"*, the-adjust-preview-shows-its-working):
  //
  //   Pratinjau
  //   Stok sebelumnya              5
  //   Rusak                       −2        Hitung ulang 8 · Hilang −2 · Ditemukan +2
  //   Selisih     [↓ Berkurang]   −2        [↑ Bertambah] +3 · [= Tetap] 0
  //   Total                        3        a found: *Total setelah disetujui* — nothing moves until then
  //
  // Always on screen — a dash until a rack and a figure are given — so the column beside the form is never empty.
  const known = place !== "" && amountValid;
  const signed = (n: bigint) => (n > 0n ? `+${n}` : n < 0n ? `−${-n}` : "0");
  const reasonLabel = t(REASONS.find((r) => r.value === reasonType)?.labelKey ?? "");
  const preview = (
    <Box
      borderWidth="1px"
      borderColor="border"
      rounded="l2"
      bg="bg.muted"
      px="3"
      py="2"
      fontSize="sm"
      fontVariantNumeric="tabular-nums"
      data-testid="adjust-delta"
      data-known={known || undefined}
    >
      <Text fontWeight="bold" color="fg.label" mb="2">
        {t("inventory.adjustPreview")}
      </Text>
      <Stack gap="2" separator={<StackSeparator />}>
        <PreviewRow label={t("inventory.adjustBefore")} testId="adjust-delta-before">
          <b>{place === "" ? "—" : current.toString()}</b>
        </PreviewRow>
        {/* The reason itself, and what it does: a recount's counted figure, the others' units in or out. */}
        <PreviewRow label={reasonLabel} testId="adjust-delta-reason">
          <b>{!amountValid ? "—" : reasonType === "recount" ? String(amountNum) : signed(signedDelta)}</b>
        </PreviewRow>
        <PreviewRow label={t("inventory.adjustDiff")} testId="adjust-delta-diff">
          {known ? (
            <HStack gap="2" justify="end">
              <DirectionBadge delta={signedDelta} />
              <b>{signed(signedDelta)}</b>
            </HStack>
          ) : (
            <b>—</b>
          )}
        </PreviewRow>
        <PreviewRow
          label={awaitsApproval ? t("inventory.adjustTotalApproved") : t("inventory.adjustTotal")}
          testId="adjust-delta-total"
        >
          <Text as="span" fontWeight="bold" fontSize="md">
            {known ? next.toString() : "—"}
          </Text>
        </PreviewRow>
      </Stack>
    </Box>
  );

  // THE FORM, written once — the dialog's body on a desktop, the drawer's on a phone.
  const body = (
    <Stack gap="card">
      {error && (
        <Text color="error.fg" data-testid="adjust-error">
          {error}
        </Text>
      )}

      {/* WHAT IS BEING ADJUSTED, FIRST (owner: *"dari atas, kasih aja info produk, tersedia berapa unit
          keseluruhan; kalau di batch seperti sekarang, tampilkan batchnya dan tersisa berapa unit"*,
          the-adjust-dialog-leads-with-what-it-adjusts) — the product as every screen draws it, with how many
          units it has in this warehouse; from a batch's page, that batch under it with its units left:

            [img] Beras Pandan Wangi 5kg          Tersedia
                  SKU-BERAS-5K                     7 unit
            ───────────────────────────────────────────────
            Batch #5031                            Tersisa
            Restok #503                            7 unit      */}
      <Box borderWidth="1px" borderColor="border" rounded="l2" data-testid="adjust-subject">
        <Stack gap="0" separator={<StackSeparator />}>
          <HStack gap="3" px="3" py="2">
            <Box flex="1" minW="0">
              <ProductListItem product={{ ...product, teamId: undefined }} />
            </Box>
            <SubjectFigure
              label={t("inventory.adjustAvailable")}
              units={currentOnHand}
              testId="adjust-available"
            />
          </HStack>
          {fixedBatch && (
            <HStack gap="3" px="3" py="2" data-testid="adjust-batch-fixed">
              <Stack gap="0" flex="1" minW="0">
                <Text fontWeight="bold">{t("batchDetail.batchNo", { id: fixedBatch.id.toString() })}</Text>
                {fixedBatch.source && (
                  <Text fontSize="xs" color="fg.muted">
                    {fixedBatch.source}
                  </Text>
                )}
              </Stack>
              <SubjectFigure label={t("inventory.adjustLeft")} units={fixedBatch.ready} testId="adjust-batch-left" />
            </HStack>
          )}
        </Stack>
      </Box>

      {/* THE FORM, AND ITS PREVIEW AT ITS RIGHT (owner: *"pratinjau kasih di kanannya"*,
          the-adjust-preview-shows-its-working) — one grid: two columns where there is room, one on a phone,
          where the preview comes after the note. The same nodes either way, so nothing is drawn twice. */}
      <Grid
        // The form a little narrower than the room it was given (owner: *"form kiri sedikit lebih kecilkan"*)
        // — the preview's column wider, so the reasons still sit in one row.
        templateColumns={isMobile ? "minmax(0, 1fr)" : "minmax(0, 1fr) 20rem"}
        gap={isMobile ? "card" : "section"}
        alignItems="start"
        data-testid="adjust-layout"
        data-layout={isMobile ? "stacked" : "side"}
      >
        <Stack gap="card" minW="0">
          <Field.Root required>
            <Field.Label>{t("inventory.placeCounted")}</Field.Label>
            {/* From a batch's page, only the racks the batch was put on. */}
            <RackSelect
              warehouseId={warehouseId}
              value={place}
              onChange={setPlace}
              allowUnplaced={false}
              onlyRackIds={fixedBatch?.rackIds}
            />
            <Field.HelperText>{t("inventory.placeCountedHelper")}</Field.HelperText>
          </Field.Root>

          {/* The reason first — it decides whether a batch and which quantity the rest asks for. RADIO PILLS
              (owner: *"aku ingin itu jadi pilihan radio kalau masih sedikit"*, the-adjust-reason-is-a-radio-pill):
              four reasons, all on screen at once — the list is StockAdjustReason's and Found, bounded by the code,
              since each reason has its own ledger rule; one more is a code change, never data that grows. */}
          <Field.Root required>
            <Field.Label>{t("inventory.adjustReasonType")}</Field.Label>
            <RadioPills<Reason>
              value={reasonType}
              onChange={(next) => {
                setReasonType(next);
                // A found report starts at one unit, not at the rack's whole on-hand — the figure the field
                // opens with is a recount's.
                if (next === "found") setAmount("1");
              }}
              options={REASONS.map((r) => ({
                value: r.value,
                label: t(r.labelKey),
                testId: `adjust-reason-option-${r.value}`,
              }))}
              ariaLabel={t("inventory.adjustReasonType")}
              testId="adjust-reason-type"
            />
          </Field.Root>

          {/* Which batch's units — only for the batch reasons; a recount is batch-agnostic, and a found that waits
              is put into batches by its approval. A SEARCH SELECT by the batch's own number (owner: *"batch
              selectnya"*, a-batch-is-picked-by-its-own-number): a product gains a batch with every restock, and
              the number is on the box's label.

              FROM A BATCH'S PAGE A REASON OPENS NOTHING BUT FOUND'S LINE (owner: *"alasan sudah tidak buka
              keterangan apapun, kecuali ditemukan"*) — the batch is said at the top already. */}
          {needsBatch && !fixedBatch && (
            <Field.Root required>
              <Field.Label>{t("inventory.adjustBatch")}</Field.Label>
              <BatchSelect
                warehouseId={warehouseId}
                productId={product.id}
                value={batch === "" ? 0n : BigInt(batch)}
                onChange={(id) => setPicked(id > 0n ? id.toString() : "")}
                testId="adjust-batch"
              />
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
            {/* A two-row box, as the rack's dialogs' notes (owner: *"catatan textarea"*) — why a count was off is
                often a sentence. */}
            <Textarea
              rows={2}
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
        </Stack>
        <Stack gap="card" minW="0">
          {preview}
          {/* A FOUND WAITS, SAID UNDER ITS PREVIEW (owner: *"untuk keterangan ditemukan stok berubah ketika
              disetujui kasih di bawah pratinjau saja"*) — beside the figures it qualifies, so nobody reads
              the total as a correction that has already happened; the form under the reasons opens nothing.
              ONE LINE (owner: *"alertnya kepanjangan, ada yang lebih ringkas?"*, a-found-waits-in-one-line) —
              what it claims back on approval is the hover's, for whoever asks. */}
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
        </Stack>
      </Grid>
    </Stack>
  );

  // Batal and Sesuaikan — on a phone two equal halves of the width, under the thumb, as Koreksi Harga's sheet.
  const halves = isMobile ? "1" : undefined;
  const buttons = (
    <HStack gap="2" justify="end" w={isMobile ? "full" : undefined}>
      <Button variant="outline" flex={halves} data-testid="adjust-cancel" onClick={() => onOpenChange(false)}>
        {t("inventory.cancel")}
      </Button>
      <Button
        type="submit"
        colorPalette="brand"
        flex={halves}
        loading={busy}
        disabled={!canSubmit}
        data-testid="submit-adjust"
      >
        {awaitsApproval && <Icon as={Send} boxSize="4" />}
        {awaitsApproval ? t("inventory.adjustFoundSend") : t("inventory.adjust")}
      </Button>
    </HStack>
  );

  // A PHONE: A DRAWER FROM THE BOTTOM (owner: *"sesuaikan stok juga pakai drawer di bawah"*,
  // the-adjust-dialog-is-a-sheet-on-a-phone) — the same form, the preview under the note, the two buttons under the thumb;
  // as Koreksi Harga's sheet beside it and every panel a phone opens (the-phone-opens-its-panels-from-the-bottom). The
  // form is `display: contents`, so the drawer's body still scrolls between its header and its footer.
  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="bottom">
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content roundedTop="l3" maxH="90dvh" data-testid="adjust-dialog">
              <Box as="form" display="contents" onSubmit={submit}>
                <Drawer.Header>
                  <Drawer.Title>{t("inventory.adjustStockTitle")}</Drawer.Title>
                </Drawer.Header>
                <Drawer.Body>{body}</Drawer.Body>
                <Drawer.Footer>{buttons}</Drawer.Footer>
                {/* After the body, so the first field takes the focus as the sheet opens, not ×. */}
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
              </Box>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    );
  }

  return (
    // Wide enough for the preview beside the form (a-count-change-previews-as-a-receipt).
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="xl">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="adjust-dialog">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("inventory.adjustStockTitle")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>{body}</Dialog.Body>
              <Dialog.Footer>{buttons}</Dialog.Footer>
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
