import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, HStack, Stack, Table, Text } from "@chakra-ui/react";
import { PackageOpen } from "lucide-react";

import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { useOwnerBatches } from "../../../features/products/queries";
import type { StockBatch as OwnerBatchRow } from "../../../gen/warehouse/inventory/v1/inventory_pb";
import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDate } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";
import { LIGHTS_UP } from "./parts";

// The BATCH section — one product's units from one delivery, each with its own frozen cost. Its card and title are the
// page's (the-product-page-is-one-page-of-sections).
//
// ⚠ EVERY WAREHOUSE, ALWAYS — never read through the page's warehouse picker (owner: *"karena batch datanya semua
// gudang, tidak perlu difilter"*, `the-warehouse-picker-splits-the-page`). It is where the product came from, and each
// row already names its warehouse; it sits above the picker for that reason.
//
// This is where "how much do I have, and where" is actually answered for a catalogue owner. Stock is
// held per warehouse and a batch names which one, so the WAREHOUSE is a column on every row rather
// than something the lens has to be set to discover: with the lens open this list spans every building
// holding the goods, which is the shape a selling team's purchases actually have.

const PAGE_SIZE = 20;

export function BatchSection({
  teamId,
  productId,
  warehouseLabel,
}: {
  teamId: bigint | undefined;
  productId: bigint;
  warehouseLabel: (id: bigint) => string;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [page, setPage] = useState(1);

  const batches = useOwnerBatches({ teamId, productId, warehouseId: 0n, page, pageSize: PAGE_SIZE });
  const rows = batches.data?.batches ?? [];

  // ON PAGE 1, A LIST THAT FITS HAS NO PAGER (owner: *"harga modal dan batch tidak ada paginasi kalau jumlah datanya kurang
  // dari limit, di halaman 1 ya"*, `a-short-section-hides-its-pager`) — inside a section of the product's page, "1" and
  // two dead arrows under three rows are furniture. From page 2 on it always shows, so the way back is never lost.
  const fits = page === 1 && (batches.data?.totalItems ?? 0) <= PAGE_SIZE;

  // Unknown cost is Unknown, never Rp 0 (#74) — and the value goes with it.
  const unitCost = (b: OwnerBatchRow) =>
    b.costKnown ? (
      formatRupiah(b.unitCost)
    ) : (
      <Text as="span" color="fg.muted">
        {t("products.detail.layer.unknown")}
      </Text>
    );
  const value = (b: OwnerBatchRow) => (b.costKnown ? formatRupiah(b.readyValue) : "—");

  function list() {
    if (rows.length === 0) {
      // AN EMPTY LIST SAYS WHY (an-empty-list-shows-a-hint) — `sm`, inside the tab's card.
      return (
        <EmptyHint
          size="sm"
          icon={PackageOpen}
          title={t("products.detail.batchEmpty")}
          description={t("products.detail.batchEmptyHint")}
          testId="pd-batch-empty"
        />
      );
    }

    if (isMobile) {
      // A PHONE READS EACH DELIVERY AS A BLOCK (a-phone-reads-each-line-as-a-block) — the delivery and its warehouse,
      // the day it arrived, then the arithmetic as a line: ready × unit cost … what it is worth.
      return (
        <Stack gap="2" data-testid="pd-batch-table">
          {rows.map((b) => (
            <Stack key={b.id.toString()} data-testid={`pd-batch-row-${b.id}`} borderWidth="1px" borderRadius="md" p="3" gap="1">
              <HStack justify="space-between" gap="2">
                <Text fontWeight="bold">#{b.deliveryId.toString()}</Text>
                <Text fontSize="sm" color="fg.muted" truncate>
                  {warehouseLabel(b.warehouseId)}
                </Text>
              </HStack>
              <Text fontSize="sm" color="fg.muted">
                {formatUnixDate(b.createdAtUnix)}
              </Text>
              <HStack justify="space-between" gap="2" fontSize="sm">
                <Text>
                  {t("products.stat.pcs", { n: b.ready.toString() })} × {unitCost(b)}
                </Text>
                <Text fontWeight="medium">{value(b)}</Text>
              </HStack>
            </Stack>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="pd-batch-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("products.detail.batch.delivery")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("products.detail.batch.warehouse")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("products.detail.batch.arrivedOn")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("products.detail.batch.unitCost")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("products.detail.batch.ready")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("products.detail.batch.value")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((b) => (
            <Table.Row key={b.id.toString()} data-testid={`pd-batch-row-${b.id}`} css={LIGHTS_UP}>
              {/* The DELIVERY, not the batch — the number on the receipt is what the owner has a record of, and the
                  batch id is an internal handle for the same event. */}
              <Table.Cell>#{b.deliveryId.toString()}</Table.Cell>
              <Table.Cell>{warehouseLabel(b.warehouseId)}</Table.Cell>
              <Table.Cell>{formatUnixDate(b.createdAtUnix)}</Table.Cell>
              <Table.Cell textAlign="end">{unitCost(b)}</Table.Cell>
              <Table.Cell textAlign="end">{t("products.stat.pcs", { n: b.ready.toString() })}</Table.Cell>
              <Table.Cell textAlign="end">{value(b)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
        <Stack gap="card">
          <Text fontSize="sm" color="fg.muted">
            {t("products.detail.batchHelp")}
          </Text>

          <RefreshOverlay busy={batches.isFetching && !batches.isPending}>{list()}</RefreshOverlay>

          <Flex justify="space-between" align="center" wrap="wrap" gap="card">
            <Text fontSize="sm" color="fg.muted" data-testid="pd-batch-total">
              {t("products.detail.batchTotal", {
                value: formatRupiah(batches.data?.readyValueTotal ?? 0n),
              })}
            </Text>

            {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager) — and only when there is
                more than one page to open (a-short-section-hides-its-pager). */}
            {!fits && (
              <GrowingPager
                page={page}
                onPageChange={setPage}
                hasNext={batches.isPlaceholderData ? undefined : page * PAGE_SIZE < (batches.data?.totalItems ?? 0)}
                resetKey="all"
                pageSize={PAGE_SIZE}
                testId="pd-batch-pager"
              />
            )}
          </Flex>
        </Stack>
  );
}
