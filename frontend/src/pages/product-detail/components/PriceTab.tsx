import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Card, Flex, SimpleGrid, Stack, Switch, Table, Text } from "@chakra-ui/react";

import { Pagination } from "../../../components/chrome/Pagination";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import type { OwnerStockRow } from "../../../features/products/adapt";
import { useOwnerCostLayers } from "../../../features/products/queries";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { formatMarkup } from "../../../lib/markup";
import { formatRupiah } from "../../../lib/money";
import { Pending, Stat, WarehouseFilter, WarehouseNote } from "./parts";

// The PRICE tab — the batches GROUPED BY WHAT THEY COST.
//
// A product has no selling price (what a buyer pays is set per order, on the shop that sells it), so
// the money it does have is what its units cost us — and that is not one number. The same product
// arrives at different prices, each delivery freezes its own, and every batch that froze the same cost
// is one COST LAYER. Grouping by price rather than listing deliveries is what makes "what is my stock
// worth, and at which prices" a question you can answer by looking.
//
// FIFO still draws the oldest batch; this view is about value, not about order. The Batch tab is the
// per-delivery list.

// The HPP SPREAD of the units on hand — cheapest to dearest. A RANGE, not an average, because the
// same product genuinely arrives at different prices and an average is exactly what hides that.
function CostRange({ stock }: { stock?: OwnerStockRow }) {
  if (stock === undefined || !stock.costKnown) {
    return <Pending />;
  }

  // One price when every layer agrees — "Rp 5.000 – Rp 5.000" would be noise.
  if (stock.costMin === stock.costMax) {
    return <Text>{formatRupiah(stock.costMin)}</Text>;
  }

  return (
    <Text>
      {formatRupiah(stock.costMin)} – {formatRupiah(stock.costMax)}
    </Text>
  );
}

// What a cross-selling team pays per unit: our cost plus the markup.
//
// Derived here rather than served, because it is arithmetic over two numbers the caller already has,
// and a figure computed in two places is a figure that will one day disagree with itself. The
// rounding is deliberate and the same both ends of the range — basis points over rupiah lands on
// fractions of a cent that no invoice can carry.
function CrossPrice({ stock, markupBps }: { stock?: OwnerStockRow; markupBps: number }) {
  if (stock === undefined || !stock.costKnown) {
    return <Pending />;
  }

  const withMarkup = (cost: bigint) => cost + (cost * BigInt(markupBps)) / 10_000n;

  const min = withMarkup(stock.costMin);
  const max = withMarkup(stock.costMax);

  if (min === max) {
    return <Text>{formatRupiah(min)}</Text>;
  }

  return (
    <Text>
      {formatRupiah(min)} – {formatRupiah(max)}
    </Text>
  );
}

// A layer's unit cost, or the word for "we never recorded one".
//
// An unknown cost is its own layer and is NOT Rp 0 (#74): a batch whose cost never got captured still
// has units on a shelf, and pricing them at nothing would understate the stock by exactly their worth.
function LayerCost({ unitCost, costKnown }: { unitCost: bigint; costKnown: boolean }) {
  const { t } = useTranslation();

  if (!costKnown) {
    return <Text color="fg.muted">{t("products.detail.layer.unknown")}</Text>;
  }

  return <Text>{formatRupiah(unitCost)}</Text>;
}

const PAGE_SIZE = 20;

