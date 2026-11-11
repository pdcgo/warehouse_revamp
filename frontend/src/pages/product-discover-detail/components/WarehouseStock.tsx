import { useTranslation } from "react-i18next";
import { HStack, Portal, Spinner, Stack, Table, Text, Tooltip } from "@chakra-ui/react";

import type { PriceRange } from "../../../features/products/discoverSample";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiahRange } from "../../../lib/money";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

export interface WarehouseShelf {
  id: bigint;
  name: string;
  /** Ready on its shelves — undefined when the warehouse did not answer (unknown, never 0). */
  ready?: bigint;
  /** What another team pays for it there — absent where nothing is on the shelf, or no cost is known. */
  cross?: PriceRange;
  /** What it cost the team — on the team's OWN product only. */
  cost?: PriceRange;
}

// WHERE, HOW MANY, AND AT WHAT PRICE — what each warehouse holds of this product, and what it costs there (owner: *"di
// rak berarti ready saja atau siap, malah yang perlu adalah harga, karena harga tiap gudang bisa berbeda, dan bisa range
// juga per gudang"*, each-warehouse-says-ready-and-its-price). EVERY warehouse gets a row, the empty one included: out of
// stock there is the answer worth seeing, since an order ships from exactly one. The BODY of the page's Per Gudang
// section (the section draws the card).
//
//   Gudang Pusat    Siap 12    Rp 82.215 – Rp 83.230     ← the cross price, red, as on the card
//                              Rp 81.000 – Rp 82.000     ← and the cost under it, the team's own product only
//
// Each warehouse's units came in at their own costs, so its price is its own — and a range when they differ.
//
// The Harga Cross tab of the page's Per Gudang card, in Harga Modal's place (the-discover-detail-has-the-warehouse-zone);
// the tab carries the ⚠ while another team's price is invented, as the owner's page's tabs carry theirs.
export function WarehouseStock({
  shelves,
  loading,
  error,
}: {
  shelves: WarehouseShelf[];
  loading: boolean;
  /** The read's message — the rows are not drawn. */
  error?: string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const help = (
    <Text fontSize="sm" color="fg.muted">
      {t("discoverDetail.stockHelp")}
    </Text>
  );

  if (loading || error || shelves.length === 0) {
    return (
      <Stack gap="card">
        {help}
        {loading ? (
          <Spinner colorPalette="brand" size="sm" />
        ) : error ? (
          <Text color="error.fg" fontSize="sm" data-testid="discover-detail-stock-error">
            {error}
          </Text>
        ) : (
          <Text color="fg.muted" fontSize="sm">
            {t("discoverDetail.noWarehouses")}
          </Text>
        )}
      </Stack>
    );
  }

  const ready = (w: WarehouseShelf) => (w.ready === undefined ? "—" : t("products.stat.pcs", { n: w.ready.toString() }));

  if (isMobile) {
    // A PHONE READS EACH WAREHOUSE AS A BLOCK (a-phone-reads-each-line-as-a-block): the warehouse and what is ready, then
    // its price.
    return (
      <Stack gap="card">
        {help}
        <Stack gap="2">
          {shelves.map((w) => (
            <Stack key={w.id.toString()} borderWidth="1px" borderRadius="md" p="3" gap="1" data-testid={`discover-stock-row-${w.id}`}>
              <HStack justify="space-between" gap="2">
                <Text fontWeight="bold" truncate>
                  {w.name}
                </Text>
                <Text fontSize="sm" flexShrink={0}>
                  <Text as="span" color="fg.muted">
                    {t("discoverDetail.ready")}{" "}
                  </Text>
                  <Text as="span" fontWeight="bold" fontVariantNumeric="tabular-nums" data-testid={`discover-stock-ready-${w.id}`}>
                    {ready(w)}
                  </Text>
                </Text>
              </HStack>
              <Price shelf={w} />
            </Stack>
          ))}
        </Stack>
      </Stack>
    );
  }

  return (
    <Stack gap="card">
      {help}
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("discoverDetail.warehouse")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("discoverDetail.ready")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("discoverDetail.crossPrice")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {shelves.map((w) => (
            <Table.Row key={w.id.toString()} css={LIGHTS_UP} data-testid={`discover-stock-row-${w.id}`}>
              <Table.Cell>{w.name}</Table.Cell>
              <Table.Cell
                textAlign="end"
                fontVariantNumeric="tabular-nums"
                color={w.ready === 0n ? "error.fg" : undefined}
                data-testid={`discover-stock-ready-${w.id}`}
              >
                {ready(w)}
              </Table.Cell>
              <Table.Cell textAlign="end">
                <Price shelf={w} align="end" />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Stack>
  );
}

// ONE WAREHOUSE'S PRICE — the cross price, red and bold as on the card (a-discover-price-is-red-and-unlabelled), and on
// the team's own product the cost under it, smaller, in the body ink, naming itself in a tooltip
// (a-second-line-names-itself-in-a-tooltip). A dash where the shelf is empty: nothing there, nothing priced.
function Price({ shelf, align = "start" }: { shelf: WarehouseShelf; align?: "start" | "end" }) {
  const { t } = useTranslation();

  return (
    <Stack gap="0" align={align === "end" ? "flex-end" : "flex-start"} fontVariantNumeric="tabular-nums">
      <Text fontSize="sm" fontWeight={shelf.cross ? "bold" : undefined} color={shelf.cross ? "price.fg" : "fg.subtle"} data-testid={`discover-stock-cross-${shelf.id}`}>
        {shelf.cross ? formatRupiahRange(shelf.cross.min, shelf.cross.max) : "—"}
      </Text>
      {shelf.cost && (
        <Tooltip.Root openDelay={100} closeDelay={80}>
          <Tooltip.Trigger asChild>
            <Text fontSize="xs" color="fg" data-testid={`discover-stock-cost-${shelf.id}`}>
              {formatRupiahRange(shelf.cost.min, shelf.cost.max)}
            </Text>
          </Tooltip.Trigger>
          <Portal>
            <Tooltip.Positioner>
              <Tooltip.Content>{t("discover.price.costHint")}</Tooltip.Content>
            </Tooltip.Positioner>
          </Portal>
        </Tooltip.Root>
      )}
    </Stack>
  );
}
