import type { ReactNode } from "react";
import { Box, Flex, Icon, SimpleGrid, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

import { formatRupiah } from "../../lib/money";
import type { OrderSummaryRow } from "./stat";
import {
  summaryAtv,
  summaryMargin,
  summaryMarginPct,
  summarySpend,
  summaryUpt,
} from "./stat";

// THE SUMMARY ABOVE THE ORDER LIST — BY STATUS FIRST (owner).
//
//   the CARD STRIP is always there and always the same: a total, then one card per status.
//   the MEASURE LINE under it follows the STATUS TAB above — the chosen status, or the total.
//
// ⚠ IT SITS BELOW THE STATUS FILTER AND CONTROLS NOTHING (owner). No card navigates, filters or
// selects — the tab strip above is how a status is chosen, and this is what the choice looks like.
// Two controls doing one job is exactly what an earlier version of this had: pressable cards over a
// tab strip that already did the same thing.
//
// ⚠ AND NO CARD IS HIGHLIGHTED (owner). Every card draws identically. The ACTIVE TAB is directly
// above the strip and already says which pile the measure line belongs to — marking the card as well
// says it twice, and a highlight on something that cannot be pressed reads as a control anyway.
//
// ⚠ NOTHING APPEARS OR DISAPPEARS WHEN THE TAB CHANGES (owner). Only the measure line's numbers do.
// This replaced a design where "All Status" and a filtered status were two different layouts — cards
// with borders against borderless text, different heights, different information — so switching tabs
// redrew the whole top of the screen instead of updating it. Each element now keeps ONE meaning: a
// card is a pile of orders, the line under it is what the chosen pile is made of.
//
// ⚠ NOT A TABLE, AND THE FIRST ATTEMPT WAS ONE (owner). It was argued from "the eye can run down a
// column and compare statuses", which is true and was outweighed twice over: this screen ALREADY
// ends in a table, so a second grid of rows directly above it reads as orders you can open — and it
// spent the top of a WORK screen on forty-two numbers before anybody reached the work.
//
// ⚠ IT IS NOT A PROFIT STRIP. The furthest it goes is GROSS MARGIN — the goods minus what the goods
// cost. The warehouse fee, the courier and everything the marketplace deducts are all outside it,
// and the ones that only arrive weeks later belong to a report on a different clock, not to a work
// queue somebody is standing in front of right now.

export interface OrderSummaryProps {
  /** One row per status, in the order they should read — the caller passes the tab order. */
  rows: OrderSummaryRow[];
  /**
   * Which row's figures the measure line carries. Omitted (or unknown) means the total.
   *
   * ⚠ A ROW KEY, NOT A PROTO STATUS. This strip is drawn over the SCREEN's vocabulary — the owner's
   * eight stages, not the contract's six enum values — so it never learns either set by name.
   */
  selectedKey?: string;
  /** The summed row, drawn as the first card. */
  total: OrderSummaryRow;
  /**
   * The badge that names one row. Supplied by the caller because naming and colouring a pile is the
   * SCREEN's vocabulary, and `features/` must not grow a second table of order-status colours to do
   * it. The total gets a plain label instead and never reaches this.
   */
  badge: (row: OrderSummaryRow) => ReactNode;
  /**
   * Build-status marks, above the figures.
   *
   * A slot rather than a prop the component understands: which figures are wired is a fact about the
   * SCREEN, not about this strip, and `features/` must not import a page's pending registry to find
   * it out. The caller passes badges; this only decides where they sit.
   */
  marks?: ReactNode;
}

// One measure, rendered the same way wherever it lands.
interface Measure {
  key: string;
  render: (row: OrderSummaryRow) => ReactNode;
}

// An em-dash, never a 0 — see the null contract on `OrderSummaryRow`. A confident zero in a cost
// column is the difference between "we spent nothing" and "nobody has told us yet".
function unknown(): ReactNode {
  return (
    <Text as="span" color="fg.subtle">
      —
    </Text>
  );
}

function decimal(value: number | null): ReactNode {
  return value === null ? unknown() : value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function rupiah(value: bigint | null): ReactNode {
  return value === null ? unknown() : formatRupiah(value);
}

function pctText(pct: number | null): string | null {
  return pct === null ? null : `${pct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

// ⚠ `value` IS IN HERE even though the line below leaves it out — the card's big number IS that
// measure, rendered larger. Dropping it from the array would leave the card's headline as a figure
// with no definition beside the others.
const MEASURES: Measure[] = [
  // ⚠ `onTheWire` GATES THE COUNT AND THE VALUE TOO. A pile the contract has no status for sums to
  // zero, and printing that zero claims "no orders are completed" — which is not something a
  // contract with no `completed` in it can say. Same rule as a cogs of 0, one level up.
  { key: "value", render: (row) => rupiah(row.onTheWire ? row.value : null) },
  { key: "tx", render: (row) => (row.onTheWire ? row.count.toLocaleString("id-ID") : unknown()) },
  { key: "items", render: (row) => decimal(row.onTheWire ? row.itemCount : null) },
  // Units per transaction — the fraction IS the measure, so this one keeps a decimal.
  { key: "upt", render: (row) => decimal(summaryUpt(row)) },
  { key: "atv", render: (row) => rupiah(summaryAtv(row)) },
  // ⚠ Same refusal as the margin: with nothing priced, the 0 is an absence, not an amount.
  // ⚠ `summarySpend`, NOT `row.cogs` — nilai belanja is total beli: the goods' cost PLUS the
  // fulfilment fees. It is the same figure the table's `Beli` cell shows per order, so the strip and
  // the rows mean the same thing by the same word. Same refusal as the margin: with nothing priced,
  // the 0 is an absence and not an amount.
  { key: "spend", render: (row) => rupiah(summarySpend(row)) },
  {
    key: "margin",
    render: (row) => {
      const margin = summaryMargin(row);
      const pct = pctText(summaryMarginPct(row));

      if (margin === null) {
        return unknown();
      }

      return (
        <>
          {formatRupiah(margin)}
          {/* The percentage rides with the amount rather than standing as its own measure: the two
              are one fact read together. */}
          {pct !== null && (
            <Text as="span" fontSize="xs" color="fg.muted" ms="1.5">
              {pct}
            </Text>
          )}
        </>
      );
    },
  },
];

// WHAT THE MARGIN IS ACTUALLY OVER, said plainly whenever it is not over everything.
//
// ⚠ A COGS OF 0 MEANS UNKNOWN, NOT FREE (`order.proto`) — an order whose goods were never restocked
// through this system has no recorded cost. Summing those rows as zero makes the margin read HIGH
// and nothing else on the screen would say so. This line is the marker that used to be `cost_known`,
// deleted along with revenue_service and needed again the moment a margin came back.
function CostUnknownNote({ row }: { row: OrderSummaryRow }) {
  const { t } = useTranslation();

  if (row.marginUnknown === null || row.marginUnknown === 0) {
    return null;
  }

  return (
    <Flex gap="2" align="center" mt="2" data-testid="order-summary-cost-unknown">
      <Icon as={Info} boxSize="4" color="fg.muted" flexShrink="0" />
      <Text fontSize="xs" color="fg.muted">
        {/* ⚠ TWO SENTENCES, because "the margin is taken over the rest" is nonsense when there is no
            rest. A pile where nothing is priced says so outright rather than pointing at a figure
            that is an em-dash a line above it. */}
        {row.marginUnknown >= row.count
          ? t("orders.summary.costNone", { count: row.count, total: row.count })
          : t("orders.summary.marginUnknown", { count: row.marginUnknown, total: row.count })}
      </Text>
    </Flex>
  );
}

// WHAT THE SELECTED PILE IS MADE OF — the same six every time, in the same order, so the eye learns
// where each sits and stops reading the labels.
//
// `value` is left out because the card above is already showing it, larger. Everything else has no
// other home on this strip.
function MeasureLine({ row }: { row: OrderSummaryRow }) {
  const { t } = useTranslation();

  return (
    <Flex
      gap="card"
      rowGap="2"
      wrap="wrap"
      align="baseline"
      mt="card"
      data-testid="order-summary-measures"
    >
      {MEASURES.filter((measure) => measure.key !== "value").map((measure) => (
        <Flex
          key={measure.key}
          gap="1.5"
          align="baseline"
          minW="0"
          data-testid={`order-summary-measure-${measure.key}`}
        >
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
            {t(`orders.summary.${measure.key}`)}
          </Text>
          <Text fontSize="sm" fontWeight="bold" whiteSpace="nowrap">
            {measure.render(row)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

export function OrderSummary({ rows, selectedKey, total, marks, badge }: OrderSummaryProps) {
  const { t } = useTranslation();

  // An unknown key and no key at all are the same state — the line carries the total.
  const shown = rows.find((row) => row.key === selectedKey) ?? total;

  return (
    <Box data-testid="order-summary" data-pile={shown.key} minW="0" maxW="full">
      {marks && (
        // Right-aligned, above the figures — out of the reading path of the numbers themselves.
        <Flex gap="2" align="center" justify="flex-end" mb="2" data-testid="order-summary-marks">
          {marks}
        </Flex>
      )}

      {/* ⚠ FITTED, NOT COUNTED. A fixed column count was right while the strip held seven cards and
          wrong the moment it held nine — two stragglers on a second row read as a different group.
          The caller decides how many piles there are, so the grid has to follow rather than assume. */}
      <SimpleGrid minChildWidth="8.5rem" gap="3">
        {/* The total is a card like the others — the "All Status" tab's pile, in the position the
            tab has above. */}
        <SummaryCard row={total} label={t("orders.summary.total")} testId="order-summary-total" />

        {rows.map((row) => (
          <SummaryCard key={row.key} row={row} badge={badge(row)} />
        ))}
      </SimpleGrid>

      <MeasureLine row={shown} />
      <CostUnknownNote row={shown} />
    </Box>
  );
}

// One pile, at a glance: what it is worth, how many orders, and whether it is earning.
//
// The money leads because it is the only figure that differs by an order of magnitude between
// statuses — the counts are all single digits, so they tell two piles apart far less well.
//
// ⚠ A CARD IS NOT A CONTROL (owner). It does not navigate, filter or select: the status tab above
// the strip already does that, and a second control for one job is what this deliberately is not.
function SummaryCard({
  row,
  label,
  badge,
  testId,
}: {
  row: OrderSummaryRow;
  /** Given instead of a badge — the total is not a status. */
  label?: string;
  badge?: ReactNode;
  /** The total carries its own id: its `status` is UNSPECIFIED, which is not a status to name. */
  testId?: string;
}) {
  const { t } = useTranslation();
  const pct = pctText(summaryMarginPct(row));

  return (
    <Box
      borderWidth="1px"
      // ⚠ EVERY CARD DRAWS THE SAME (owner) — no card is singled out for the tab that is active. The
      // tab strip sits directly above and already says which one, and a highlight on something that
      // cannot be pressed reads as a control that is broken.
      borderColor="border"
      bg="bg.subtle"
      borderRadius="l2"
      px="3"
      py="2.5"
      minW="0"
      data-testid={testId ?? `order-summary-row-${row.key}`}
    >
      {label ? (
        <Text fontSize="xs" fontWeight="bold" color="fg.label">
          {label}
        </Text>
      ) : (
        badge
      )}

      <Text
        fontSize="md"
        fontWeight="bold"
        mt="1.5"
        lineClamp={1}
        color={row.onTheWire ? undefined : "fg.subtle"}
      >
        {row.onTheWire ? formatRupiah(row.value) : "—"}
      </Text>

      {/* Two facts on one line. The margin is an em-dash rather than a percentage whenever nothing
          in this pile has a recorded cost — and the whole line is one when the contract has no such
          status to count in the first place. */}
      <Text fontSize="xs" color="fg.muted">
        {row.onTheWire ? (
          <>
            {t("orders.summary.cardLine", { count: row.count })}
            {" · "}
            {pct ?? "—"}
          </>
        ) : (
          t("orders.summary.notOnTheWire")
        )}
      </Text>
    </Box>
  );
}
