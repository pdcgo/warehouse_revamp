import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, Check } from "lucide-react";
import { rpcError } from "../../api/clients";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import type { OrderAddress } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useOrder, useConfirmOrder, useCancelOrder } from "../../features/orders/queries";
import { OrderStatusBadge } from "../../components/OrderStatusBadge";
import { ShippingBadge } from "../../components/ShippingBadge";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { toaster } from "../../components/Toaster";
import { formatRupiah } from "../../lib/money";

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
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium uppercase text-fg-muted">{label}</span>
      <div className="line-clamp-3 text-sm">{value || "—"}</div>
    </div>
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
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium uppercase text-fg-muted">{label}</span>

      {street === "" && region === "" && kodePos === "" ? (
        <span className="text-sm">—</span>
      ) : (
        <div className="flex flex-col" data-testid="order-detail-address">
          {street !== "" && <span className="text-sm">{street}</span>}
          {region !== "" && <span className="text-sm">{region}</span>}
          {kodePos !== "" && <span className="text-sm">{kodePos}</span>}
        </div>
      )}
    </div>
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

  const [acting, setActing] = useState(false);

  const query = useOrder({ teamId, orderId: id });
  const confirmMutation = useConfirmOrder();
  const cancelMutation = useCancelOrder();

  const order = query.data ?? null;
  const loading = query.isPending && id !== 0n;

  // A malformed id never reaches the server (the query is disabled for it), so its message comes
  // from here rather than from an error no request produced.
  const error =
    id === 0n ? t("orders.invalidOrderId") : query.isError ? rpcError(query.error) : "";

  // Both actions used to write the response straight into local state. They now INVALIDATE instead:
  // the status they change is also a column in the orders list, and setting it here would leave that
  // list holding the previous value until its own cache lapsed. Pressing back would show an order
  // still PLACED that had just been confirmed.
  //
  // Confirm is a forward, non-destructive move (PLACED -> CONFIRMED), so it runs on a direct click.
  async function confirmOrder() {
    if (teamId === undefined || !order) return;

    setActing(true);

    try {
      await confirmMutation.mutateAsync({ teamId, orderId: order.id });
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
      await cancelMutation.mutateAsync({ teamId, orderId: order.id });
      toaster.create({ type: "success", title: t("orders.orderCancelled") });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("orders.title")}</h1>
        <p className="text-fg-muted" data-testid="order-detail-no-team">
          {t("orders.selectTeamView")}
        </p>
      </div>
    );
  }

  if (loading) {
    return <Spinner />;
  }

  if (error || !order) {
    return (
      <div className="flex flex-col gap-section">
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          data-testid="order-detail-back"
          onClick={() => navigate("/orders")}
        >
          <ArrowLeft className="size-4" />
          {t("orders.backToOrders")}
        </Button>
        <p className="text-red-600 dark:text-red-400" data-testid="order-detail-error">
          {error || t("orders.orderNotFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section" data-testid="order-detail-page">
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        data-testid="order-detail-back"
        onClick={() => navigate("/orders")}
      >
        <ArrowLeft className="size-4" />
        {t("orders.backToOrders")}
      </Button>

      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold" data-testid="order-detail-title">
          {t("orders.orderTitle", { id: order.id.toString() })}
        </h1>
        <OrderStatusBadge status={order.status} />
        <div className="flex-1" />

        {order.status === OrderStatus.PLACED && (
          <Button
            colorPalette="brand"
            loading={acting}
            data-testid="order-confirm"
            onClick={() => void confirmOrder()}
          >
            <Check className="size-4" />
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
                <Ban className="size-4" />
                {t("orders.cancel")}
              </Button>
            }
          />
        )}
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <p className="text-sm font-medium text-fg-muted">{t("orders.customerAndShipping")}</p>
            <div className="grid grid-cols-1 gap-card sm:grid-cols-2">
              <Field label={t("orders.customer")} value={order.customerName} />
              <Field label={t("orders.phone")} value={order.customerPhone} />
              <AddressField label={t("orders.address")} address={order.address} />
              <Field label={t("orders.shipping")} value={<ShippingBadge code={order.shippingCode} />} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <p className="text-sm font-medium text-fg-muted">{t("orders.items")}</p>

            <Table.Root data-testid="order-detail-items">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("orders.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orders.name")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("orders.qty")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("orders.unitPrice")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("orders.lineTotal")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {order.items.map((it) => (
                  <Table.Row key={it.id.toString()} data-testid={`order-item-${it.sku}`}>
                    <Table.Cell>{it.sku}</Table.Cell>
                    <Table.Cell>{it.name}</Table.Cell>
                    <Table.Cell className="text-right">{it.quantity}</Table.Cell>
                    <Table.Cell className="text-right">{formatRupiah(it.unitPrice)}</Table.Cell>
                    <Table.Cell className="text-right">{formatRupiah(BigInt(it.quantity) * it.unitPrice)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            <div className="border-t border-line" />

            <div className="flex flex-col items-end gap-1">
              <span className="text-sm text-fg-muted">
                {t("orders.subtotal")}: {formatRupiah(order.subtotal)}
              </span>
              <span className="text-sm text-fg-muted">
                {t("orders.shipping")}: {formatRupiah(order.shippingCost)}
              </span>
              <span className="text-base font-semibold" data-testid="order-detail-total">
                {t("orders.total")}: {formatRupiah(order.total)}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
