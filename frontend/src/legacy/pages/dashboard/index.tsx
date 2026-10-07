import { Heading, HStack, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Boxes, PackageX, Receipt, TriangleAlert, Wallet } from "lucide-react";
import { BarChart } from "../../components/charts/BarChart";
import { LineChart } from "../../components/charts/LineChart";
import { Card } from "../../components/display/Card";
import { Statistic } from "../../components/display/Statistic";
import { LimitProgress } from "../../components/display/LimitProgress";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { ShopCell } from "../../components/cells/ShopCell";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { OrderStatusBadge } from "../_orders/OrderStatusBadge";
import { formatRupiahCompact } from "../../../lib/money";
import { METRIC_SERIES, METRIC_SPINE, type OrderRow } from "../../fixtures";

// The dashboard — the screen everyone lands on.
//
// Its job is narrow and worth stating, because dashboards drift into being a place to put things:
// answer "is anything wrong, and what should I do first" in the time it takes to look at it. Every
// element here has to earn that.
//
//  1. THE WARNINGS COME FIRST, above the numbers. A credit limit at 96% or forty unpicked orders is
//     the reason to be on this screen at all; putting the tiles first means scrolling past good news
//     to find the bad.
//  2. THE TILES ARE COUNTS YOU ACT ON, not vanity totals. "Orders waiting" is actionable; "orders
//     all time" is not, and it is the kind of number that makes a dashboard decorative.
//  3. THE RECENT TABLE IS SHORT AND LINKS OUT. It exists to show that things are moving, not to be
//     worked from — the queue is the screen for that.
export const description =
  "The landing screen. Warnings above the numbers, tiles that are counts you act on rather than vanity totals, and a short recent list that links out to the queue instead of trying to replace it.";

export interface DashboardPageProps {
  waitingOrders?: number;
  lowStock?: number;
  unpaid?: bigint;
  creditLimit?: bigint;
  revenue?: bigint;
  recent?: OrderRow[];
  loading?: boolean;
}

export function DashboardPage({
  waitingOrders = 0,
  lowStock = 0,
  unpaid = 0n,
  creditLimit = 0n,
  revenue = 0n,
  recent = [],
  loading,
}: DashboardPageProps) {
  const overLimit = creditLimit > 0n && (Number(unpaid) / Number(creditLimit)) * 100 >= 80;

  const columns: Array<TableColumn<OrderRow>> = [
    {
      name: "Order",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short">
          <Text fontWeight="medium">{row.code}</Text>
          <Text fontSize="xs" color="fg.muted">
            {row.customer}
          </Text>
        </Stack>
      ),
    },
    {
      name: "Shop",
      render: (row) => <ShopCell shop={{ name: row.shopName, marketplace: row.marketplace }} />,
    },
    { name: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
    {
      name: "Total",
      align: "end",
      render: (row) => <StatisticCell value={row.total} kind="price" compact />,
    },
    { name: "When", render: (row) => <DateCell value={row.createdAt} grain="relative" /> },
  ];

  return (
    <Stack gap="section" data-testid="dashboard-page">
      <Heading size="md">Dashboard</Heading>

      {/* DECISION 1: warnings first. These are the reason to be on this screen. */}
      <Stack gap="2" data-testid="dashboard-warnings">
        {lowStock > 0 && (
          <Alert tone="warning" icon={TriangleAlert} title={`${lowStock} products below minimum`}>
            Restock before they run out and orders start failing.
          </Alert>
        )}
        {overLimit && (
          <Alert tone="error" icon={Wallet} title="Credit limit nearly reached">
            New orders will be blocked once the ceiling is hit.
          </Alert>
        )}
      </Stack>

      {/* DECISION 2: counts you act on. */}
      <SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} gap="card">
        <Statistic title="Orders waiting" icon={Receipt} tone="active" loading={loading}>
          {waitingOrders.toLocaleString("id-ID")}
        </Statistic>
        <Statistic title="Products below minimum" icon={PackageX} tone="warning" loading={loading}>
          {lowStock.toLocaleString("id-ID")}
        </Statistic>
        <Statistic title="Revenue this month" icon={Wallet} tone="success" loading={loading}>
          {formatRupiahCompact(revenue)}
        </Statistic>
        <Statistic title="Stock on hand" icon={Boxes} tone="info" loading={loading}>
          12.480
        </Statistic>
      </SimpleGrid>

      {creditLimit > 0n && (
        <Card>
          <Stack gap="2">
            <Text fontSize="sm" fontWeight="medium">
              Credit limit
            </Text>
            <LimitProgress unpaid={unpaid} threshold={creditLimit} showValue showIcon />
          </Stack>
        </Card>
      )}

      <SimpleGrid columns={{ base: 1, xl: 2 }} gap="card">
        <Card>
          <Stack gap="2">
            <Text fontSize="sm" fontWeight="medium">
              Revenue and cost
            </Text>
            <LineChart
              labels={METRIC_SPINE}
              series={METRIC_SERIES}
              loading={loading}
              height={200}
              formatValue={(v) => formatRupiahCompact(BigInt(Math.round(v * 1000)))}
            />
          </Stack>
        </Card>

        <Card>
          <Stack gap="2">
            <Text fontSize="sm" fontWeight="medium">
              Orders packed
            </Text>
            <BarChart
              labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}
              series={[{ name: "Packed", values: [42, 55, 38, 61, 74, 29] }]}
              loading={loading}
              height={200}
            />
          </Stack>
        </Card>
      </SimpleGrid>

      {/* DECISION 3: short, and it links OUT rather than trying to be the queue. */}
      <Card table>
        <Stack gap="0">
          <HStack justify="space-between" p="card">
            <Text fontSize="sm" fontWeight="medium">
              Latest orders
            </Text>
            <Text fontSize="sm" color="colorPalette.fg" colorPalette="brand" asChild>
              <a href="/orders" data-testid="dashboard-all-orders">
                See all orders
              </a>
            </Text>
          </HStack>
          <DataTable
            columns={columns}
            items={recent.slice(0, 5)}
            size="sm"
            loading={loading}
            emptyTitle="Nothing yet today"
            aria-label="Latest orders"
          />
        </Stack>
      </Card>
    </Stack>
  );
}
