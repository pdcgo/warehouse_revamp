import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  Flex,
  Heading,
  Icon,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { revenueClient, rpcError } from "../api/clients";
import type { OrderRevenue, RevenueTotals } from "../gen/warehouse/revenue/v1/revenue_pb";
import { Pagination } from "../components/Pagination";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// RevenuePage — what a team's orders were EXPECTED to make (#78).
//
// Expected, not banked. Every figure here was frozen when the order was placed (#74/#75); none of it
// has been reconciled against what a marketplace actually paid out, because no payout data reaches this
// system yet (§2.3, owner 2026-07-20). The screen says so in a banner rather than letting a reader
// assume these are settled numbers — an unlabelled money screen is read as cash in the bank.
export function RevenuePage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [revenues, setRevenues] = useState<OrderRevenue[]>([]);
  const [totals, setTotals] = useState<RevenueTotals | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) return;

    setLoading(true);
    setError("");

    try {
      const res = await revenueClient.revenueList({
        teamId,
        page: { page, limit: pageSize },
      });

      setRevenues(res.revenues);
      setTotals(res.totals);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setRevenues([]);
      setTotals(undefined);
    } finally {
      setLoading(false);
    }
  }, [teamId, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("revenue.title")}</Heading>
        <Text color="fg.muted" data-testid="revenue-no-team">
          {t("revenue.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("revenue.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
      </Flex>

      {/* These are expectations, not settled money. Said once, at the top, rather than repeated per row. */}
      <Flex align="center" gap="2" color="fg.muted" data-testid="revenue-expected-notice">
        <Icon as={TriangleAlert} boxSize="4" />
        <Text fontSize="sm">{t("revenue.expectedNotice")}</Text>
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="revenue-error">
          {error}
        </Text>
      )}

      {/* The headline figures — over EVERY order this team has, not the page below. That is why they
          come from the server and are labelled "all orders": a total that silently meant "the twenty
          rows you can see" would change with the page size and read as the whole truth. */}
      {!loading && totals && (
        <Card.Root data-testid="revenue-totals">
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="sm" color="fg.muted" textTransform="uppercase">
                {t("revenue.totals.heading")}
              </Text>

              <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
                <Stack gap="0">
                  <Text fontSize="xs" color="fg.muted">
                    {t("revenue.table.revenue")}
                  </Text>
                  <Text fontWeight="medium" data-testid="revenue-total-revenue">
                    {formatRupiah(totals.revenue)}
                  </Text>
                </Stack>
                <Stack gap="0">
                  <Text fontSize="xs" color="fg.muted">
                    {t("revenue.table.cogs")}
                  </Text>
                  <Text fontWeight="medium">{formatRupiah(totals.cogs)}</Text>
                </Stack>
                <Stack gap="0">
                  <Text fontSize="xs" color="fg.muted">
                    {t("revenue.table.shipping")}
                  </Text>
                  <Text fontWeight="medium">{formatRupiah(totals.shippingCost)}</Text>
                </Stack>
                <Stack gap="0">
                  <Text fontSize="xs" color="fg.muted">
                    {t("revenue.table.margin")}
                  </Text>
                  <Text fontWeight="medium" data-testid="revenue-total-margin">
                    {formatRupiah(totals.expectedMargin)}
                  </Text>
                </Stack>
              </SimpleGrid>

              {/* How much of that margin is not to be trusted. Counted rather than excluded: dropping
                  those orders would understate revenue that genuinely happened, and including them
                  silently overstates margin. Naming the number lets a reader judge the total. */}
              {totals.unknownCostOrders > 0n && (
                <Flex align="center" gap="2" color="orange.fg" data-testid="revenue-unknown-cost-warning">
                  <Icon as={TriangleAlert} boxSize="4" />
                  <Text fontSize="sm">
                    {t("revenue.totals.unknownCost", { count: Number(totals.unknownCostOrders) })}
                  </Text>
                </Flex>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="revenue-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("revenue.table.order")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("revenue.table.revenue")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("revenue.table.cogs")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("revenue.table.shipping")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("revenue.table.margin")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {revenues.map((row) => (
              <Table.Row
                key={String(row.id)}
                data-testid={`revenue-row-${row.orderId}`}
                // A VOIDED row is shown, muted (#164). The order was cancelled so it earned nothing and
                // the totals exclude it — but it was placed, and that is worth seeing. Greyed rather
                // than hidden, because hidden is indistinguishable from deleted, and deleted is the
                // option that cannot tell you an order fell through.
                color={row.voided ? "fg.muted" : undefined}
                textDecoration={row.voided ? "line-through" : undefined}
              >
                <Table.Cell>
                  #{String(row.orderId)}
                  {row.voided && (
                    <Badge ml="2" colorPalette="gray" data-testid={`revenue-voided-${row.orderId}`}>
                      {t("revenue.table.voided")}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end">{formatRupiah(row.revenue)}</Table.Cell>
                <Table.Cell textAlign="end">
                  {/* 0 cogs means the cost is UNKNOWN, not that the goods were free (#74). Showing a
                      plain "Rp 0" would be a lie a reader cannot see, so the cell says unknown. */}
                  {row.costKnown ? (
                    formatRupiah(row.cogs)
                  ) : (
                    <Text as="span" color="fg.muted" data-testid={`revenue-cogs-unknown-${row.orderId}`}>
                      {t("revenue.table.unknown")}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end">{formatRupiah(row.shippingCost)}</Table.Cell>
                <Table.Cell textAlign="end">
                  {/* A margin computed from an unknown cost reads as pure profit. It is flagged rather
                      than hidden: the number is still the best the system has, but nobody should plan
                      against it without knowing what it is missing. */}
                  <Flex align="center" gap="1" justify="flex-end">
                    {!row.costKnown && (
                      <Icon
                        as={TriangleAlert}
                        boxSize="4"
                        color="orange.fg"
                        data-testid={`revenue-margin-untrusted-${row.orderId}`}
                      />
                    )}
                    <Text color={row.costKnown ? undefined : "fg.muted"}>
                      {formatRupiah(row.expectedMargin)}
                    </Text>
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && revenues.length === 0 && !error && (
        <Text color="fg.muted" data-testid="revenue-empty">
          {t("revenue.empty")}
        </Text>
      )}

      {!loading && (
        <Pagination
          count={totalItems}
          pageSize={pageSize}
          page={page}
          onPageChange={setPage}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
        />
      )}
    </Stack>
  );
}
