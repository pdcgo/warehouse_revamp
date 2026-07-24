import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import { Badge } from "../../components/ui/Badge";
import { Card, CardBody } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { cn } from "../../components/ui/cn";
import { rpcError } from "../../api/clients";
import { Pagination } from "../../components/Pagination";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { useRevenue } from "./queries";
import { thisMonth } from "../../lib/period";

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

  const [month, setMonth] = useState(thisMonth);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const teamId = current?.teamId;

  // THE PERIOD (#171) travels in the query key. Until the filter existed the totals were all-time, so
  // a profit screen would have subtracted one month of costs from every order ever placed.
  const query = useRevenue({ teamId, month, page, pageSize });

  const revenues = query.data?.revenues ?? [];
  const totals = query.data?.totals;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";


  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("revenue.title")}</h1>
        <p className="text-fg-muted" data-testid="revenue-no-team">
          {t("revenue.selectTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("revenue.title")}</h1>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <div className="flex-1" />

        {/* The same month control the costs screen carries, reading the same shared helper — the two
            screens must agree what "this month" selects, because the profit screen subtracts one from
            the other. */}
        <div className="w-40">
          <Input
            type="month"
            value={month}
            data-testid="revenue-month"
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* These are expectations, not settled money. Said once, at the top, rather than repeated per row. */}
      <div className="flex items-center gap-2 text-fg-muted" data-testid="revenue-expected-notice">
        <TriangleAlert className="size-4" />
        <span className="text-sm">{t("revenue.expectedNotice")}</span>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="revenue-error">
          {error}
        </p>
      )}

      {/* The headline figures — over every order in the SELECTED PERIOD, not the page below. They come
          from the server for that reason (#78/#171): a total that silently meant "the twenty rows you
          can see" would change with the page size and still read as the whole truth. */}
      {!loading && totals && (
        <Card data-testid="revenue-totals">
          <CardBody>
            <div className="flex flex-col gap-card">
              <p className="text-sm uppercase text-fg-muted">{t("revenue.totals.heading")}</p>

              <div className="grid grid-cols-2 gap-card md:grid-cols-4">
                <div className="flex flex-col">
                  <p className="text-xs text-fg-muted">{t("revenue.table.revenue")}</p>
                  <p className="font-medium" data-testid="revenue-total-revenue">
                    {formatRupiah(totals.revenue)}
                  </p>
                </div>
                <div className="flex flex-col">
                  <p className="text-xs text-fg-muted">{t("revenue.table.cogs")}</p>
                  <p className="font-medium">{formatRupiah(totals.cogs)}</p>
                </div>
                <div className="flex flex-col">
                  <p className="text-xs text-fg-muted">{t("revenue.table.shipping")}</p>
                  <p className="font-medium">{formatRupiah(totals.shippingCost)}</p>
                </div>
                <div className="flex flex-col">
                  <p className="text-xs text-fg-muted">{t("revenue.table.margin")}</p>
                  <p className="font-medium" data-testid="revenue-total-margin">
                    {formatRupiah(totals.expectedMargin)}
                  </p>
                </div>
              </div>

              {/* How much of that margin is not to be trusted. Counted rather than excluded: dropping
                  those orders would understate revenue that genuinely happened, and including them
                  silently overstates margin. Naming the number lets a reader judge the total. */}
              {totals.unknownCostOrders > 0n && (
                <div
                  className="flex items-center gap-2 text-orange-600 dark:text-orange-400"
                  data-testid="revenue-unknown-cost-warning"
                >
                  <TriangleAlert className="size-4" />
                  <span className="text-sm">
                    {t("revenue.totals.unknownCost", { count: Number(totals.unknownCostOrders) })}
                  </span>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="revenue-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("revenue.table.order")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("revenue.table.revenue")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("revenue.table.cogs")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("revenue.table.shipping")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("revenue.table.margin")}</Table.ColumnHeader>
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
                className={cn(row.voided && "text-fg-muted line-through")}
              >
                <Table.Cell>
                  #{String(row.orderId)}
                  {row.voided && (
                    <Badge className="ml-2" colorPalette="gray" data-testid={`revenue-voided-${row.orderId}`}>
                      {t("revenue.table.voided")}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">{formatRupiah(row.revenue)}</Table.Cell>
                <Table.Cell className="text-right">
                  {/* 0 cogs means the cost is UNKNOWN, not that the goods were free (#74). Showing a
                      plain "Rp 0" would be a lie a reader cannot see, so the cell says unknown. */}
                  {row.costKnown ? (
                    formatRupiah(row.cogs)
                  ) : (
                    <span className="text-fg-muted" data-testid={`revenue-cogs-unknown-${row.orderId}`}>
                      {t("revenue.table.unknown")}
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right">{formatRupiah(row.shippingCost)}</Table.Cell>
                <Table.Cell className="text-right">
                  {/* A margin computed from an unknown cost reads as pure profit. It is flagged rather
                      than hidden: the number is still the best the system has, but nobody should plan
                      against it without knowing what it is missing. */}
                  <div className="flex items-center justify-end gap-1">
                    {!row.costKnown && (
                      <TriangleAlert
                        className="size-4 text-orange-600 dark:text-orange-400"
                        data-testid={`revenue-margin-untrusted-${row.orderId}`}
                      />
                    )}
                    <span className={row.costKnown ? undefined : "text-fg-muted"}>
                      {formatRupiah(row.expectedMargin)}
                    </span>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && revenues.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="revenue-empty">
          {t("revenue.empty")}
        </p>
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
    </div>
  );
}
