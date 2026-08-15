import { useTranslation } from "react-i18next";
import { Span, Stack } from "@chakra-ui/react";
import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { ProductLinesPopover } from "../../components/entity/ProductLinesPopover";
import type { ProductLine } from "../../components/entity/ProductLinesPopover";
import { askedQuantity } from "./summary";

// The "what is in this restock" cell, shared by the selling list and the warehouse list (#105/#133).
//
// A list row is a SCANNING surface, not a breakdown: it leads with the size of the delivery — how
// many products and how many pieces, the two numbers that decide whether it is a padded envelope or
// a pallet — and names the first line so a row is still recognisable by its goods.
//
// The whole list is one click away behind the shared ProductLinesPopover, which is where the design
// of that summary lives; this file's job is only to say what a RESTOCK line is in its terms.
//
// `items` is defensively allowed to be empty. The contract requires at least one line, so an empty
// one means a partial response, and that should not blank a whole table.
export function RestockItemsCell({
  items,
  showPrices = true,
}: {
  items: RestockRequestItem[];
  /**
   * Whether the popover prices the lines. ON for the buying side, where the money is the point; OFF
   * for the warehouse's inbound queue, which is a counting job and has no business showing the crew
   * another team's purchase prices. (Its DETAIL page still prices them — that is landed cost, which
   * is the warehouse's own.)
   */
  showPrices?: boolean;
}) {
  const { t } = useTranslation();
  const [first, ...rest] = items;

  if (!first) {
    return (
      <Span fontSize="xs" color="fg.muted">
        {t("restock.table.noProducts")}
      </Span>
    );
  }

  // A restock line in the popover's terms. `total_price` is already THE LINE TOTAL (#140), which is
  // exactly what ProductLine wants — the per-piece figure is derived there.
  const lines: ProductLine[] = items.map((item) => ({
    id: item.id.toString(),
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    totalPrice: item.totalPrice,
  }));

  return (
    <Stack gap="0" minW="0">
      <Span fontWeight="medium">
        {/* `count` is i18next's plural selector, so the product count has to travel under that name
            — "1 products" is the reading it buys. The piece count rides alongside as plain
            interpolation. */}
        {t("restock.table.itemsSummary", {
          count: items.length,
          pieces: askedQuantity(items).toString(),
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
          label={t("restock.table.firstAndMore", { sku: first.sku, count: rest.length })}
          testId="restock-items"
        />
      )}
    </Stack>
  );
}
