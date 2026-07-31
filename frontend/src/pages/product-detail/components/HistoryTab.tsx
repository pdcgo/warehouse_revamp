import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Flex, Stack, Text } from "@chakra-ui/react";

import { Pagination } from "../../../components/Pagination";
import { RefreshOverlay } from "../../../components/RefreshOverlay";
import { MovementTable, type MovementRow } from "../../../features/inventory/MovementTable";
import { useOwnerStockHistory } from "../../../features/products/queries";
import { WarehouseFilter, WarehouseNote } from "./parts";

// The STOCK HISTORY tab — every movement of this product: what arrived, what shipped, what was
// counted, adjusted, damaged or found, newest first. The Batch tab says what the owner HAS; this says
// how it got that way, which is the tab somebody opens when a number looks wrong.
//
// The columns are deliberately NOT the warehouse's (#209/#232). That table carries a Place — the shelf
// a movement touched — because moving between two shelves is the warehouse's whole job. A catalogue
// owner does not care which rack; they care which BUILDING, because stock is held per warehouse and
// that is the unit their decisions are made in. So Place becomes Warehouse, and a shelf-to-shelf move
// inside one building never reaches this ledger at all.

const PAGE_SIZE = 20;

export function HistoryTab({
  teamId,
  productId,
  warehouseId,
  warehouseName,
  onWarehouseChange,
  warehouseLabel,
}: {
  teamId: bigint | undefined;
  productId: bigint;
  warehouseId: bigint;
  warehouseName?: string;
  onWarehouseChange: (id: bigint) => void;
  warehouseLabel: (id: bigint) => string;
}) {
  const { t } = useTranslation();

  const [page, setPage] = useState(1);

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

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Flex gap="card" align="flex-end" justify="space-between" wrap="wrap">
            <Stack gap="0.5">
              <Text fontWeight="medium">{t("products.detail.historyHeading")}</Text>
              <Text fontSize="sm" color="fg.muted">
                {t("products.detail.historyHelp")}
              </Text>
            </Stack>

            <WarehouseFilter
              value={warehouseId}
              onChange={(id) => {
                onWarehouseChange(id);
                setPage(1);
              }}
              testId="pd-history-warehouse-filter"
            />
          </Flex>

          <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

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
              warehouseLabel={warehouseLabel}
            />
          </RefreshOverlay>

          <Flex justify="flex-end">
            <Pagination
              count={history.data?.totalItems ?? 0}
              pageSize={PAGE_SIZE}
              page={page}
              onPageChange={setPage}
            />
          </Flex>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
