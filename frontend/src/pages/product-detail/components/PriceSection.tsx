import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Stack, Table, Text } from "@chakra-ui/react";
import { Layers } from "lucide-react";

import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { useOwnerCostLayers } from "../../../features/products/queries";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { formatRupiah } from "../../../lib/money";
import { LIGHTS_UP } from "./parts";

// The PRICE section — the batches GROUPED BY WHAT THEY COST. Its card, title and the warehouse lens are the page's
// (the-product-page-is-one-page-of-sections); this is what goes inside.
//
// A product has no selling price (what a buyer pays is set per order, on the shop that sells it), so
// the money it does have is what its units cost us — and that is not one number. The same product
// arrives at different prices, each delivery freezes its own, and every batch that froze the same cost
// is one COST LAYER. Grouping by price rather than listing deliveries is what makes "what is my stock
// worth, and at which prices" a question you can answer by looking.
//
// FIFO still draws the oldest batch; this view is about value, not about order. The Batch section is the
// per-delivery list.

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

export function PriceSection({
  teamId,
  product,
  warehouseId,
}: {
  teamId: bigint | undefined;
  product: Product;
  /** The page's warehouse lens — 0n is everywhere. */
  warehouseId: bigint;
}) {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);

  // A NEW LENS IS A NEW SET OF ROWS, so page 2 of the old one means nothing — the page's warehouse picker changed it,
  // and the section starts again at page 1 (state adjusted during render, React's own pattern for a prop that resets it).
  const [lens, setLens] = useState(warehouseId);
  if (lens !== warehouseId) {
    setLens(warehouseId);
    setPage(1);
  }

  const layers = useOwnerCostLayers({
    teamId,
    productId: product.id,
    warehouseId,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = layers.data?.layers ?? [];

  // ON PAGE 1, A LIST THAT FITS HAS NO PAGER (owner: *"harga modal dan batch tidak ada paginasi kalau jumlah datanya kurang
  // dari limit, di halaman 1 ya"*, `a-short-section-hides-its-pager`) — inside a section of the product's page, "1" and
  // two dead arrows under three rows are furniture. From page 2 on it always shows, so the way back is never lost.
  const fits = page === 1 && (layers.data?.totalItems ?? 0) <= PAGE_SIZE;

  return (
          <Stack gap="card">
            {/* NO FIGURES ABOVE THE TABLE (owner: *"harga modal pun yang di atas kayak kurang, atau gausah dikasih aja"*) —
                the cost range and the cross price are said by Info and the Overview; this tab is the layers. */}
            <Text fontSize="sm" color="fg.muted">
              {t("products.detail.costHelp")}
            </Text>

            <RefreshOverlay busy={layers.isFetching && !layers.isPending}>
              {rows.length === 0 ? (
                // AN EMPTY LIST SAYS WHY (an-empty-list-shows-a-hint) — `sm`, inside the tab's card.
                <EmptyHint
                  size="sm"
                  icon={Layers}
                  title={t("products.detail.layerEmpty")}
                  description={
                    warehouseId > 0n ? t("products.detail.emptyInWarehouse") : t("products.detail.layerEmptyHint")
                  }
                  testId="pd-price-empty"
                />
              ) : (
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
                    <Table.Row key={i} data-testid={`pd-price-row-${i}`} css={LIGHTS_UP}>
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
                </Table.Body>
              </Table.Root>
              )}
            </RefreshOverlay>

            {/* The value of every KNOWN-cost layer. Unknown layers are absent from it by design, and
                the table above shows them so the two can be read together rather than reconciled. */}
            <Flex justify="space-between" align="center" wrap="wrap" gap="card">
              <Text fontSize="sm" color="fg.muted" data-testid="pd-price-total">
                {t("products.detail.layerTotal", {
                  value: formatRupiah(layers.data?.totalValue ?? 0n),
                })}
              </Text>

              {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager) — and only when there is
                  more than one page to open (a-short-section-hides-its-pager). */}
              {!fits && (
                <GrowingPager
                  page={page}
                  onPageChange={setPage}
                  hasNext={layers.isPlaceholderData ? undefined : page * PAGE_SIZE < (layers.data?.totalItems ?? 0)}
                  resetKey={warehouseId.toString()}
                  pageSize={PAGE_SIZE}
                  testId="pd-price-pager"
                />
              )}
            </Flex>
          </Stack>
  );
}