export function PriceTab({
  teamId,
  product,
  stock,
  archived,
  warehouseId,
  warehouseName,
  onWarehouseChange,
  onToggleLocked,
  lockPending,
}: {
  teamId: bigint | undefined;
  product: Product;
  stock?: OwnerStockRow;
  archived: boolean;
  warehouseId: bigint;
  warehouseName?: string;
  onWarehouseChange: (id: bigint) => void;
  onToggleLocked: (locked: boolean) => void;
  lockPending: boolean;
}) {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);

  const layers = useOwnerCostLayers({
    teamId,
    productId: product.id,
    warehouseId,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = layers.data?.layers ?? [];

  return (
    <Stack gap="section">
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Flex gap="card" align="flex-end" justify="space-between" wrap="wrap">
              <Stack gap="0.5">
                <Text fontWeight="medium">{t("products.detail.costHeading")}</Text>
                <Text fontSize="sm" color="fg.muted">
                  {t("products.detail.costHelp")}
                </Text>
              </Stack>

              <WarehouseFilter
                value={warehouseId}
                onChange={(id) => {
                  onWarehouseChange(id);
                  // A new lens is a new set of layers, so page 2 of the old one means nothing.
                  setPage(1);
                }}
                testId="pd-price-warehouse-filter"
              />
            </Flex>

            <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              {/* The cheapest and dearest units currently held — the two ends of the table below,
                  said once at the top. A RANGE rather than one number because it genuinely is one,
                  and an average is exactly what hides the spread somebody opens this tab to see. */}
              <Stat label={t("products.table.priceRange")} testId="product-detail-cost">
                <CostRange stock={stock} />
              </Stat>

              {/* The markup applies to whatever a unit cost us, and units cost different amounts —
                  so what another team pays is a range too, derived from the same spread rather than
                  from an average nobody is charged. */}
              <Stat
                label={t("products.detail.crossPrice")}
                hint={t("products.detail.crossPriceHint")}
                testId="product-detail-cross-price"
              >
                <CrossPrice stock={stock} markupBps={product.crossMarkupBps} />
              </Stat>
            </SimpleGrid>

            <RefreshOverlay busy={layers.isFetching && !layers.isPending}>
              <Table.Root size="sm" data-testid="pd-price-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("products.detail.layer.unitCost")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("products.detail.layer.ready")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("products.detail.layer.value")}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">
                      {t("products.detail.layer.crossPrice")}
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {rows.map((layer, i) => (
                    <Table.Row key={i} data-testid={`pd-price-row-${i}`}>
                      <Table.Cell>
                        <LayerCost unitCost={layer.unitCost} costKnown={layer.costKnown} />
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {t("products.stat.pcs", { n: layer.onHand.toString() })}
                      </Table.Cell>
                      {/* An unknown layer's value is Unknown, never Rp 0 — the same rule the header
                          total follows by leaving it out entirely. */}
                      <Table.Cell textAlign="end">
                        {layer.costKnown ? formatRupiah(layer.amount) : "—"}
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {layer.costKnown
                          ? formatRupiah(
                              layer.unitCost +
                                (layer.unitCost * BigInt(product.crossMarkupBps)) / 10_000n,
                            )
                          : "—"}
                      </Table.Cell>
                    </Table.Row>
                  ))}

                  {rows.length === 0 && (
                    <Table.Row>
                      <Table.Cell colSpan={4} color="fg.muted" data-testid="pd-price-empty">
                        {t("products.detail.layerEmpty")}
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Root>
            </RefreshOverlay>

            {/* The value of every KNOWN-cost layer. Unknown layers are absent from it by design, and
                the table above shows them so the two can be read together rather than reconciled. */}
            <Flex justify="space-between" wrap="wrap" gap="card">
              <Text fontSize="sm" color="fg.muted" data-testid="pd-price-total">
                {t("products.detail.layerTotal", {
                  value: formatRupiah(layers.data?.totalValue ?? 0n),
                })}
              </Text>

              <Pagination
                count={layers.data?.totalItems ?? 0}
                pageSize={PAGE_SIZE}
                page={page}
                onPageChange={setPage}
              />
            </Flex>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Stack gap="0.5">
              <Text fontWeight="medium">{t("products.detail.crossHeading")}</Text>
              <Text fontSize="sm" color="fg.muted">
                {t("products.detail.crossHelp")}
              </Text>
            </Stack>

            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Stat
                label={t("products.field.crossMarkup")}
                hint={t("products.detail.crossMarkupHint")}
                testId="product-detail-markup"
              >
                <Badge colorPalette={product.crossMarkupBps > 0 ? "brand" : "gray"}>
                  {formatMarkup(product.crossMarkupBps)}
                </Badge>
              </Stat>

              {/* Editable in place, exactly as it is on the list — locking is a one-bit decision and
                  a dialog for it would be ceremony. An archived product is out of circulation
                  anyway, so the switch is dead there. */}
              <Stat
                label={t("products.table.locked")}
                hint={t("products.detail.lockedHint")}
                testId="product-detail-locked"
              >
                <Switch.Root
                  size="sm"
                  checked={product.crossLocked}
                  disabled={archived || lockPending}
                  colorPalette="brand"
                  data-testid={`pd-locked-${product.sku}`}
                  onCheckedChange={(e) => onToggleLocked(e.checked)}
                >
                  <Switch.HiddenInput aria-label={t("products.table.locked")} />
                  <Switch.Control />
                </Switch.Root>
              </Stat>
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
