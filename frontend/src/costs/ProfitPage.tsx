import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  Flex,
  Heading,
  Icon,
  Input,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Minus, TriangleAlert } from "lucide-react";

import { costClient, revenueClient, rpcError } from "../api/clients";
import type { CostTotals } from "../gen/warehouse/cost/v1/cost_pb";
import { CostKind } from "../gen/warehouse/cost/v1/cost_pb";
import type { RevenueTotals } from "../gen/warehouse/revenue/v1/revenue_pb";
import { costKindLabel } from "../components/CostKindSelect";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";
import { monthRange, thisMonth } from "../lib/period";

// Only the TOTALS are wanted from either call, and both list RPCs require a page. One row is the
// smallest a PageFilter allows (limit is validated 1..200), so this asks for one and ignores it —
// cheaper than a page of twenty that nothing reads.
const TOTALS_ONLY = { page: 1, limit: 1 };

// ProfitPage — what a month actually made (#172), the destination of the whole cost service.
//
//   profit = Σ expected margin − Σ costs
//
// THE SUBTRACTION HAPPENS HERE, ON THE CLIENT, and that is the owner's decision (§2.4) rather than an
// accident of where it was easy. revenue_service and cost_service are independent: neither imports the
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
  const [revenue, setRevenue] = useState<RevenueTotals | undefined>(undefined);
  const [costs, setCosts] = useState<CostTotals | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const teamId = current?.teamId;

  // `cancelled` is checked before every setState, and on a money screen it is not a nicety (#173).
  //
  // Switch the picker July → June and two reads are in flight at once. Without this, a slow JULY
  // response landing after June's paints July's figures under a picker that reads June — and there is
  // nothing on screen to say so, because both are perfectly plausible numbers. That is the failure
  // this whole screen was built to avoid, arriving through the back door.
  //
  // The same guard 11 other pages already use. #173 proposes doing it centrally with TanStack Query
  // rather than by hand on each of the 19 that lack it.
  const load = useCallback(async (cancelled: () => boolean) => {
    if (teamId === undefined) return;

    setLoading(true);
    setError("");

    try {
      const { from, to } = monthRange(month);

      // Concurrent, and ALL-OR-NOTHING on purpose. If only the cost call fails, a screen that showed
      // the margin it did get would report the month's whole margin as its profit — a number that is
      // wrong by exactly the costs, and looks entirely healthy. Promise.all rejects on the first
      // failure, and the catch below clears BOTH, so a half-answer is never on screen.
      const [rev, cost] = await Promise.all([
        revenueClient.revenueList({ teamId, from, to, page: TOTALS_ONLY }),
        // Every kind — UNSPECIFIED is the "any kind" filter (#170), not a kind of its own.
        costClient.costList({ teamId, from, to, kind: CostKind.UNSPECIFIED, page: TOTALS_ONLY }),
      ]);

      if (cancelled()) return;

      setRevenue(rev.totals);
      setCosts(cost.totals);
    } catch (err) {
      if (cancelled()) return;

      setError(rpcError(err));
      setRevenue(undefined);
      setCosts(undefined);
    } finally {
      // Guarded too, and it has to be: a superseded read clearing the spinner would uncover an empty
      // screen while the read that replaced it is still in flight. The newer request set `loading`
      // itself and will clear it, so nothing is left spinning.
      if (!cancelled()) setLoading(false);
    }
  }, [teamId, month]);

  useEffect(() => {
    let stale = false;

    void load(() => stale);

    return () => {
      stale = true;
    };
  }, [load]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("profit.title")}</Heading>
        <Text color="fg.muted" data-testid="profit-no-team">
          {t("profit.selectTeam")}
        </Text>
      </Stack>
    );
  }

  const margin = revenue?.expectedMargin ?? 0n;
  const spent = costs?.total ?? 0n;
  const profit = margin - spent;

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("profit.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />

        {/* The same month control the other two money screens carry, reading the same shared helper.
            All three MUST agree what a month selects — this screen subtracts one of them from the
            other, and two definitions of July would make the bottom line quietly meaningless. */}
        <Input
          type="month"
          w="40"
          value={month}
          data-testid="profit-month"
          onChange={(e) => setMonth(e.target.value)}
        />
      </Flex>

      {/* Not decoration. Half of this subtraction is an expectation, and an unlabelled money screen is
          read as cash in the bank. */}
      <Flex align="center" gap="2" color="fg.muted" data-testid="profit-expected-notice">
        <Icon as={TriangleAlert} boxSize="4" />
        <Text fontSize="sm">{t("profit.expectedNotice")}</Text>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="profit-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        !error && (
          <>
            {/* THE ARITHMETIC, SHOWN AS ARITHMETIC. Three numbers with the operator between them,
                rather than a lone bottom line: a profit figure whose two inputs are not on the same
                screen is a number nobody can check, and both inputs come from somewhere the reader
                can go and look (Revenue, Costs). */}
            <Card.Root data-testid="profit-summary">
              <Card.Body>
                <SimpleGrid columns={{ base: 1, md: 3 }} gap="card" alignItems="center">
                  <Stack gap="0">
                    <Text fontSize="xs" color="fg.muted">
                      {t("profit.expectedMargin")}
                    </Text>
                    <Text fontSize="xl" fontWeight="medium" data-testid="profit-margin">
                      {formatRupiah(margin)}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {t("profit.marginSource")}
                    </Text>
                  </Stack>

                  <Stack gap="0">
                    <Flex align="center" gap="1">
                      <Icon as={Minus} boxSize="4" color="fg.muted" />
                      <Text fontSize="xs" color="fg.muted">
                        {t("profit.totalCost")}
                      </Text>
                    </Flex>
                    <Text fontSize="xl" fontWeight="medium" data-testid="profit-cost">
                      {formatRupiah(spent)}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {t("profit.costSource")}
                    </Text>
                  </Stack>

                  <Stack gap="0">
                    <Text fontSize="xs" color="fg.muted">
                      {t("profit.profit")}
                    </Text>
                    {/* A LOSS is coloured, not hidden or dressed up as a smaller gain. It is the one
                        number on this screen somebody has to notice. */}
                    <Text
                      fontSize="2xl"
                      fontWeight="bold"
                      color={profit < 0n ? "red.fg" : undefined}
                      data-testid="profit-total"
                    >
                      {formatRupiah(profit)}
                    </Text>
                    {profit < 0n && (
                      <Text fontSize="xs" color="red.fg" data-testid="profit-loss">
                        {t("profit.loss")}
                      </Text>
                    )}
                  </Stack>
                </SimpleGrid>
              </Card.Body>
            </Card.Root>

            {/* How much of the margin above is not to be trusted (#74). It matters MORE here than on
                the revenue screen: an order whose cost is unknown counts as pure profit, so it pushes
                this bottom line UP. A reader who cannot see that is reading an overstatement. */}
            {(revenue?.unknownCostOrders ?? 0n) > 0n && (
              <Flex align="center" gap="2" color="orange.fg" data-testid="profit-unknown-cost-warning">
                <Icon as={TriangleAlert} boxSize="4" />
                <Text fontSize="sm">
                  {t("profit.unknownCost", { count: Number(revenue?.unknownCostOrders ?? 0n) })}
                </Text>
              </Flex>
            )}

            {/* What the costs were made of. Free — CostTotals already carries the breakdown (#168), so
                showing it needs no second call, and "why is the cost that high" is the first question
                a bad month provokes. */}
            <Card.Root data-testid="profit-cost-breakdown">
              <Card.Body>
                <Stack gap="card">
                  <Text fontSize="sm" color="fg.muted" textTransform="uppercase">
                    {t("profit.breakdown")}
                  </Text>

                  <SimpleGrid columns={{ base: 2, md: 3 }} gap="card">
                    {[CostKind.ADS, CostKind.PAYROLL, CostKind.OPERATIONAL].map((k) => (
                      <Stack key={k} gap="0">
                        <Text fontSize="xs" color="fg.muted">
                          {costKindLabel(t, k)}
                        </Text>
                        <Text fontWeight="medium" data-testid={`profit-cost-kind-${k}`}>
                          {/* A kind with nothing this month is ABSENT from the map (#168) rather than
                              zero — on a summary card the two mean the same thing. */}
                          {formatRupiah(costs?.byKind[k] ?? 0n)}
                        </Text>
                      </Stack>
                    ))}
                  </SimpleGrid>
                </Stack>
              </Card.Body>
            </Card.Root>
          </>
        )
      )}
    </Stack>
  );
}
