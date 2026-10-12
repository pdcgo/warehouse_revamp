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
  Input,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Trash2, X } from "lucide-react";

import type { SupplierChannel } from "../../../gen/warehouse/supplier/v1/supplier_channel_pb";
import type { SupplierRecord } from "../../../features/suppliers/adapt";
import { LineSupplier } from "../../../features/restock/LineSupplier";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { SupplierChannelPicker } from "../../../components/pickers/SupplierChannelPicker";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiah } from "../../../lib/money";
import { type FormMode, type LineDraft, needsNote, perPiece, toQty } from "../draft";
import { RESTOCK_FORM_PENDING } from "../pending";

export interface LineCardProps {
  line: LineDraft;
  index: number;
  mode: FormMode;
  /** The caller's team — the supplier picker's scope. */
  teamId: bigint;
  suppliers: Record<string, SupplierRecord>;
  channels: Record<string, SupplierChannel>;
  onPatch: (patch: Partial<LineDraft>) => void;
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
export function LineCard({ line, index, mode, teamId, suppliers, channels, onPatch, onRemove }: LineCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const arrived = mode === "arrived";
  const supplierLocked = arrived && line.stored;
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
      <Field.Root w={isMobile ? "full" : "auto"}>
        <Field.Label fontSize="xs">{t("restock.form.count")}</Field.Label>
        <QuantityInput
          min={1}
          width={isMobile ? "full" : "16"}
          value={line.count}
          testId={`restock-qty-${index}`}
          aria-label={t("restock.form.count")}
          onChange={(count) => onPatch({ count })}
        />
      </Field.Root>

      <Field.Root w={isMobile ? "full" : "32"}>
        <Field.Label fontSize="xs">{t("restock.form.lineTotal")}</Field.Label>
        <CurrencyInput
          value={line.total}
          data-testid={`restock-total-price-${index}`}
          onChange={(total) => onPatch({ total })}
        />
        {/* Derived for the eye only — the TOTAL is what is stored, so a rounded piece price can never disagree
            with what was paid. */}
        <Field.HelperText data-testid={`restock-per-piece-${index}`}>
          {toQty(line.count) > 0 ? t("restock.form.perPiece", { price: formatRupiah(perPiece(line)) }) : "—"}
        </Field.HelperText>
      </Field.Root>
    </>
  );

  return (
    <Box borderWidth="1px" rounded="md" p="card" data-testid={id}>
      <Stack gap="card">
        <ProductListItem
          product={{
            id: line.productId,
            sku: line.sku,
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
            <HStack gap="1">
              <Text fontSize="xs" fontWeight="bold" color="fg.label">
                {t("restock.form.boughtFrom")}
              </Text>
              <NotImplemented list={RESTOCK_FORM_PENDING} id="lineSupplier" />
            </HStack>

            <Flex gap="2" align="center" wrap="wrap">
              {/* A basis, not just `flex="1"`: on a phone the actions wrap to their own line rather than squeezing the
                  name into a one-word column. */}
              <Box flex="1 1 12rem" minW="0">
                <LineSupplier
                  supplierId={line.supplierId}
                  supplierChannelId={line.supplierChannelId}
                  suppliers={suppliers}
                  channels={channels}
                  testId={`${id}-supplier-shown`}
                />
              </Box>

              {!supplierLocked && (
                <HStack gap="1">
                  <SupplierChannelPicker
                    teamId={teamId}
                    value={{ supplierId: line.supplierId, supplierChannelId: line.supplierChannelId }}
                    onChange={(pick) => onPatch(pick)}
                    testId={`${id}-picker`}
                    trigger={
                      line.supplierId > 0n ? (
                        <Button type="button" size="xs" variant="outline">
                          {t("restock.form.changeSupplier")}
                        </Button>
                      ) : undefined
                    }
                  />
                  {line.supplierId > 0n && (
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
                </HStack>
              )}
            </Flex>
          </Stack>

          {/* ── The selling team's note on the line ─────────────────────────────────────────────── */}
          <Field.Root invalid={noteMissing} required={arrived && !line.stored}>
            <Field.Label fontSize="xs">
              <HStack gap="1">
                {t("restock.form.lineNote")}
                <Field.RequiredIndicator />
                <NotImplemented list={RESTOCK_FORM_PENDING} id="lineNote" />
              </HStack>
            </Field.Label>
            <Input
              value={line.note}
              maxLength={200}
              placeholder={t("restock.form.lineNotePlaceholder")}
              data-testid={`${id}-note`}
              onChange={(e) => onPatch({ note: e.target.value })}
            />
            {noteMissing && <Field.ErrorText>{t("restock.form.lineNoteRequired")}</Field.ErrorText>}
          </Field.Root>
        </SimpleGrid>
      </Stack>
    </Box>
  );
}
