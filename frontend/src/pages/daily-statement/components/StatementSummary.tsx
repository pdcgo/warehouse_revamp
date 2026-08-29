import { useTranslation } from "react-i18next";
import { Card, Flex, Icon, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Minus, TriangleAlert } from "lucide-react";

import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import type { ExpenseTotals } from "../../../gen/warehouse/expense/v1/expense_pb";
import type { LiabilityDailyTotals } from "../../../gen/warehouse/liability/v1/liability_pb";
import { LiabilitySourceType } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import type { PeriodGrain } from "../../../lib/period";
import type { StatementMode } from "../queries";

export interface StatementSummaryProps {
  mode: StatementMode;
  /** Which unit the average below is per — the table's row grain, so the two agree. */
  grain: PeriodGrain;
  /** The period's income — the handling fees it charged. */
  income: bigint;
  liability: LiabilityDailyTotals | undefined;
  expenses: ExpenseTotals | undefined;
  /** How many BUCKETS the period covers — the divisor for the per-period average. */
  buckets: number;
  loading: boolean;
}

// The period's arithmetic, above the table.
//
// SHOWN AS ARITHMETIC — numbers with the operator between them, rather than a lone bottom line. A profit
// figure whose inputs are not on the same screen is a number nobody can check, and here the inputs are
// also the columns the table below is made of, so the header and the rows explain each other.
//
// Every figure is the SERVER's, over the whole period. Nothing here re-sums the rows — the ONE exception
// is the average, which is a division of two server figures rather than a sum of the table.
export function StatementSummary({
  mode,
  grain,
  income,
  liability,
  expenses,
  buckets,
  loading,
}: StatementSummaryProps) {
  const { t } = useTranslation();

  // "day" / "days" / "bulan" — the grain's noun, agreeing with a count. One helper rather than a
  // singular and a plural key per grain: English needs the agreement, Indonesian does not, and this is
  // the one shape that is right in both without the copy knowing which language it is in.
  const unit = (count: number) => t(`statement.unit.${grain}`, { count });

  const spent = expenses?.total ?? 0n;
  const profit = income - spent;

  const stockLoss = expenses?.byKind[ExpenseKind.STOCK_LOSS] ?? 0n;
  const codFees = liability?.bySource[LiabilitySourceType.COD_FEE] ?? 0n;

  // AN AVERAGE PER ROW, because that is the number a statement is for: "we clear about 400.000 a day" is
  // a sentence somebody can act on, where a period total is only comparable against another period of
  // the same length.
  //
  // ⚠ IT FOLLOWS THE GRAIN, and it has to: over twelve monthly rows the useful sentence is "about 9
  // million a month", and a per-DAY figure sitting above a per-MONTH table is two different units in one
  // header with nothing saying which is which.
  //
  // Divided by the buckets in the RANGE, not by the ones that traded — a quiet Sunday is part of the
  // week's average, not an absence from it.
  //
  // BigInt division truncates toward zero, which is right here: this is a headline figure, and a rupiah
  // of rounding on an average of hundreds of thousands is invisible.
  const perBucket = buckets > 0 ? profit / BigInt(buckets) : 0n;

  const money = (amount: bigint) => (loading ? "—" : formatRupiah(amount));

  return (
    <Card.Root data-testid="statement-summary">
      <Card.Body>
        <SimpleGrid columns={{ base: 2, md: 4 }} gap="card" alignItems="start">
          <Stack gap="0">
            <Text fontSize="xs" color="fg.muted">
              {mode === "warehouse" ? t("statement.feesEarned") : t("statement.expectedMargin")}
            </Text>
            <Text fontSize="xl" fontWeight="medium" data-testid="statement-total-margin">
              {money(income)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {mode === "warehouse" ? t("statement.feesSource") : t("statement.marginSource")}
            </Text>
          </Stack>

          <Stack gap="0">
            <Flex align="center" gap="1">
              <Icon as={Minus} boxSize="4" color="fg.muted" />
              <Text fontSize="xs" color="fg.muted">
                {t("statement.expenses")}
              </Text>
            </Flex>
            <Text fontSize="xl" fontWeight="medium" data-testid="statement-total-expenses">
              {money(spent)}
            </Text>
            {/* WHAT OF IT WAS STOCK GOING WRONG. Rent is a decision somebody made; a dropped pallet is
                not, and only one of the two is worth a manager's morning. This is the whole reason
                stock loss was given its own expense kind rather than sitting inside Operational.

                Shown ONLY when there is some. A selling team never writes stock off — inventory posts
                every loss against the warehouse's team — so an unconditional line would print "of which
                Rp 0" on every selling statement forever, which is a caption that has stopped saying
                anything and trains the eye to skip the line that will one day matter. */}
            <Text fontSize="xs" color="fg.muted" data-testid="statement-total-stock-loss">
              {loading
                ? "—"
                : stockLoss > 0n
                  ? t("statement.ofWhichStockLoss", { amount: formatRupiah(stockLoss) })
                  : t("statement.expensesSource")}
            </Text>
          </Stack>

          <Stack gap="0">
            <Text fontSize="xs" color="fg.muted">
              {t("statement.profit")}
            </Text>
            {/* A LOSS is coloured, not hidden or dressed up as a smaller gain. It is the one number here
                somebody has to notice. */}
            <Text
              fontSize="2xl"
              fontWeight="bold"
              color={!loading && profit < 0n ? "red.fg" : undefined}
              data-testid="statement-total-profit"
            >
              {money(profit)}
            </Text>
            {!loading && profit < 0n && (
              <Text fontSize="xs" color="red.fg" data-testid="statement-loss">
                {t("statement.loss")}
              </Text>
            )}
          </Stack>

          <Stack gap="0">
            <Text fontSize="xs" color="fg.muted">
              {t("statement.perUnit", { unit: unit(1) })}
            </Text>
            {/* Still `statement-per-day` at every grain — it is one figure in one place, and giving it
                three testids would only make every test that reads it branch on the grain. */}
            <Text
              fontSize="xl"
              fontWeight="medium"
              color={!loading && perBucket < 0n ? "red.fg" : undefined}
              data-testid="statement-per-day"
            >
              {money(perBucket)}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {t("statement.perUnitSource", { count: buckets, unit: unit(buckets) })}
            </Text>
          </Stack>
        </SimpleGrid>

        {/* ⚠ COD IS NOT INCOME, and saying so is the only way the number above stops looking wrong.
            A warehouse pays a courier at the door for goods it does not own and is owed that money
            back — so it is a reimbursement of cash already gone, not something earned. It is shown
            because the warehouse is genuinely owed it, and excluded from profit because counting it
            would inflate income against an outflow that was never recorded as an expense. */}
        {!loading && mode === "warehouse" && codFees !== 0n && (
          <Flex align="center" gap="2" mt="card" color="fg.muted" data-testid="statement-cod-notice">
            <Icon as={TriangleAlert} boxSize="4" />
            <Text fontSize="sm">{t("statement.codNotice", { amount: formatRupiah(codFees) })}</Text>
          </Flex>
        )}

        {/* ⚠ THE UNKNOWN-COST WARNING WENT WITH `revenue_service`. It said how much of the margin above
            was not to be trusted (#74) — an order whose cost is unknown counts as pure profit, so it
            pushed every figure UP. Nothing here reads a margin any more, so there is nothing to warn
            about; it comes back with the selling half, not before. */}
      </Card.Body>
    </Card.Root>
  );
}
