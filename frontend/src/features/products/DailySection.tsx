import { useTranslation } from "react-i18next";
import { HStack, Spinner, Stack, Table, Text } from "@chakra-ui/react";

import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDate } from "../../lib/datetime";
import { jakartaDayStartUnix } from "../../lib/jakartaDay";
import type { DailyRow } from "./adapt";
import { useProductDailyMoves } from "./queries";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// KELUAR MASUK HARIAN — per day: what came in, what went out, and what was on hand at the end of it. The read for "how
// fast does this go" that the movement list answers only by counting. The chosen warehouse's, under its tab
// (the-warehouse-zone-is-tabs: *"the last fourteen days: date, in, out, on hand"*) — on the product's own page and its
// discover detail alike (the-discover-detail-has-the-warehouse-zone), ONE component so the two say the same days.
//
// REAL since 2026-11-21: InventoryService.ProductDailyMoves sums the daily fold every stock change writes, per Jakarta
// day, in the page's WAREHOUSE PICKER (the-warehouse-picker-splits-the-page), Sisa read back from today's stock. Units
// only, whoever reads (stock-history-is-everyones). ⚠ Which movements are Masuk and which Keluar is the owner's open
// question (HELD): the server draws every movement by its direction, so each day's Sisa = the day before's + Masuk −
// Keluar. Mounted only while its tab is open, so the days are read only then.
export function DailySection({
  teamId,
  productId,
  warehouseId,
}: {
  teamId: bigint | undefined;
  productId: bigint;
  /** The page's warehouse lens — 0n is every warehouse. */
  warehouseId: bigint;
}) {
  const moves = useProductDailyMoves({ teamId, productId, warehouseId });

  if (moves.isPending) {
    return <Spinner colorPalette="brand" size="sm" />;
  }

  return (
    <RefreshOverlay busy={moves.isFetching && !moves.isPending}>
      <DailyTable days={moves.data ?? []} />
    </RefreshOverlay>
  );
}

/** The fourteen days as the tab draws them, today first — a table on a desktop, a line per day on a phone. */
export function DailyTable({ days }: { days: DailyRow[] }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const pcs = (n: bigint) => t("products.stat.pcs", { n: n.toString() });
  const dateOf = (d: DailyRow) => formatUnixDate(jakartaDayStartUnix(d.day));

  if (isMobile) {
    // A PHONE READS EACH DAY AS A LINE — the date, then in and out and what was left.
    return (
      <Stack gap="0" data-testid="pd-daily-table">
        {days.map((d, i) => (
          <HStack
            key={d.day}
            justify="space-between"
            py="2"
            borderBottomWidth="1px"
            borderColor="border.muted"
            fontSize="sm"
            data-testid={`pd-daily-row-${i}`}
            data-day={d.day}
          >
            <Text>{dateOf(d)}</Text>
            <HStack gap="3">
              <Text color={d.inQty > 0n ? "success.fg" : "fg.subtle"} data-testid={`pd-daily-in-${i}`}>
                +{d.inQty.toString()}
              </Text>
              <Text color={d.outQty > 0n ? "error.fg" : "fg.subtle"} data-testid={`pd-daily-out-${i}`}>
                −{d.outQty.toString()}
              </Text>
              <Text fontWeight="bold" minW="16" textAlign="end" data-testid={`pd-daily-balance-${i}`}>
                {pcs(d.onHand)}
              </Text>
            </HStack>
          </HStack>
        ))}
      </Stack>
    );
  }

  return (
    <Table.Root size="sm" data-testid="pd-daily-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("products.detail.daily.date")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.daily.in")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.daily.out")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.daily.balance")}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {days.map((d, i) => (
          <Table.Row key={d.day} css={LIGHTS_UP} data-testid={`pd-daily-row-${i}`} data-day={d.day}>
            <Table.Cell>{dateOf(d)}</Table.Cell>
            <Table.Cell textAlign="end" color={d.inQty > 0n ? "success.fg" : "fg.subtle"} data-testid={`pd-daily-in-${i}`}>
              {d.inQty > 0n ? `+${pcs(d.inQty)}` : "—"}
            </Table.Cell>
            <Table.Cell textAlign="end" color={d.outQty > 0n ? "error.fg" : "fg.subtle"} data-testid={`pd-daily-out-${i}`}>
              {d.outQty > 0n ? `−${pcs(d.outQty)}` : "—"}
            </Table.Cell>
            <Table.Cell textAlign="end" fontWeight="bold" data-testid={`pd-daily-balance-${i}`}>
              {pcs(d.onHand)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
