import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  HStack,
  Icon,
  IconButton,
  SimpleGrid,
  Stack,
  Textarea,
} from "@chakra-ui/react";
import { Trash2, Undo2, X } from "lucide-react";

import type { SupplierChannel } from "../../../gen/warehouse/supplier/v1/supplier_channel_pb";
import type { SupplierRecord } from "../../../features/suppliers/adapt";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiahNumber } from "../../../lib/money";
import { type FormMode, type LineDraft, needsNote, perPiece, supplierOpen, toQty } from "../draft";
import { SupplierBox } from "./SupplierBox";

/** A line's note — the contract's `max_len`. */
const MAX_LINE_NOTE = 200;

export interface LineCardProps {
  line: LineDraft;
  index: number;
  mode: FormMode;
  /** The caller's team — the supplier picker's scope. */
  teamId: bigint;
  suppliers: Record<string, SupplierRecord>;
  channels: Record<string, SupplierChannel>;
  /** The form has a supplier for all products (one-supplier-for-all-in-two-steps). */
  hasAllSupplier: boolean;
  onPatch: (patch: Partial<LineDraft>) => void;
  /** Back to the supplier for all products, from a line that picked its own. */
  onFollowAll: () => void;
  onRemove: () => void;
}

// ONE LINE OF A RESTOCK: one product, its count and total, where it was bought, and the selling team's note on it.
//
//   count + TOTAL     typed as the invoice prints them; the per-piece price is derived (a-line-is-typed-as-its-total).
//   bought from       any team's supplier, and optionally one of its stores, from the Connect Supplier Channel popup
//                     (a-line-connects-to-any-teams-supplier-from-a-popup, a-line-may-name-a-supplier-without-a-channel).
//   note              the selling team's — "extra stock" (extra-units-are-added-by-the-selling-teams-edit).
//
// While the box is at the door (arrived) the count, total and note stay open (the-lines-stay-editable-until-accepted).
// A STORED line keeps its supplier and cannot be removed — it becomes `missing` at accept
// (lines-can-be-added-not-removed-while-arrived). A line added in this edit carries an "Added" badge, needs a note, and
// may name where it was bought (a-line-added-after-arrival-names-its-supplier).
//
// A ROW OF THE PRODUK CARD, not a card of its own (never a card inside a card) — the card draws a rule between lines.
//
// WITH A SUPPLIER FOR ALL PRODUCTS (one-supplier-for-all-in-two-steps) a line either FOLLOWS it — marked "Ikut semua",
// Ganti makes it its own — or has picked its own, and "Ikut Semua" takes it back. Without one, ✕ clears the line.
export function LineCard({
  line,
  index,
  mode,
  teamId,
  suppliers,
  channels,
  hasAllSupplier,
  onPatch,
  onFollowAll,
  onRemove,
}: LineCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const arrived = mode === "arrived";
  const supplierLocked = !supplierOpen(mode, line);
  const follows = hasAllSupplier && line.followsAll;
  const removable = !(arrived && line.stored);
  const noteMissing = needsNote(mode, line);
  const id = `restock-line-${index}`;

  const removeButton = removable ? (
    <IconButton
      type="button"
      size="xs"
      variant="ghost"
      colorPalette="error"
      aria-label={t("restock.form.removeProduct")}
      data-testid={`restock-remove-${index}`}
      onClick={onRemove}
    >
      <Icon as={Trash2} boxSize="4" />
    </IconButton>
  ) : null;

  const numbers = (
    <>
      {/* Both REQUIRED (owner: *"jumlah dan total produk juga wajib"*, the-count-and-total-are-required). */}
      <Field.Root required w={isMobile ? "full" : "auto"}>
        <Field.Label>
          {t("restock.form.count")}
          <Field.RequiredIndicator />
        </Field.Label>
        <QuantityInput
          min={1}
          width={isMobile ? "full" : "16"}
          value={line.count}
          testId={`restock-qty-${index}`}
          aria-label={t("restock.form.count")}
          onChange={(count) => onPatch({ count })}
        />
      </Field.Root>

      <Field.Root required w={isMobile ? "full" : "32"}>
        <Field.Label>
          {t("restock.form.lineTotal")}
          <Field.RequiredIndicator data-testid={`restock-total-required-${index}`} />
        </Field.Label>
        <CurrencyInput
          value={line.total}
          data-testid={`restock-total-price-${index}`}
          onChange={(total) => onPatch({ total })}
        />
        {/* Derived for the eye only — the TOTAL is what is stored, so a rounded piece price can never disagree
            with what was paid. */}
        <Field.HelperText data-testid={`restock-per-piece-${index}`}>
          {toQty(line.count) > 0 ? t("restock.form.perPiece", { price: formatRupiahNumber(perPiece(line)) }) : "—"}
        </Field.HelperText>
      </Field.Root>
    </>
  );

  return (
    <Box data-testid={id}>
      <Stack gap="card">
        <ProductListItem
          product={{
            id: line.productId,
            productCode: line.productCode,
            name: line.name,
            defaultImageUrl: line.imageUrl,
            defaultImageThumbnailUrl: line.thumbnailUrl,
          }}
          action={
            isMobile ? (
              removeButton
            ) : (
              <Flex gap="card" align="start" justify="end">
                {arrived && !line.stored && (
                  <Badge colorPalette="info" variant="subtle" alignSelf="center" data-testid={`${id}-added`}>
                    {t("restock.form.addedLine")}
                  </Badge>
                )}
                {numbers}
                <Box pt="6">{removeButton}</Box>
              </Flex>
            )
          }
        />

        {isMobile && (
          <Stack gap="card">
            {arrived && !line.stored && (
              <Badge colorPalette="info" variant="subtle" alignSelf="flex-start" data-testid={`${id}-added`}>
                {t("restock.form.addedLine")}
              </Badge>
            )}
            <SimpleGrid columns={2} gap="card">
              {numbers}
            </SimpleGrid>
          </Stack>
        )}

        <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
          {/* ── Where it was bought ─────────────────────────────────────────────────────────────── */}
          <Stack gap="1.5" minW="0" data-testid={`${id}-supplier`}>
            {/* Every product names its supplier (the-checks-run-products-warehouse-account-resi) — marked as a required
                field is, where it can still be given. */}
            <Field.Root required={!supplierLocked}>
              <Field.Label>
                {t("restock.form.boughtFrom")}
                {!supplierLocked && <Field.RequiredIndicator data-testid={`${id}-supplier-required`} />}
              </Field.Label>
            </Field.Root>

            {/* THE SAME BOX AS THE CARD'S SUPPLIER PART (owner: *"hubungkan supplier per produk desainnya kurang"*,
                a-product-picks-its-supplier-from-the-same-box) — a field to choose in, not a sentence beside a button. */}
            <SupplierBox
              teamId={teamId}
              value={{ supplierId: line.supplierId, supplierChannelId: line.supplierChannelId }}
              suppliers={suppliers}
              channels={channels}
              // A pick of its own — the line stops following the supplier for all products.
              onPick={(pick) => onPatch({ ...pick, followsAll: false })}
              locked={supplierLocked}
              noneText={supplierLocked ? t("restock.lineSupplier.none") : t("restock.form.allSupplierNone")}
              after={
                follows && (
                  <Badge size="sm" variant="subtle" colorPalette="info" flexShrink={0} data-testid={`${id}-supplier-follows`}>
                    {t("restock.form.followsAll")}
                  </Badge>
                )
              }
              actions={
                <>
                  {hasAllSupplier && !follows && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      data-testid={`${id}-supplier-follow`}
                      onClick={onFollowAll}
                    >
                      <Icon as={Undo2} boxSize="4" />
                      {t("restock.form.followAll")}
                    </Button>
                  )}
                  {!hasAllSupplier && line.supplierId > 0n && (
                    <IconButton
                      type="button"
                      size="xs"
                      variant="ghost"
                      aria-label={t("restock.form.clearSupplier")}
                      data-testid={`${id}-supplier-clear`}
                      onClick={() => onPatch({ supplierId: 0n, supplierChannelId: 0n })}
                    >
                      <Icon as={X} boxSize="4" />
                    </IconButton>
                  )}
                </>
              }
              testId={`${id}-supplier`}
              shownTestId={`${id}-supplier-shown`}
              pickerTestId={`${id}-picker`}
              changeTestId={`${id}-picker`}
            />
          </Stack>

          {/* ── The selling team's note on the line ─────────────────────────────────────────────── */}
          <Field.Root invalid={noteMissing} required={arrived && !line.stored}>
            <Field.Label>
              <HStack gap="1">
                {t("restock.form.lineNote")}
                <Field.RequiredIndicator />
              </HStack>
            </Field.Label>
            {/* A TEXTAREA, TWO ROWS TO START (owner: *"catatan produk jadi textarea tingginya default 2"*,
                a-line-note-is-two-rows) — a note on a product is a sentence, not a code; two rows sit level with the
                supplier box beside it. */}
            <Textarea
              rows={2}
              value={line.note}
              maxLength={MAX_LINE_NOTE}
              placeholder={t("restock.form.lineNotePlaceholder")}
              data-testid={`${id}-note`}
              onChange={(e) => onPatch({ note: e.target.value })}
            />
            <Flex w="full" gap="card" justify="space-between" align="start">
              {noteMissing ? <Field.ErrorText>{t("restock.form.lineNoteRequired")}</Field.ErrorText> : <span />}
              {/* How much of the limit is used (a-limited-field-shows-its-count). */}
              <Field.HelperText alignSelf="end" flexShrink={0} data-testid={`${id}-note-count`}>
                {line.note.length}/{MAX_LINE_NOTE}
              </Field.HelperText>
            </Flex>
          </Field.Root>
        </SimpleGrid>
      </Stack>
    </Box>
  );
}
