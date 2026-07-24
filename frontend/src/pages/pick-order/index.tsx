import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import type { StockPickLocation } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { OrderStatusBadge } from "../../components/OrderStatusBadge";
import { toaster } from "../../components/Toaster";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { usePickOrder } from "../../features/picking/queries";
import { useAdvanceOrderFulfilment } from "../../features/picking/queries";

function parseOrderId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}


// The one action available from each state, and nothing else. The crew's screen offers the NEXT STEP
// rather than a set of buttons to choose between: at any moment there is exactly one thing that has
// happened next, and a screen offering three invites recording the wrong one.
const NEXT_STEP: Partial<Record<OrderStatus, { labelKey: string; toastKey: string }>> = {
  [OrderStatus.CONFIRMED]: { labelKey: "picking.action.startPicking", toastKey: "picking.toast.picking" },
  [OrderStatus.PICKING]: { labelKey: "picking.action.markPacked", toastKey: "picking.toast.packed" },
  [OrderStatus.PACKED]: { labelKey: "picking.action.markShipped", toastKey: "picking.toast.shipped" },
};

// PickOrderPage — one order, its lines, and WHICH SHELF to walk to for each (#151).
//
// The shelf column is the entire point of the screen: without it a picker is hunting. It comes from
// StockPickLocations, which reads the ledger rather than current stock levels — these are the shelves
// this order's goods were actually committed from when it was placed, not a guess at where they might
// be now.
export function PickOrderPage() {
  const { current } = useTeam();
  const { orderId: rawOrderId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const orderId = parseOrderId(rawOrderId);



  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  // Both reads land together — see usePickOrder. A partial screen would be worse than a slower one.
  const query = usePickOrder({ warehouseId, orderId });
  // Advancing a step also moves stock — the hook invalidates both (#177).
  const advanceMutation = useAdvanceOrderFulfilment();

  const order = query.data?.order ?? null;
  const locations = query.data?.locations ?? [];
  const loading = query.isPending && warehouseId !== undefined && orderId !== 0n;
  const error = query.isError ? rpcError(query.error) : "";

  async function advance() {
    if (warehouseId === undefined || !order) return;

    const step = NEXT_STEP[order.status];
    if (!step) return;

    try {
      // The step, and the stock it moves, invalidated together by the hook (#177).
      await advanceMutation.mutateAsync({
        warehouseId,
        orderId,
        step:
          order.status === OrderStatus.CONFIRMED
            ? "pick"
            : order.status === OrderStatus.PICKING
              ? "pack"
              : "ship",
      });
      toaster.create({ type: "success", title: t(step.toastKey) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("picking.toast.stepFailed"),
        description: rpcError(err),
      });
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("picking.detail.title", { id: String(orderId) })}</h1>
        <p className="text-fg-muted" data-testid="pick-order-no-team">
          {t("picking.selectTeam")}
        </p>
      </div>
    );
  }

  if (!isWarehouse) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("picking.detail.title", { id: String(orderId) })}</h1>
        <p className="text-fg-muted" data-testid="pick-order-not-warehouse">
          {t("picking.warehouseOnly")}
        </p>
      </div>
    );
  }

  const back = (
    <Button
      size="xs"
      variant="ghost"
      className="self-start"
      onClick={() => navigate("/inventories/picking")}
      data-testid="pick-order-back"
    >
      <ArrowLeft className="size-4" />
      {t("picking.detail.back")}
    </Button>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-section">
        {back}
        <Spinner />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex flex-col gap-section">
        {back}
        <p className="text-red-600 dark:text-red-400" data-testid="pick-order-error">
          {error || t("picking.detail.notFound")}
        </p>
      </div>
    );
  }

  // The shelves for one product, in the order the system drained them (#149).
  function shelvesFor(productId: bigint): StockPickLocation[] {
    return locations.filter((loc) => loc.productId === productId);
  }

  const step = NEXT_STEP[order.status];

  return (
    <div className="flex flex-col gap-section">
      {back}

      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("picking.detail.title", { id: String(order.id) })}</h1>
        <OrderStatusBadge status={order.status} />
        <div className="flex-1" />
        {step && (
          <Button
            colorPalette="brand"
            loading={advanceMutation.isPending}
            onClick={() => void advance()}
            data-testid="pick-order-advance"
          >
            {t(step.labelKey)}
          </Button>
        )}
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <p className="text-sm uppercase text-fg-muted">{t("picking.detail.customer")}</p>
            <p data-testid="pick-order-customer">{order.customerName}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <p className="text-sm uppercase text-fg-muted">{t("picking.detail.pickList")}</p>

            <Table.Root data-testid="pick-list-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("picking.table.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("picking.table.qty")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("picking.table.shelf")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {order.items.map((item) => {
                  const shelves = shelvesFor(item.productId);

                  return (
                    <Table.Row key={String(item.id)} data-testid={`pick-line-${item.productId}`}>
                      <Table.Cell>
                        <div className="flex flex-col">
                          <span>{item.name}</span>
                          <span className="text-xs text-fg-muted">{item.sku}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>{item.quantity}</Table.Cell>
                      <Table.Cell>
                        {shelves.length === 0 ? (
                          // No recorded draw. An order placed before stock integration (#149) never took
                          // stock, so there is no shelf to name — and saying so plainly beats a blank
                          // cell, which reads as "we forgot" rather than "there is nothing to know".
                          <div className="flex items-center gap-1 text-fg-muted">
                            <TriangleAlert className="size-4" />
                            <span className="text-sm" data-testid={`pick-line-noshelf-${item.productId}`}>
                              {t("picking.table.noRecordedShelf")}
                            </span>
                          </div>
                        ) : (
                          // EVERY shelf the goods came from, each with its own quantity — never one
                          // shelf chosen on the picker's behalf (#135/#151). Two shelves means two
                          // walks, and the screen has to say so.
                          <div className="flex flex-col gap-1">
                            {shelves.map((loc) => (
                              <div
                                key={`${loc.rackId}-${loc.rackCode}`}
                                className="flex items-center gap-2"
                                data-testid={`pick-shelf-${item.productId}-${loc.rackId}`}
                              >
                                <Badge colorPalette={loc.rackId === 0n ? "gray" : "brand"}>
                                  {loc.rackId === 0n ? t("picking.table.unplaced") : loc.rackCode}
                                </Badge>
                                <span className="text-sm">×{String(loc.quantity)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
