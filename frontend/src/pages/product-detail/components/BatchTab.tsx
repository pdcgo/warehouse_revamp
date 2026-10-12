import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Flex, Stack, Table, Text } from "@chakra-ui/react";

import { Pagination } from "../../../components/chrome/Pagination";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { useOwnerBatches } from "../../../features/products/queries";
import { formatUnixDate } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";
import { WarehouseFilter, WarehouseNote } from "./parts";

// The BATCH tab — one product's units from one delivery, each with its own frozen cost.
//
// This is where "how much do I have, and where" is actually answered for a catalogue owner. Stock is
// held per warehouse and a batch names which one, so the WAREHOUSE is a column on every row rather
// than something the lens has to be set to discover: with the lens open this list spans every building
// holding the goods, which is the shape a selling team's purchases actually have.

const PAGE_SIZE = 20;

export function BatchTab({
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

  const batches = useOwnerBatches({ teamId, productId, warehouseId, page, pageSize: PAGE_SIZE });
  const rows = batches.data?.batches ?? [];

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Flex gap="card" align="flex-end" justify="space-between" wrap="wrap">
            <Stack gap="0.5">
              <Text fontWeight="medium">{t("products.detail.batchHeading")}</Text>
              <Text fontSize="sm" color="fg.muted">
                {t("products.detail.batchHelp")}
              </Text>
            </Stack>

            <WarehouseFilter
              value={warehouseId}
              onChange={(id) => {
                onWarehouseChange(id);
                setPage(1);
              }}
              testId="pd-batch-warehouse-filter"
            />
          </Flex>

          <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

          <RefreshOverlay busy={batches.isFetching && !batches.isPending}>
            <Table.Root size="sm" data-testid="pd-batch-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("products.detail.batch.delivery")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("products.detail.batch.warehouse")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("products.detail.batch.arrivedOn")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("products.detail.batch.unitCost")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("products.detail.batch.ready")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("products.detail.batch.value")}
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((b) => (
                  <Table.Row key={b.id.toString()} data-testid={`pd-batch-row-${b.id}`}>
                    {/* The DELIVERY, not the batch — the number on the receipt is what the owner
                        has a record of, and the batch id is an internal handle for the same event. */}
                    <Table.Cell>#{b.deliveryId.toString()}</Table.Cell>
                    <Table.Cell>{warehouseLabel(b.warehouseId)}</Table.Cell>
                    <Table.Cell>{formatUnixDate(b.createdAtUnix)}</Table.Cell>
                    {/* Unknown cost is Unknown, never Rp 0 (#74) — and the value goes with it. */}
                    <Table.Cell textAlign="end">
                      {b.costKnown ? (
                        formatRupiah(b.unitCost)
                      ) : (
                        <Text as="span" color="fg.muted">
                          {t("products.detail.layer.unknown")}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      {t("products.stat.pcs", { n: b.ready.toString() })}
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      {b.costKnown ? formatRupiah(b.readyValue) : "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}

                {rows.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={6} color="fg.muted" data-testid="pd-batch-empty">
                      {t("products.detail.batchEmpty")}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </RefreshOverlay>

          <Flex justify="space-between" wrap="wrap" gap="card">
            <Text fontSize="sm" color="fg.muted" data-testid="pd-batch-total">
              {t("products.detail.batchTotal", {
                value: formatRupiah(batches.data?.readyValueTotal ?? 0n),
              })}
            </Text>

            <Pagination
              count={batches.data?.totalItems ?? 0}
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
