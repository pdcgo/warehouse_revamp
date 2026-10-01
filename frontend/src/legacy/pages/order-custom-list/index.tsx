import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { ChoiceTabs } from "../../components/display/ChoiceTabs";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Pagination } from "../../../components/chrome/Pagination";
import type { OrderRow, OrderStatus } from "../../fixtures";
import { OrderStatusBadge } from "../_orders/OrderStatusBadge";

// CUSTOM orders — the ones raised by hand rather than imported from a marketplace: a phone order, a
// reseller, a staff purchase.
//
// They get their own screen for a reason that is easy to miss: a custom order has NO MARKETPLACE and
// NO SHOP. On the main queue, a third of the columns would be permanently empty for these rows, and
// the marketplace filter would silently exclude them — so somebody looking for "all orders" would be
// shown a list that quietly omits every hand-raised one.
//
// The columns here are therefore different, not merely filtered: the buyer replaces the shop, and
// the source replaces the marketplace.
export const description =
  "Hand-raised orders, on their own screen — a custom order has no shop or marketplace, so a third of the queue's columns would be permanently empty and its marketplace filter would silently exclude them.";

const TABS: Array<{ value: OrderStatus | undefined; name: string }> = [
  { value: undefined, name: "All" },
  { value: "created", name: "Open" },
  { value: "delivered", name: "Completed" },
  { value: "cancelled", name: "Cancelled" },
];

export interface OrderCustomListPageProps {
  orders: OrderRow[];
  loading?: boolean;
  isError?: boolean;
}

export function OrderCustomListPage({ orders, loading, isError }: OrderCustomListPageProps) {
  const [status, setStatus] = useState<OrderStatus>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (!q) return true;
      return o.code.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q);
    });
  }, [orders, status, search]);

  const columns: Array<TableColumn<OrderRow>> = [
    {
      name: "Order",
      sticky: "left",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short">
          <Text fontWeight="bold">{row.code}</Text>
          <Text fontSize="xs" color="fg.muted">
            {row.customer}
          </Text>
        </Stack>
      ),
    },
    // The buyer replaces the shop; the source replaces the marketplace.
    { name: "Raised by", render: () => <Text fontSize="sm">Ani Rahayu</Text> },
    { name: "Source", render: () => <Text fontSize="sm">Phone</Text> },
    { name: "Status", render: (row) => <OrderStatusBadge status={row.status} /> },
    { name: "Items", key: "itemCount", align: "end" },
    {
      name: "Total",
      align: "end",
      render: (row) => <StatisticCell value={row.total} kind="price" compact />,
    },
    { name: "Created", render: (row) => <DateCell value={row.createdAt} grain="date" /> },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "View", icon: Eye },
            { title: "Edit", icon: Pencil },
            { title: "Delete", icon: Trash2, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="order-custom-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Custom Orders</Heading>
        <Button icon={Plus} href="/order-customs/create">
          New Custom Order
        </Button>
      </HStack>

      <ChoiceTabs
        items={TABS.map((t) => ({ value: t.value, name: t.name }))}
        value={status}
        onChange={(v) => {
          setStatus(v as OrderStatus | undefined);
          setPage(1);
        }}
      />

      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Order code or buyer"
        maxW="72"
      />

      <DataTable
        columns={columns}
        items={rows.slice((page - 1) * 20, page * 20)}
        loading={loading}
        isError={isError}
        emptyTitle="No custom orders"
        emptyContent="Orders raised by hand appear here."
        errorTitle="Could not load custom orders"
        aria-label="Custom orders"
      />

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}
