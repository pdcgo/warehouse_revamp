import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Minus, TriangleAlert } from "lucide-react";

import { Badge } from "../../components/ui/Badge";
import { Card, CardBody } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { cn } from "../../components/ui/cn";
import { rpcError } from "../../api/clients";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { expenseKindLabel } from "../../components/ExpenseKindSelect";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { useProfit } from "./queries";
import { thisMonth } from "../../lib/period";

// Only the TOTALS are wanted from either call, and both list RPCs require a page. One row is the
// smallest a PageFilter allows (limit is validated 1..200), so this asks for one and ignores it —
// cheaper than a page of twenty that nothing reads.
const TOTALS_ONLY = { page: 1, limit: 1 };

// ProfitPage — what a month actually made (#172), the destination of the whole cost service.
//
//   profit = Σ expected margin − Σ costs
//
// THE SUBTRACTION HAPPENS HERE, ON THE CLIENT, and that is the owner's decision (§2.4) rather than an
// accident of where it was easy. revenue_service and expense_service are independent: neither imports the
// other, neither has a table the other can read (HARD RULE 3). A backend report RPC would have made
// one service own a number derived from data it does not hold. So the screen asks both for the same
// period and does the arithmetic itself.
//
// ⚠ IT SUBTRACTS TWO DIFFERENT KINDS OF CERTAINTY. The costs are money that genuinely left the
// business — a person typed each one. The margin is only EXPECTED: nothing here has been reconciled
// against what a marketplace actually paid out, because no payout data reaches this system yet
// (revenue §2.3; settlement is #76). The banner says so rather than letting the reader assume the
// bottom line is cash. Worth revisiting when #76 lands.
export function ProfitPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [month, setMonth] = useState(thisMonth);

  const teamId = current?.teamId;
  // No hand-written race guard here any more (#176). The 40 lines it took — a cancelled() callback
  // threaded through the loader, the catch and the finally — existed to stop a slow JULY response
  // painting itself under a picker that reads June. A response for a key that is no longer current is
  // simply not this component's data now, so there is nothing left to discard by hand.
  const query = useProfit({ teamId, month, totalsOnly: TOTALS_ONLY });

  const revenue = query.data?.revenue;
  const expenses = query.data?.expenses;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";


  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("profit.title")}</h1>
        <p className="text-fg-muted" data-testid="profit-no-team">
          {t("profit.selectTeam")}
        </p>
      </div>
    );
  }

  const margin = revenue?.expectedMargin ?? 0n;
  const spent = expenses?.total ?? 0n;
  const profit = margin - spent;

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("profit.title")}</h1>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <div className="flex-1" />

        {/* The same month control the other two money screens carry, reading the same shared helper.
            All three MUST agree what a month selects — this screen subtracts one of them from the
            other, and two definitions of July would make the bottom line quietly meaningless. */}
        <div className="w-40">
          <Input
            type="month"
            value={month}
            data-testid="profit-month"
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {/* Not decoration. Half of this subtraction is an expectation, and an unlabelled money screen is
          read as cash in the bank. */}
      <div className="flex items-center gap-2 text-fg-muted" data-testid="profit-expected-notice">
        <TriangleAlert className="size-4" />
        <span className="text-sm">{t("profit.expectedNotice")}</span>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="profit-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        !error && (
          <>
            {/* THE ARITHMETIC, SHOWN AS ARITHMETIC. Three numbers with the operator between them,
                rather than a lone bottom line: a profit figure whose two inputs are not on the same
                screen is a number nobody can check, and both inputs come from somewhere the reader
                can go and look (Revenue, Costs). */}
            <Card data-testid="profit-summary">
              <CardBody>
                <div className="grid grid-cols-1 items-center gap-card md:grid-cols-3">
                  <div className="flex flex-col">
                    <p className="text-xs text-fg-muted">{t("profit.expectedMargin")}</p>
                    <p className="text-xl font-medium" data-testid="profit-margin">
                      {formatRupiah(margin)}
                    </p>
                    <p className="text-xs text-fg-muted">{t("profit.marginSource")}</p>
                  </div>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-1">
                      <Minus className="size-4 text-fg-muted" />
                      <p className="text-xs text-fg-muted">{t("profit.totalCost")}</p>
                    </div>
                    <p className="text-xl font-medium" data-testid="profit-cost">
                      {formatRupiah(spent)}
                    </p>
                    <p className="text-xs text-fg-muted">{t("profit.costSource")}</p>
                  </div>

                  <div className="flex flex-col">
                    <p className="text-xs text-fg-muted">{t("profit.profit")}</p>
                    {/* A LOSS is coloured, not hidden or dressed up as a smaller gain. It is the one
                        number on this screen somebody has to notice. */}
                    <p
                      className={cn(
                        "text-2xl font-bold",
                        profit < 0n && "text-red-600 dark:text-red-400",
                      )}
                      data-testid="profit-total"
                    >
                      {formatRupiah(profit)}
                    </p>
                    {profit < 0n && (
                      <p className="text-xs text-red-600 dark:text-red-400" data-testid="profit-loss">
                        {t("profit.loss")}
                      </p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* How much of the margin above is not to be trusted (#74). It matters MORE here than on
                the revenue screen: an order whose cost is unknown counts as pure profit, so it pushes
                this bottom line UP. A reader who cannot see that is reading an overstatement. */}
            {(revenue?.unknownCostOrders ?? 0n) > 0n && (
              <div
                className="flex items-center gap-2 text-orange-600 dark:text-orange-400"
                data-testid="profit-unknown-cost-warning"
              >
                <TriangleAlert className="size-4" />
                <span className="text-sm">
                  {t("profit.unknownCost", { count: Number(revenue?.unknownCostOrders ?? 0n) })}
                </span>
              </div>
            )}

            {/* What the costs were made of. Free — ExpenseTotals already carries the breakdown (#168), so
                showing it needs no second call, and "why is the cost that high" is the first question
                a bad month provokes. */}
            <Card data-testid="profit-cost-breakdown">
              <CardBody>
                <div className="flex flex-col gap-card">
                  <p className="text-sm uppercase text-fg-muted">{t("profit.breakdown")}</p>

                  <div className="grid grid-cols-2 gap-card md:grid-cols-3">
                    {[ExpenseKind.ADS, ExpenseKind.PAYROLL, ExpenseKind.OPERATIONAL].map((k) => (
                      <div key={k} className="flex flex-col">
                        <p className="text-xs text-fg-muted">{expenseKindLabel(t, k)}</p>
                        <p className="font-medium" data-testid={`profit-cost-kind-${k}`}>
                          {/* A kind with nothing this month is ABSENT from the map (#168) rather than
                              zero — on a summary card the two mean the same thing. */}
                          {formatRupiah(expenses?.byKind[k] ?? 0n)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardBody>
            </Card>
          </>
        )
      )}
    </div>
  );
}
