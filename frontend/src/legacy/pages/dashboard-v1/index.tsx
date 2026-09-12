import { Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Boxes, PackageX, Receipt, Wallet } from "lucide-react";
import { Card } from "../../components/display/Card";
import { Statistic } from "../../components/display/Statistic";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { DateCell } from "../../components/cells/DateCell";
import { formatRupiahCompact } from "../../../lib/money";
import type { OrderRow } from "../../fixtures";

// The PREVIOUS generation of the dashboard, kept because the legacy system still routes to it.
//
// It is ported as a reference for what changed, and the difference is instructive: this version puts
// the TILES first and has no warnings block at all. Anything wrong had to be inferred from a number
// being high — "42 waiting" reads the same whether that is normal or a crisis.
//
// ⚠ Do not treat this as an alternative to the current dashboard. It is here to show the direction
// of travel: from numbers you must interpret, to statements you can act on.
export const description =
  "The PREVIOUS dashboard generation. Tiles first, no warnings — anything wrong had to be inferred from a number being high. Kept as a reference for what changed, not as an alternative.";

export interface DashboardV1PageProps {
  waitingOrders?: number;
  lowStock?: number;
  revenue?: bigint;
  recent?: OrderRow[];
  loading?: boolean;
}

export function DashboardV1Page({
  waitingOrders = 0,
  lowStock = 0,
  revenue = 0n,
  recent = [],
  loading,
}: DashboardV1PageProps) {
  const columns: Array<TableColumn<OrderRow>> = [
    { name: "Order", key: "code" },
    { name: "Customer", key: "customer" },
    {
      name: "Total",
      align: "end",
      render: (row) => <StatisticCell value={row.total} kind="price" compact />,
    },
    { name: "Created", render: (row) => <DateCell value={row.createdAt} grain="datetime" /> },
  ];

  return (
    <Stack gap="section" data-testid="dashboard-v1-page">
      <Heading size="md">Dashboard</Heading>

      {/* No warnings block — the whole difference from the current version. */}
      <SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} gap="card">
        <Statistic title="Orders waiting" icon={Receipt} loading={loading}>
          {waitingOrders.toLocaleString("id-ID")}
        </Statistic>
        <Statistic title="Low stock" icon={PackageX} loading={loading}>
          {lowStock.toLocaleString("id-ID")}
        </Statistic>
        <Statistic title="Revenue" icon={Wallet} loading={loading}>
          {formatRupiahCompact(revenue)}
        </Statistic>
        <Statistic title="Stock on hand" icon={Boxes} loading={loading}>
          12.480
        </Statistic>
      </SimpleGrid>

      <Card table>
        <Stack gap="0">
          <Text fontSize="sm" fontWeight="medium" p="card">
            Latest orders
          </Text>
          <DataTable
            columns={columns}
            items={recent}
            size="sm"
            loading={loading}
            emptyTitle="No orders"
            aria-label="Latest orders"
          />
        </Stack>
      </Card>
    </Stack>
  );
}
