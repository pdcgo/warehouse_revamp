import { useTranslation } from "react-i18next";
import { Icon, Table, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import type { ExpenseTotals } from "../../../gen/warehouse/expense/v1/expense_pb";
import type { LiabilityDailyTotals } from "../../../gen/warehouse/liability/v1/liability_pb";
import { LiabilitySourceType } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import { parseLocalDate } from "../../../lib/datetime";
import type { PeriodGrain } from "../../../lib/period";
import type { StatementMode, StatementRow } from "../queries";

export interface StatementTableProps {
  mode: StatementMode;
  grain: PeriodGrain;
  rows: StatementRow[];
  /** The period's income, from the server. */
  income: bigint;
  liability: LiabilityDailyTotals | undefined;
  expenses: ExpenseTotals | undefined;
}

// A bucket key → what the row is called, per grain.
//
//   day     `2026-08-14` → "Thu 14 Aug"   the WEEKDAY is the point of including it: a warehouse week
//                                         has a shape, and "the bad days are all Sundays" is a pattern
//                                         no date column alone will ever show
//   month   `2026-08`    → "Aug 2026"     the year is carried because a 12-month window crosses one
//   year    `2026`       → "2026"         already its own label
//
// The month label is built from the 1st of that month rather than parsed loosely: `parseLocalDate`
// wants a full date, and appending `-01` keeps this on the one date parser the app has.
function bucketLabel(bucket: string, grain: PeriodGrain, locale: string): string {
  if (grain === "year") return bucket;

  const d = parseLocalDate(grain === "month" ? `${bucket}-01` : bucket);
  if (!d) return bucket;

  return grain === "month"
    ? d.toLocaleDateString(locale, { month: "short", year: "numeric" })
    : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

// Zero renders as an em dash, not "Rp 0".
//
// A statement is mostly zeroes — nine columns times thirty days — and printed in full they crowd out the
// numbers that are actually there. The dash is the same glyph the rest of the app uses for "there is
// nothing here", so it needs no explaining.
function money(amount: bigint): string {
  return amount === 0n ? "—" : formatRupiah(amount);
}

// The statement itself — one row per bucket in the period, quiet ones included.
//
// TWO COLUMN SETS, ONE TABLE. A selling team reads its orders down to a margin; a warehouse reads the
// fees it charged and the stock it broke. The date, the expenses, the profit and the running total are
// identical in both, and those are the columns worth having exactly one copy of.
//
// THE GRAIN CHANGES THE FIRST COLUMN AND NOTHING ELSE. A month's row is the same nine numbers as a
// day's, so it gets the same nine columns — only its label and its header say which period it is. A
// separate monthly table would be a second place for the running total to be wrong.
//
// It scrolls HORIZONTALLY inside its own container rather than letting the page scroll sideways: this is
// eight or nine money columns, and on a phone at a shelf the alternative is a page whose heading slides
// off the screen when somebody swipes the numbers.
export function StatementTable({
  mode,
  grain,
  rows,
  income,
  liability,
  expenses,
}: StatementTableProps) {
  const { t, i18n } = useTranslation();

  const warehouse = mode === "warehouse";

  const spent = expenses?.total ?? 0n;
  const stockLoss = expenses?.byKind[ExpenseKind.STOCK_LOSS] ?? 0n;
  const codFees = liability?.bySource[LiabilitySourceType.COD_FEE] ?? 0n;

  if (rows.length === 0) {
    return (
      <Text color="fg.muted" data-testid="statement-empty">
        {t("statement.empty")}
      </Text>
    );
  }

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="statement-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t(`statement.table.bucket.${grain}`)}</Table.ColumnHeader>

            {warehouse ? (
              <>
                <Table.ColumnHeader textAlign="end">{t("statement.table.fees")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("statement.table.cod")}</Table.ColumnHeader>
              </>
            ) : (
              <>
                <Table.ColumnHeader textAlign="end">{t("statement.table.orders")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("statement.table.revenue")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("statement.table.cogs")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("statement.table.shipping")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("statement.table.margin")}</Table.ColumnHeader>
              </>
            )}

            {/* Stock loss gets its OWN column beside the rest of the spending, in both modes. It is a
                warehouse's number in practice — inventory posts it against the warehouse's team — but
                the column costs nothing where there is none, and hiding it would mean a selling team
                that somehow acquired one could never see it. */}
            <Table.ColumnHeader textAlign="end">{t("statement.table.stockLoss")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("statement.table.otherExpenses")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("statement.table.profit")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("statement.table.running")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {rows.map((row) => (
            <Table.Row
              key={row.bucket}
              data-testid={`statement-row-${row.bucket}`}
              data-quiet={row.active ? undefined : "true"}
              // A QUIET PERIOD IS DIMMED, NOT HIDDEN. It is still part of the period, and a reader has
              // to be able to tell "nothing happened on the 14th" from "the 14th did not load" — which
              // a missing row cannot say.
              opacity={row.active ? 1 : 0.5}
            >
              <Table.Cell whiteSpace="nowrap">{bucketLabel(row.bucket, grain, i18n.language)}</Table.Cell>

              {warehouse ? (
                <>
                  <Table.Cell textAlign="end">{money(row.income)}</Table.Cell>
                  {/* Muted, because it is NOT part of the profit to its right — a reimbursement of cash
                      the warehouse already handed a courier. The colour is the only thing on the row
                      saying "this one does not add up with the others". */}
                  <Table.Cell textAlign="end" color="fg.muted">
                    {money(row.codFees)}
                  </Table.Cell>
                </>
              ) : (
                <>
                  <Table.Cell textAlign="end">
                    {row.orders === 0 ? "—" : row.orders}
                    {/* WHICH ROW the unknown costs landed on — the reason this is per-row and not only a
                        period figure (#74). At the daily grain that points at a Tuesday, which is the
                        finest this can get; a monthly row can only say which month, and says so. */}
                    {row.unknownCostOrders > 0 && (
                      <Icon
                        as={TriangleAlert}
                        boxSize="3"
                        ml="1"
                        color="orange.fg"
                        aria-label={t("statement.unknownCostRow", {
                          count: row.unknownCostOrders,
                          unit: t(`statement.unit.${grain}`, { count: 1 }),
                        })}
                      />
                    )}
                  </Table.Cell>
                  <Table.Cell textAlign="end">{money(row.revenue)}</Table.Cell>
                  <Table.Cell textAlign="end">{money(row.cogs)}</Table.Cell>
                  <Table.Cell textAlign="end">{money(row.shippingCost)}</Table.Cell>
                  {/* In selling mode `income` IS the expected margin — the same field the warehouse
                      fills with its fees, which is what lets the subtraction below be written once. */}
                  <Table.Cell textAlign="end">{money(row.income)}</Table.Cell>
                </>
              )}

              <Table.Cell textAlign="end" color={row.stockLoss > 0n ? "orange.fg" : undefined}>
                {money(row.stockLoss)}
              </Table.Cell>
              <Table.Cell textAlign="end">{money(row.otherExpenses)}</Table.Cell>

              <Table.Cell
                textAlign="end"
                color={row.profit < 0n ? "red.fg" : undefined}
                fontWeight="medium"
              >
                {money(row.profit)}
              </Table.Cell>

              {/* The RUNNING total is what makes this a statement rather than a table of periods: it says
                  where the period stood at the close of each one, so a bad week is visible as the line
                  turning over rather than as three rows a reader has to add up. */}
              <Table.Cell textAlign="end" color={row.running < 0n ? "red.fg" : "fg.muted"}>
                {formatRupiah(row.running)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>

        {/* THE FOOTER IS THE SERVER'S TOTAL, not a sum of the rows above — and it therefore covers the
            WHOLE period even when "hide quiet days" is filtering the table. That is the honest choice: a
            footer that followed the filter would change when somebody hid rows worth nothing, which
            reads as the filter having changed the money. */}
        <Table.Footer>
          <Table.Row data-testid="statement-footer">
            <Table.Cell fontWeight="semibold">{t("statement.table.total")}</Table.Cell>

            {warehouse ? (
              <>
                <Table.Cell textAlign="end">{money(income)}</Table.Cell>
                <Table.Cell textAlign="end" color="fg.muted">
                  {money(codFees)}
                </Table.Cell>
              </>
            ) : (
              <>
                <Table.Cell />
                <Table.Cell textAlign="end">{money(0n)}</Table.Cell>
                <Table.Cell textAlign="end">{money(0n)}</Table.Cell>
                <Table.Cell textAlign="end">{money(0n)}</Table.Cell>
                <Table.Cell textAlign="end">{money(income)}</Table.Cell>
              </>
            )}

            <Table.Cell textAlign="end" color={stockLoss > 0n ? "orange.fg" : undefined}>
              {money(stockLoss)}
            </Table.Cell>
            <Table.Cell textAlign="end">{money(spent - stockLoss)}</Table.Cell>
            <Table.Cell
              textAlign="end"
              fontWeight="bold"
              color={income - spent < 0n ? "red.fg" : undefined}
              data-testid="statement-footer-profit"
            >
              {formatRupiah(income - spent)}
            </Table.Cell>
            <Table.Cell />
          </Table.Row>
        </Table.Footer>
      </Table.Root>
    </Table.ScrollArea>
  );
}
