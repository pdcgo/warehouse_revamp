import type { ReactNode } from "react";
import { Box, Flex, Icon, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

import { formatRupiah } from "../../lib/money";
import { SummaryCard, SummaryStrip } from "./SummaryCard";
import type { OrderSummaryRow } from "./stat";
import {
  summaryAtv,
  summaryMargin,
  summaryMarginPct,
  summarySpend,
  summaryUpt,
} from "./stat";

// THE SUMMARY ABOVE THE ORDER LIST — two strips, one per kind of tab (owner, 2026-09-30).
//
//   ALL STATUS   a card per pile: the total, then one per status — what each is worth, how many,
//                whether it is earning
//   A STATUS     that status's figures as cards: value, Tx, items, UPT, ATV, purchase value, margin
//
// ⚠ THIS REVERSES "NOTHING APPEARS OR DISAPPEARS WHEN THE TAB CHANGES" (owner: *"statistik untuk setiap
// status cuma ada di all status … kalau sudah masuk ke filter status … tampilkan statistiknya dengan
// nilai tx item dsb, jadi yang bawahnya bisa dihilangkan"*). The per-status breakdown answers "how do the
// piles compare", which only the All tab asks; once one status is chosen, the other eight cards were
// noise and the figures that mattered sat on a small line underneath. That line is gone — on a status
// tab its measures ARE the cards.
//
// ⚠ IT SITS BELOW THE STATUS FILTER AND CONTROLS NOTHING (owner). No card navigates, filters or
// selects — the tab strip above is how a status is chosen, and this is what the choice looks like.
//
// ⚠ AND NO CARD IS HIGHLIGHTED (owner). Every card draws identically.
//
// ⚠ IT IS NOT A PROFIT STRIP. The furthest it goes is GROSS MARGIN — the goods minus what the goods
// cost. The warehouse fee, the courier and everything the marketplace deducts are all outside it,
// and the ones that only arrive weeks later belong to a report on a different clock, not to a work
// queue somebody is standing in front of right now.

export interface OrderSummaryProps {
  /** One row per status, in the order they should read — the caller passes the tab order. */
  rows: OrderSummaryRow[];
  /**
   * The chosen status. Omitted (or unknown) means All Status — the strip of piles; a known key means
   * that pile's own figures, as cards.
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

// The same seven every time, in the same order, so the eye learns where each sits.
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

export function OrderSummary({ rows, selectedKey, total, marks, badge }: OrderSummaryProps) {
  const { t } = useTranslation();

  // An unknown key and no key at all are the same state — All Status.
  const selected = rows.find((row) => row.key === selectedKey);

  return (
    <Box data-testid="order-summary" data-pile={selected?.key ?? "total"} minW="0" maxW="full">
      {marks && (
        // Right-aligned, above the figures — out of the reading path of the numbers themselves.
        <Flex gap="2" align="center" justify="flex-end" mb="2" data-testid="order-summary-marks">
          {marks}
        </Flex>
      )}

      {selected ? (
        // ONE STATUS: its figures, each a card. Which status is said by the tab directly above.
        <SummaryStrip testId="order-summary-measures">
          {MEASURES.map((measure) => (
            <SummaryCard
              key={measure.key}
              label={t(`orders.summary.${measure.key}`)}
              value={measure.render(selected)}
              testId={`order-summary-measure-${measure.key}`}
            />
          ))}
        </SummaryStrip>
      ) : (
        // ALL STATUS: the piles side by side. The total is a card like the others, in the position the
        // All tab has above.
        <SummaryStrip testId="order-summary-piles">
          <PileCard row={total} label={t("orders.summary.total")} testId="order-summary-total" />

          {rows.map((row) => (
            <PileCard key={row.key} row={row} badge={badge(row)} />
          ))}
        </SummaryStrip>
      )}

      <CostUnknownNote row={selected ?? total} />
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
function PileCard({
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

  // Two facts on the line. The margin is an em-dash rather than a percentage whenever nothing in this
  // pile has a recorded cost — and the whole line is one when the contract has no such status.
  return (
    <SummaryCard
      label={label}
      badge={badge}
      testId={testId ?? `order-summary-row-${row.key}`}
      muted={!row.onTheWire}
      value={row.onTheWire ? formatRupiah(row.value) : "—"}
      line={
        row.onTheWire ? (
          <>
            {t("orders.summary.cardLine", { count: row.count })}
            {" · "}
            {pct ?? "—"}
          </>
        ) : (
          t("orders.summary.notOnTheWire")
        )
      }
    />
  );
}
