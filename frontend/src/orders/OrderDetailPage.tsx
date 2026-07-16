import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Flex, Heading, Icon, Separator, SimpleGrid, Spacer, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowLeft, Ban, Check } from "lucide-react";
import { orderClient, rpcError } from "../api/clients";
import type { Order, OrderAddress } from "../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import { useTeam } from "../team/TeamContext";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { ShippingBadge } from "../components/ShippingBadge";
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

// `value` is a ReactNode, not a string: most fields are plain text, but some render a component (the
// courier is a ShippingBadge). An empty string still falls back to the same "—" as before; a
// component decides its own empty state.
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text as="div" fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// The order's FROZEN address (#118), read straight off the snapshot — the names are stored alongside
// the codes, so this renders a years-old order without asking region_service anything.
//
// Every part is optional (the address itself is), so each line is rendered only if it has content and
// an absent/blank address falls back to the same "—" every other empty field shows.
function AddressField({ label, address }: { label: string; address?: OrderAddress }) {
  const street = address?.addressLine ?? "";
  const kodePos = address?.kodePos ?? "";
  // Narrowest first — how an address is read aloud: "Keude Bakongan, Bakongan, Kabupaten Aceh
  // Selatan, Aceh".
  const region = [
    address?.desaName,
    address?.kecamatanName,
    address?.kabupatenName,
    address?.provinsiName,
  ]
    .filter((part) => part)
    .join(", ");

  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>

      {street === "" && region === "" && kodePos === "" ? (
        <Text fontSize="sm">—</Text>
      ) : (
        <Stack gap="0" data-testid="order-detail-address">
          {street !== "" && <Text fontSize="sm">{street}</Text>}
          {region !== "" && <Text fontSize="sm">{region}</Text>}
          {kodePos !== "" && <Text fontSize="sm">{kodePos}</Text>}
        </Stack>
      )}
    </Stack>
  );
}

// OrderDetailPage is the read-only detail route for an order (#68) — a PAGE, not a dialog. It shows
// the customer, status, shipping, the frozen money totals, and the line items, scoped to the current
// team via OrderDetail.
export function OrderDetailPage() {
  const { t } = useTranslation();
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
      setError(id === 0n ? t("orders.invalidOrderId") : "");
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
  }, [teamId, id, t]);

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
      toaster.create({ type: "success", title: t("orders.orderConfirmed") });
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
      toaster.create({ type: "success", title: t("orders.orderCancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orders.title")}</Heading>
        <Text color="fg.muted" data-testid="order-detail-no-team">
          {t("orders.selectTeamView")}
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
          {t("orders.backToOrders")}
        </Button>
        <Text color="red.fg" data-testid="order-detail-error">
          {error || t("orders.orderNotFound")}
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
        {t("orders.backToOrders")}
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md" data-testid="order-detail-title">
          {t("orders.orderTitle", { id: order.id.toString() })}
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
            {t("orders.confirm")}
          </Button>
        )}

        {(order.status === OrderStatus.PLACED || order.status === OrderStatus.CONFIRMED) && (
          <ConfirmDialog
            title={t("orders.cancelOrder")}
            message={t("orders.cancelMessage", { id: order.id.toString() })}
            confirmLabel={t("orders.cancelOrder")}
            onConfirm={cancelOrder}
            trigger={
              <Button variant="outline" colorPalette="red" data-testid="order-cancel">
                <Icon as={Ban} boxSize="4" />
                {t("orders.cancel")}
              </Button>
            }
          />
        )}
      </Flex>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("orders.customerAndShipping")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field label={t("orders.customer")} value={order.customerName} />
              <Field label={t("orders.phone")} value={order.customerPhone} />
              <AddressField label={t("orders.address")} address={order.address} />
              <Field label={t("orders.shipping")} value={<ShippingBadge code={order.shippingCode} />} />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("orders.items")}
            </Text>

            <Table.Root size="sm" data-testid="order-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("orders.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orders.name")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orders.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
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
                {t("orders.subtotal")}: {formatRupiah(order.subtotal)}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t("orders.shipping")}: {formatRupiah(order.shippingCost)}
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="order-detail-total">
                {t("orders.total")}: {formatRupiah(order.total)}
              </Text>
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
