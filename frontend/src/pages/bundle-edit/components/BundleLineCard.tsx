import { useTranslation } from "react-i18next";
import { Box, Field, Flex, HStack, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import { Archive, Lock, Trash2 } from "lucide-react";

import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { type LineState, unavailable } from "../../../features/bundles/adapt";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { QuantityInput } from "../../../components/inputs/QuantityInput";
import { useIsMobile } from "../../../layouts/shell";

export interface BundleLineCardProps {
  productId: bigint;
  /** ProductByIds' answer — undefined while it loads, or when it cannot be named. */
  product: Product | undefined;
  state: LineState;
  /** The owning team's name, for a borrowed (or locked) line. */
  ownerName?: string;
  /** Kept as typed: an emptied box is empty, not 0. */
  quantity: string;
  readOnly: boolean;
  index: number;
  onQuantity: (quantity: string) => void;
  onRemove: () => void;
}

// ONE PRODUCT OF A BUNDLE, and how many go into one bundle (a-bundle-line-carries-its-quantity).
//
// A borrowed line names its owner, because whether a bundle leans on somebody else's stock is worth seeing while it is
// made. A line its product can no longer fill (a-borrowed-product-never-blocks-its-owner) says why, under the product:
//
//   locked    its owner stopped sharing it — on an order, this slot is filled with something else
//   archived  the product was deleted — same consequence; its name stays, marked
//
// Neither is removed for the person: the bundle is not changed by somebody else's action, so it is theirs to remove.
export function BundleLineCard({
  productId,
  product,
  state,
  ownerName,
  quantity,
  readOnly,
  index,
  onQuantity,
  onRemove,
}: BundleLineCardProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const id = `bundle-line-${index}`;
  const borrowed = state === "borrowed" || state === "locked";

  const amount = readOnly ? (
    <Text fontSize="sm" whiteSpace="nowrap" data-testid={`${id}-quantity`}>
      {t("bundles.form.perBundleRead", { count: Number(quantity) || 0 })}
    </Text>
  ) : (
    <Field.Root w={isMobile ? "full" : "auto"}>
      <Field.Label fontSize="xs">{t("bundles.form.perBundle")}</Field.Label>
      <QuantityInput
        min={1}
        max={9999}
        width={isMobile ? "full" : "16"}
        value={quantity}
        testId={`${id}-quantity`}
        aria-label={t("bundles.form.perBundle")}
        onChange={onQuantity}
      />
    </Field.Root>
  );

  const remove = readOnly ? null : (
    <IconButton
      type="button"
      size="xs"
      variant="ghost"
      colorPalette="error"
      aria-label={t("bundles.form.removeProduct")}
      data-testid={`${id}-remove`}
      onClick={onRemove}
    >
      <Icon as={Trash2} boxSize="4" />
    </IconButton>
  );

  return (
    <Box
      borderWidth="1px"
      borderColor={unavailable(state) ? "warning.muted" : "border"}
      rounded="md"
      p="card"
      data-testid={id}
      data-state={state}
    >
      <Stack gap="card">
        <ProductListItem
          product={{
            id: productId,
            // The owner is named only for another team's product — your own needs no label.
            teamId: borrowed ? product?.teamId : undefined,
            sku: product?.sku,
            name: product ? `${product.name}${state === "archived" ? ` ${t("bundles.archivedSuffix")}` : ""}` : undefined,
            defaultImageUrl: product?.defaultImageUrl,
            defaultImageThumbnailUrl: product?.defaultImageThumbnailUrl,
          }}
          teamName={borrowed ? ownerName : undefined}
          action={
            isMobile ? (
              remove
            ) : (
              <Flex gap="card" align="end">
                {amount}
                {remove}
              </Flex>
            )
          }
        />

        {isMobile && amount}

        {unavailable(state) && (
          <HStack gap="1.5" color="warning.fg" align="start" data-testid={`${id}-unavailable`}>
            <Icon as={state === "locked" ? Lock : Archive} boxSize="4" mt="0.5" flexShrink={0} />
            <Text fontSize="sm">{state === "locked" ? t("bundles.form.locked") : t("bundles.form.archived")}</Text>
          </HStack>
        )}
      </Stack>
    </Box>
  );
}
