import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Flex, Heading, Spacer, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { orderClient, rpcError } from "../api/clients";
import type { Order } from "../gen/warehouse/selling/v1/order_pb";
import { useTeam } from "../team/TeamContext";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { Pagination } from "../components/Pagination";
import { formatRupiah } from "../lib/money";

const PAGE_SIZE = 20;

// OrdersPage lists the CURRENT selling TEAM's orders (#68), newest first, paginated. The team is the
// scope — a team only ever sees its own orders. Rows open the read-only detail page.
export function OrdersPage() {
  const { current } = useTeam();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await orderClient.orderList({ teamId, page: { page, limit: PAGE_SIZE } });
      setOrders(res.orders);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">Orders</Heading>
        <Text color="fg.muted" data-testid="orders-no-team">
          Select a team to view its orders.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Orders</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="orders-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="orders-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Order</Table.ColumnHeader>
              <Table.ColumnHeader>Customer</Table.ColumnHeader>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Total</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {orders.map((o) => (
              <Table.Row key={o.id.toString()} data-testid={`order-row-${o.id}`}>
                <Table.Cell>
                  <Box
                    cursor="pointer"
                    fontWeight="medium"
                    data-testid={`open-order-${o.id}`}
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    #{o.id.toString()}
                  </Box>
                </Table.Cell>
                <Table.Cell>{o.customerName}</Table.Cell>
                <Table.Cell>
                  <OrderStatusBadge status={o.status} />
                </Table.Cell>
                <Table.Cell textAlign="end">{formatRupiah(o.total)}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && orders.length === 0 && !error && (
        <Text color="fg.muted" data-testid="orders-empty">
          No orders yet.
        </Text>
      )}

      {!loading && (
        <Pagination count={totalItems} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
      )}
    </Stack>
  );
}
