import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import {
  Ban,
  CircleCheck,
  Download,
  Eye,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  Truck,
} from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { ShopCell } from "../../components/cells/ShopCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { Alert } from "../../components/display/Alert";
import { ChoiceTabs } from "../../components/display/ChoiceTabs";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { CopyText } from "../../components/text/CopyText";
import { Pagination } from "../../../components/chrome/Pagination";
import type { OrderRow, OrderStatus } from "../../fixtures";
import { OrderStatusBadge } from "../_orders/OrderStatusBadge";

// ── THE ORDER LIST — the busiest screen in the legacy system ─────────────────────────────────────
//
// The original composed a heading, an alert, a summary band, a filter row, a table and THIRTEEN
// actions (cancel, finish, return, set-lost, shipped, import, and seven edits). That count is the
// clue to what this screen is: not a browse, a QUEUE. Someone sits on it all day and pushes orders
// through states.
//
// Three decisions follow from that, and are what is ported:
//
//  1. STATUS IS A TAB STRIP, NOT A DROPDOWN. The status is the ONE filter that is always applied and
//     always being changed — you work the "New" pile, then the "Packing" pile. Tabs make the current
//     pile and its size readable without opening anything; a dropdown hides both.
//  2. THE SUMMARY BAND IS ABOVE THE TABLE, NOT BESIDE IT. The counts are what you check between
//     batches ("how many left?"), so they belong where the eye returns, not in a sidebar.
//  3. ACTIONS COLLAPSE INTO A MENU. With this many, inline buttons would out-weigh the rows —
//     `ActionCell` enforces it, but the screen is why the rule exists.
//
// ⚠ It does not fetch. Rows arrive as props (see legacy/fixtures.ts).
export const description =
  "The order queue: status as a tab strip rather than a dropdown, counts above the table where the eye returns, and the row actions collapsed into a menu. The busiest screen in the legacy system.";

const STATUS_TABS: Array<{ value: OrderStatus | undefined; name: string }> = [
  { value: undefined, name: "All" },
  { value: "created", name: "New" },
  { value: "packing", name: "Packing" },
  { value: "shipped", name: "Shipped" },
  { value: "delivered", name: "Delivered" },
  { value: "returned", name: "Returned" },
  { value: "cancelled", name: "Cancelled" },
];

export interface OrderListPageProps {
  orders: OrderRow[];
  loading?: boolean;
  isError?: boolean;
  // A standing condition about the queue as a whole — "3 orders failed to import". An Alert, not a
  // toast: it is still true after you dismiss it.
  notice?: string;
}

export function OrderListPage({ orders, loading, isError, notice }: OrderListPageProps) {
  const [status, setStatus] = useState<OrderStatus>();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TableSort>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (!q) return true;
      return (
        o.code.toLowerCase().includes(q) ||
        o.customer.toLowerCase().includes(q) ||
        o.receipt.toLowerCase().includes(q)
      );
    });
  }, [orders, status, search]);

  const sorted = useMemo(() => {
    if (!sort?.key) return rows;
    const direction = sort.desc ? -1 : 1;

    return [...rows].sort((a, b) => {
      const av = a[sort.key as keyof OrderRow];
      const bv = b[sort.key as keyof OrderRow];
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * direction;
    });
  }, [rows, sort]);

  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);

  // The counts the operator checks between batches. Computed from the FULL set, not the filtered
  // one — "how many are left to pack" must not change because you typed in the search box.
  const counts = useMemo(() => {
    const by = (s: OrderStatus) => orders.filter((o) => o.status === s).length;
    return { created: by("created"), packing: by("packing"), shipped: by("shipped"), returned: by("returned") };
  }, [orders]);

  const columns: Array<TableColumn<OrderRow>> = [
    {
      name: "Order",
      sortKey: "code",
      sticky: "left",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short">
          <CopyText copyText={row.code} label="Copy order code">
            <Text fontWeight="bold">{row.code}</Text>
          </CopyText>
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
    { name: "Items", key: "itemCount", align: "end", sortKey: "itemCount" },
    {
      name: "Total",
      align: "end",
      sortKey: "total",
      render: (row) => <StatisticCell value={row.total} kind="price" compact />,
    },
    {
      name: "Shipping",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short">
          <Text fontSize="sm">{row.courier}</Text>
          {/* The receipt is the string retyped into a courier's tracking page all day. */}
          {row.receipt ? (
            <CopyText copyText={row.receipt} label="Copy receipt">
              <Text fontSize="xs" color="fg.muted">
                {row.receipt}
              </Text>
            </CopyText>
          ) : (
            <Text fontSize="xs" color="fg.subtle">
              no receipt
            </Text>
          )}
        </Stack>
      ),
    },
    {
      name: "Created",
      sortKey: "createdAt",
      render: (row) => <DateCell value={row.createdAt} grain="relative" />,
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "View", icon: Eye },
            { title: "Edit", icon: Pencil },
            { title: "Mark shipped", icon: Truck },
            { title: "Finish", icon: CircleCheck, tone: "success" },
            { title: "Return", icon: RotateCcw, tone: "warning" },
            { title: "Mark lost", icon: PackageX, tone: "error" },
            { title: "Cancel", icon: Ban, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="order-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Orders</Heading>
        <HStack gap="2">
          <Button tone="plain" variant="outline" icon={Download} data-testid="order-import">
            Import
          </Button>
          <Button icon={Plus} href="/orders/create">
            New Order
          </Button>
        </HStack>
      </HStack>

      {notice && (
        <Alert tone="warning" data-testid="order-notice">
          {notice}
        </Alert>
      )}

      {/* DECISION 2: the counts sit above the table, where the eye returns between batches. */}
      <Summary
        items={[
          { label: "New", value: counts.created, tone: "active" },
          { label: "Packing", value: counts.packing, tone: "active" },
          { label: "Shipped", value: counts.shipped, tone: "info" },
          { label: "Returned", value: counts.returned, tone: "error" },
        ]}
      />

      {/* DECISION 1: status is a tab strip. It is the one filter always applied and always changing. */}
      <ChoiceTabs
        items={STATUS_TABS.map((t) => ({ value: t.value, name: t.name }))}
        value={status}
        onChange={(v) => {
          setStatus(v as OrderStatus | undefined);
          setPage(1);
        }}
      />

      <HStack gap="card" wrap="wrap">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Order code, customer or receipt"
          maxW="72"
        />
      </HStack>

      <DataTable
        columns={columns}
        items={paged}
        loading={loading}
        isError={isError}
        sort={sort}
        onSort={setSort}
        headerSticky
        emptyTitle="No orders in this pile"
        emptyContent="Try another status tab, or clear the search."
        errorTitle="Could not load orders"
        aria-label="Orders"
      />

      <Pagination
        count={sorted.length}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        pageSizeOptions={[20, 50, 100]}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        showRange
      />
    </Stack>
  );
}
