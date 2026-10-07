import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { CircleCheck, Trash2 } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { ShopCell } from "../../components/cells/ShopCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Pagination } from "../../../components/chrome/Pagination";
import type { OrderRow } from "../../fixtures";

// The DRAFT pile: orders that arrived incomplete and cannot ship until somebody finishes them.
//
// It is a separate screen from the order queue rather than a status tab on it, and that separation
// is the decision worth keeping. A draft is not a stage of an order's life — it is an order that is
// NOT YET VALID: no address, no courier, an unmatched product. Mixing them into the main queue means
// every count and every bulk action has to carry an exception for rows that are not really orders.
//
// So the only actions here are FINISH and DISCARD. There is nothing else you can usefully do to a
// record that is missing the fields the other actions operate on.
export const description =
  "The draft pile — orders that arrived incomplete. A separate screen from the queue, because a draft is not a stage of an order's life but an order that is not yet valid; the only actions are finish and discard.";

export interface OrderDraftListPageProps {
  drafts: OrderRow[];
  loading?: boolean;
  isError?: boolean;
}

export function OrderDraftListPage({ drafts, loading, isError }: OrderDraftListPageProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((d) => d.code.toLowerCase().includes(q) || d.customer.toLowerCase().includes(q));
  }, [drafts, search]);

  const columns: Array<TableColumn<OrderRow>> = [
    {
      name: "Draft",
      sticky: "left",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short">
          <Text fontWeight="bold">{row.code}</Text>
          <Text fontSize="xs" color="fg.muted">
            {row.customer || "no customer yet"}
          </Text>
        </Stack>
      ),
    },
    {
      name: "Shop",
      render: (row) => <ShopCell shop={{ name: row.shopName, marketplace: row.marketplace }} />,
    },
    {
      name: "What is missing",
      // The whole reason a row is here. Without it the operator opens each draft to find out, which
      // is the work this column exists to remove.
      render: (row) => (
        <Text fontSize="sm" color="fg.muted">
          {row.receipt ? "Unmatched product" : "No courier or receipt"}
        </Text>
      ),
    },
    { name: "Items", key: "itemCount", align: "end" },
    {
      name: "Value",
      align: "end",
      render: (row) => <StatisticCell value={row.total} kind="price" compact />,
    },
    { name: "Created", render: (row) => <DateCell value={row.createdAt} grain="relative" /> },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "Finish", icon: CircleCheck, tone: "success" },
            { title: "Discard", icon: Trash2, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="order-draft-list-page">
      <Heading size="md">Draft Orders</Heading>

      <Alert tone="info">
        Drafts cannot ship until the missing details are filled in. They are not counted in the order
        queue.
      </Alert>

      <HStack gap="card" wrap="wrap">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Draft code or customer"
          maxW="72"
        />
      </HStack>

      <DataTable
        columns={columns}
        items={rows.slice((page - 1) * 20, page * 20)}
        loading={loading}
        isError={isError}
        emptyTitle="No drafts"
        emptyContent="Every imported order has the details it needs."
        errorTitle="Could not load drafts"
        aria-label="Draft orders"
      />

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}
