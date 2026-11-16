import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Flex, HStack, Icon, Stack, Table, Text } from "@chakra-ui/react";
import { PackageOpen, Tag } from "lucide-react";

import { GrowingPager } from "../../../components/chrome/GrowingPager";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { RefreshOverlay } from "../../../components/feedback/RefreshOverlay";
import { useOwnerBatches } from "../../../features/products/queries";
import { ExpiryCell } from "../../../features/inventory/ExpiryCell";
import { CorrectPriceDialog } from "../../../features/inventory/CorrectPriceDialog";
import { canCorrectPrice } from "../../../features/inventory/priceChange";
import { useTeam } from "../../../features/team/TeamContext";
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

/**
 * THE BATCH SECTION'S CARD AT ITS NARROWEST — its table's min-content width in the widest language (English: Delivery /
 * Warehouse / Arrived / Expiring / Unit cost / Ready / Value and the row's Koreksi Harga menu, 651px; Indonesian 607px)
 * plus the card's padding and border (50px), measured on the widest fixture (Minyak Goreng's three batches, 2026-11-15).
 * The product page stands its side cards beside the main column only when the page area holds this + the gap + the side
 * column (the-product-pages-side-cards-stack-when-narrow): at 1440 with the sidebar open they go below.
 */
export const BATCH_SECTION_FLOOR_PX = 701;

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

  // KOREKSI HARGA (the-correct-price-prototype-is-accepted) — the owning team reaches its batches HERE (a batch's own page
  // is the warehouse's), so each row offers it to its Owner and Admin, Root and the Administrator
  // (the-owning-team-revalues-with-a-reason): a column on desktop, the foot of each block on a phone. A CS or a monitor
  // reads the rows only.
  const { current } = useTeam();
  const correctable = canCorrectPrice(current);
  const [correcting, setCorrecting] = useState<OwnerBatchRow | null>(null);
  const correctButton = (b: OwnerBatchRow) =>
    correctable && b.costKnown ? (
      <Button size="xs" variant="outline" data-testid={`pd-batch-correct-${b.id}`} onClick={() => setCorrecting(b)}>
        <Icon as={Tag} boxSize="4" />
        {t("correctPrice.action")}
      </Button>
    ) : null;

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
              {/* The day it arrived, and when it expires on the same line, as the batch list's block foot — EACH BATCH'S
                  EXPIRY for the team that marks them down (the-expiry-report-is-the-batch-list), read as the batch screens
                  read it (an-expiry-says-how-long-is-left). A batch with none says nothing more. */}
              <HStack justify="space-between" gap="2" fontSize="sm" color="fg.muted">
                <Text>{formatUnixDate(b.createdAtUnix)}</Text>
                {b.expiresOnUnix > 0n && (
                  <Text textAlign="end" data-testid={`pd-batch-expiry-line-${b.id}`}>
                    {t("batches.colExpiring")}{" "}
                    <ExpiryCell inline fontSize="sm" unix={b.expiresOnUnix} testId={`pd-batch-expiry-${b.id}`} />
                  </Text>
                )}
              </HStack>
              <HStack justify="space-between" gap="2" fontSize="sm">
                <Text>
                  {t("products.stat.pcs", { n: b.ready.toString() })} × {unitCost(b)}
                </Text>
                <Text fontWeight="medium">{value(b)}</Text>
              </HStack>
              {correctable && b.costKnown && <Flex justify="end">{correctButton(b)}</Flex>}
            </Stack>
          ))}
        </Stack>
      );
    }

    const table = (
      <Table.Root size="sm" data-testid="pd-batch-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("products.detail.batch.delivery")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("products.detail.batch.warehouse")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("products.detail.batch.arrivedOn")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("batches.colExpiring")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("products.detail.batch.unitCost")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("products.detail.batch.ready")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("products.detail.batch.value")}</Table.ColumnHeader>
            {correctable && <Table.ColumnHeader aria-label={t("correctPrice.actionsColumn")} />}
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
              {/* KEDALUWARSA beside Tiba: the day, how long is left under it (amber within 30 days, red once past), a dash
                  for none — the batch list's own cell. */}
              <Table.Cell>
                <ExpiryCell unix={b.expiresOnUnix} testId={`pd-batch-expiry-${b.id}`} />
              </Table.Cell>
              <Table.Cell textAlign="end">{unitCost(b)}</Table.Cell>
              <Table.Cell textAlign="end">{t("products.stat.pcs", { n: b.ready.toString() })}</Table.Cell>
              <Table.Cell textAlign="end">{value(b)}</Table.Cell>
              {correctable && (
                <Table.Cell textAlign="end" whiteSpace="nowrap">
                  {correctButton(b)}
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );

    // The page puts its side cards below whenever the main column cannot hold this table at its narrowest
    // (the-product-pages-side-cards-stack-when-narrow, `BATCH_SECTION_FLOOR_PX`), so at a desktop width it never scrolls;
    // the box keeps a narrower window (a tablet) scrolling inside the card rather than running past it.
    return (
      <Box overflowX="auto" maxW="full" minW="0" data-testid="pd-batch-scroll">
        {table}
      </Box>
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

          {correcting && teamId !== undefined && (
            <CorrectPriceDialog
              open
              onOpenChange={(open) => !open && setCorrecting(null)}
              batch={{
                id: correcting.id,
                teamId,
                warehouseId: correcting.warehouseId,
                warehouseName: warehouseLabel(correcting.warehouseId),
                productName: correcting.name,
                units: correcting.ready,
                price: correcting.unitCost,
                value: correcting.readyValue,
              }}
            />
          )}
        </Stack>
  );
}
