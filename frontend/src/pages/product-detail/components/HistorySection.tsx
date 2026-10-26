import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Stack, Text } from "@chakra-ui/react";
import { History } from "lucide-react";

import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { MovementTable, type MovementRow } from "../../../features/inventory/MovementTable";
import { useOwnerStockHistory } from "../../../features/products/queries";

// The STOCK HISTORY section — every movement of this product: what arrived, what shipped, what was
// counted, adjusted, damaged or found, newest first. The Batch section says what the owner HAS; this says
// how it got that way, which is the section somebody reads when a number looks wrong. Its card, title and the
// warehouse lens are the page's (the-product-page-is-one-page-of-sections).
//
// The columns are deliberately NOT the warehouse's (#209/#232). That table carries a Place — the shelf
// a movement touched — because moving between two shelves is the warehouse's whole job. A catalogue
// owner does not care which rack; they care which BUILDING, because stock is held per warehouse and
// that is the unit their decisions are made in. So Place becomes Warehouse, and a shelf-to-shelf move
// inside one building never reaches this ledger at all.

const PAGE_SIZE = 20;

export function HistorySection({
  teamId,
  productId,
  warehouseId,
  warehouseLabel,
}: {
  teamId: bigint | undefined;
  productId: bigint;
  /** The page's warehouse lens — 0n is everywhere. */
  warehouseId: bigint;
  warehouseLabel: (id: bigint) => string;
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

  const history = useOwnerStockHistory({ teamId, productId, warehouseId, page, pageSize: PAGE_SIZE });

  // OwnerMovement → the shared ledger's row shape. `rackId` is left undefined on purpose rather than
  // sent as 0: this ledger genuinely has no shelves in it, and a 0 would render as the unplaced pile.
  const rows = useMemo<MovementRow[]>(
    () =>
      (history.data?.movements ?? []).map((m) => ({
        id: m.id,
        createdAt: new Date(Number(m.createdAtUnix) * 1000).toISOString(),
        kind: m.kind,
        delta: m.delta,
        balance: m.balance,
        actorUserId: m.actorUserId,
        batchId: m.batchId,
        productId: m.productId,
        warehouseId: m.warehouseId,
      })),
    [history.data],
  );

  // ON PAGE 1, A LIST THAT FITS HAS NO PAGER (`a-short-section-hides-its-pager`, then owner: *"yang masih ada di riwayat
  // stok"*) — the rule Price and Batch already follow. From page 2 on it always shows, so the way back is never lost.
  const fits = page === 1 && (history.data?.totalItems ?? 0) <= PAGE_SIZE;

  return (
        <Stack gap="card">
          <Text fontSize="sm" color="fg.muted">
            {t("products.detail.historyHelp")}
          </Text>

          <RefreshOverlay busy={history.isFetching && !history.isPending}>
            <MovementTable
              movements={rows}
              testId="pd-history"
              columns={["warehouse", "batch"]}
              // WHAT THIS BALANCE IS, said in the header rather than assumed: the owner's on-hand of
              // this product IN THAT BUILDING. Never the pair's total — two warehouses are two
              // histories that happen to be read together, and no order was ever filled from a sum
              // across cities.
              afterLabel={t("products.detail.history.afterInWarehouse")}
              emptyText={t("products.detail.historyEmpty")}
              // The empty hint and the lit rows (an-empty-list-shows-a-hint, a-table-row-lights-up).
              emptyIcon={History}
              emptyDescription={
                warehouseId > 0n ? t("products.detail.emptyInWarehouse") : t("products.detail.historyEmptyHint")
              }
              warehouseLabel={warehouseLabel}
            />
          </RefreshOverlay>

          {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager) — and only when there is
              more than one page to open (a-short-section-hides-its-pager). */}
          {!fits && (
            <Flex justify="flex-end">
              <GrowingPager
                page={page}
                onPageChange={setPage}
                hasNext={history.isPlaceholderData ? undefined : page * PAGE_SIZE < (history.data?.totalItems ?? 0)}
                resetKey={warehouseId.toString()}
                pageSize={PAGE_SIZE}
                testId="pd-history-pager"
              />
            </Flex>
          )}
        </Stack>
  );
}
