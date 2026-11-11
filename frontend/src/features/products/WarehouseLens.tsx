import { Box, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { TeamSelect } from "../../components/teams/TeamSelect";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";

// THE WAREHOUSE LENS of a product's page — the picker in the Per Gudang card's header, and the note saying the figures
// under it are one warehouse's. The product's own page and its discover detail both (the-discover-detail-has-the-
// warehouse-zone), which is when they moved here from the product page's `parts.tsx`.

// The WAREHOUSE LENS control — ONE on the page, over the figures and every tab that is per-warehouse
// (the-product-page-is-one-page-of-sections); it was one per tab while the page had tabs.
//
// The shared TeamSelect restricted to WAREHOUSE teams — the same picker the product list uses, not a
// second dropdown of this page's own. It carries its own ✕ (every-filter-clears-from-its-own-x), so there is
// no separate clear button; every option is a warehouse, so the pick reads as its name alone
// (a-one-type-picker-shows-the-name-alone). The full width of a phone, a field's width beside a heading.
export function WarehouseFilter({
  value,
  onChange,
  testId,
}: {
  value: bigint;
  onChange: (id: bigint) => void;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Box w={{ base: "full", sm: "16rem" }} data-testid={testId}>
      <TeamSelect
        value={value > 0n ? value : undefined}
        onChange={onChange}
        teamType={TeamType.WAREHOUSE}
        showType={false}
        placeholder={t("products.allWarehouses")}
      />
    </Box>
  );
}

// Choosing a warehouse RESTATES every figure below as that warehouse's — it does not merely hide
// rows. Saying so is the point: a stock number that quietly became one building's, while still
// looking like the total, is the way this screen could lie without a single wrong value on it.
export function WarehouseNote({
  warehouseId,
  warehouseName,
}: {
  warehouseId: bigint;
  warehouseName?: string;
}) {
  const { t } = useTranslation();

  if (warehouseId === 0n) {
    return null;
  }

  return (
    <Text fontSize="sm" color="fg.muted" data-testid="pd-warehouse-note">
      {t("products.detail.warehouseNote", {
        warehouse: warehouseName || `#${warehouseId}`,
      })}
    </Text>
  );
}
