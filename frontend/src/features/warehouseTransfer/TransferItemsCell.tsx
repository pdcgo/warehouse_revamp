import { useTranslation } from "react-i18next";
import { Span, Stack } from "@chakra-ui/react";
import type { WarehouseTransferItem } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { ProductLinesPopover } from "../../components/products/ProductLinesPopover";
import type { ProductLine } from "../../components/products/ProductLinesPopover";
import { unitsSent } from "./summary";

// The "what is in this transfer" cell, shared by both transfer lists. It leads with the size of the box — how many
// products and how many pieces — and names the first line, with the whole list one click away in the shared
// ProductLinesPopover. One line per product (a-product-appears-once-per-transfer), so a product never repeats here.
export function TransferItemsCell({
  items,
  showPrices = true,
}: {
  items: WarehouseTransferItem[];
  /** ON for the owning team, where the value is its own; OFF for a warehouse crew, whose job is counting. */
  showPrices?: boolean;
}) {
  const { t } = useTranslation();
  const [first, ...rest] = items;

  if (!first) {
    return (
      <Span fontSize="xs" color="fg.muted">
        {t("warehouseTransfer.table.noProducts")}
      </Span>
    );
  }

  const lines: ProductLine[] = items.map((item) => ({
    id: item.id.toString(),
    sku: item.sku,
    name: item.name,
    quantity: item.count,
    totalPrice: item.total,
  }));

  return (
    <Stack gap="0" minW="0">
      <Span fontWeight="medium">
        {t("warehouseTransfer.table.itemsSummary", {
          count: items.length,
          pieces: unitsSent(items).toString(),
        })}
      </Span>

      {rest.length === 0 ? (
        <Span fontSize="xs" color="fg.muted" lineClamp={1}>
          {first.sku}
        </Span>
      ) : (
        <ProductLinesPopover
          lines={lines}
          showPrices={showPrices}
          label={t("warehouseTransfer.table.firstAndMore", { sku: first.sku, count: rest.length })}
          testId="transfer-items"
        />
      )}
    </Stack>
  );
}
