import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Flex, Heading, Icon, Separator, SimpleGrid, Spacer, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowLeft, Ban, Check } from "lucide-react";
import { orderClient, rpcError } from "../api/clients";
import type { Order } from "../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import { useTeam } from "../team/TeamContext";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toaster } from "../components/Toaster";
import { formatRupiah } from "../lib/money";

function parseOrderId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// OrderDetailPage is the read-only detail route for an order (#68) — a PAGE, not a dialog. It shows
// the customer, status, shipping, the frozen money totals, and the line items, scoped to the current
// team via OrderDetail.
export function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();

  const id = parseOrderId(orderId);
  const teamId = current?.teamId;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (teamId === undefined || id === 0n) {
      setError(id === 0n ? "Invalid order id." : "");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await orderClient.orderDetail({ teamId, orderId: id });
      setOrder(res.order ?? null);
    } catch (err) {
      setError(rpcError(err));
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Confirm is a forward, non-destructive move (PLACED -> CONFIRMED), so it runs on a direct click.
  async function confirmOrder() {
    if (teamId === undefined || !order) return;

    setActing(true);

    try {
      const res = await orderClient.orderConfirm({ teamId, orderId: order.id });
      setOrder(res.order ?? order);
      toaster.create({ type: "success", title: "Order confirmed" });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    } finally {
      setActing(false);
    }
  }

  // Cancel is terminal, so it goes through the ConfirmDialog. On error we surface a toast and let the
  // dialog close; the status simply stays as it was.
  async function cancelOrder() {
    if (teamId === undefined || !order) return;

    try {
      const res = await orderClient.orderCancel({ teamId, orderId: order.id });
      setOrder(res.order ?? order);
      toaster.create({ type: "success", title: "Order cancelled" });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">Orders</Heading>
        <Text color="fg.muted" data-testid="order-detail-no-team">
          Select a team to view its orders.
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !order) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="order-detail-back"
          onClick={() => navigate("/orders")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          Back to Orders
        </Button>
        <Text color="red.fg" data-testid="order-detail-error">
          {error || "Order not found."}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="order-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="order-detail-back"
        onClick={() => navigate("/orders")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        Back to Orders
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md" data-testid="order-detail-title">
          Order #{order.id.toString()}
        </Heading>
        <OrderStatusBadge status={order.status} />
        <Spacer />

        {order.status === OrderStatus.PLACED && (
          <Button
            colorPalette="brand"
            loading={acting}
            data-testid="order-confirm"
            onClick={() => void confirmOrder()}
          >
            <Icon as={Check} boxSize="4" />
            Confirm
          </Button>
        )}

        {(order.status === OrderStatus.PLACED || order.status === OrderStatus.CONFIRMED) && (
          <ConfirmDialog
            title="Cancel Order"
            message={`Cancel order #${order.id.toString()}? This can't be undone.`}
            confirmLabel="Cancel Order"
            onConfirm={cancelOrder}
            trigger={
              <Button variant="outline" colorPalette="red" data-testid="order-cancel">
                <Icon as={Ban} boxSize="4" />
                Cancel
              </Button>
            }
          />
        )}
      </Flex>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              Customer &amp; shipping
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field label="Customer" value={order.customerName} />
              <Field label="Phone" value={order.customerPhone} />
              <Field label="Address" value={order.customerAddress} />
              <Field label="Shipping" value={order.shippingCode} />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              Items
            </Text>

            <Table.Root size="sm" data-testid="order-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>SKU</Table.ColumnHeader>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Qty</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Unit price</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Line total</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {order.items.map((it) => (
                  <Table.Row key={it.id.toString()} data-testid={`order-item-${it.sku}`}>
                    <Table.Cell>{it.sku}</Table.Cell>
                    <Table.Cell>{it.name}</Table.Cell>
                    <Table.Cell textAlign="end">{it.quantity}</Table.Cell>
                    <Table.Cell textAlign="end">{formatRupiah(it.unitPrice)}</Table.Cell>
                    <Table.Cell textAlign="end">{formatRupiah(BigInt(it.quantity) * it.unitPrice)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            <Separator />

            <Stack gap="1" align="end">
              <Text fontSize="sm" color="fg.muted">
                Subtotal: {formatRupiah(order.subtotal)}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Shipping: {formatRupiah(order.shippingCost)}
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="order-detail-total">
                Total: {formatRupiah(order.total)}
              </Text>
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
