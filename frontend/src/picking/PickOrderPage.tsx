import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { inventoryClient, orderClient, rpcError } from "../api/clients";
import type { Order } from "../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import type { StockPickLocation } from "../gen/warehouse/inventory/v1/inventory_pb";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { toaster } from "../components/Toaster";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";

function parseOrderId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// The ref inventory_service recorded this order's draw under (#149). selling_service builds the same
// string; it is the handle that ties an order to the shelves its goods were taken from.
function stockRef(orderId: bigint): string {
  return `order:${orderId}`;
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

  const [order, setOrder] = useState<Order | null>(null);
  const [locations, setLocations] = useState<StockPickLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const load = useCallback(async () => {
    if (warehouseId === undefined || orderId === 0n) return;

    setLoading(true);
    setError("");

    try {
      // Both reads together: the lines are useless without the shelves and the shelves meaningless
      // without the lines, so a partial screen would be worse than a slower one.
      const [detail, places] = await Promise.all([
        orderClient.orderDetail({ teamId: warehouseId, orderId }),
        inventoryClient.stockPickLocations({ warehouseId, ref: stockRef(orderId) }),
      ]);

      setOrder(detail.order ?? null);
      setLocations(places.locations);
    } catch (err) {
      setError(rpcError(err));
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [warehouseId, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance() {
    if (warehouseId === undefined || !order) return;

    const step = NEXT_STEP[order.status];
    if (!step) return;

    setActing(true);

    try {
      const call =
        order.status === OrderStatus.CONFIRMED
          ? orderClient.orderPick({ teamId: warehouseId, orderId })
          : order.status === OrderStatus.PICKING
            ? orderClient.orderPack({ teamId: warehouseId, orderId })
            : orderClient.orderShip({ teamId: warehouseId, orderId });

      const res = await call;

      setOrder(res.order ?? order);
      toaster.create({ type: "success", title: t(step.toastKey) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("picking.toast.stepFailed"),
        description: rpcError(err),
      });
    } finally {
      setActing(false);
    }
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("picking.detail.title", { id: String(orderId) })}</Heading>
        <Text color="fg.muted" data-testid="pick-order-no-team">
          {t("picking.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("picking.detail.title", { id: String(orderId) })}</Heading>
        <Text color="fg.muted" data-testid="pick-order-not-warehouse">
          {t("picking.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      onClick={() => navigate("/inventories/picking")}
      data-testid="pick-order-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("picking.detail.back")}
    </Button>
  );

  if (loading) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" />
      </Stack>
    );
  }

  if (error || !order) {
    return (
      <Stack gap="section">
        {back}
        <Text color="red.fg" data-testid="pick-order-error">
          {error || t("picking.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  // The shelves for one product, in the order the system drained them (#149).
  function shelvesFor(productId: bigint): StockPickLocation[] {
    return locations.filter((loc) => loc.productId === productId);
  }

  const step = NEXT_STEP[order.status];

  return (
    <Stack gap="section">
      {back}

      <Flex align="center" gap="card">
        <Heading size="md">{t("picking.detail.title", { id: String(order.id) })}</Heading>
        <OrderStatusBadge status={order.status} />
        <Spacer />
        {step && (
          <Button
            colorPalette="brand"
            loading={acting}
            onClick={() => void advance()}
            data-testid="pick-order-advance"
          >
            {t(step.labelKey)}
          </Button>
        )}
      </Flex>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" color="fg.muted" textTransform="uppercase">
              {t("picking.detail.customer")}
            </Text>
            <Text data-testid="pick-order-customer">{order.customerName}</Text>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" color="fg.muted" textTransform="uppercase">
              {t("picking.detail.pickList")}
            </Text>

            <Table.Root size="sm" data-testid="pick-list-table">
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
                        <Stack gap="0">
                          <Text>{item.name}</Text>
                          <Text fontSize="xs" color="fg.muted">
                            {item.sku}
                          </Text>
                        </Stack>
                      </Table.Cell>
                      <Table.Cell>{item.quantity}</Table.Cell>
                      <Table.Cell>
                        {shelves.length === 0 ? (
                          // No recorded draw. An order placed before stock integration (#149) never took
                          // stock, so there is no shelf to name — and saying so plainly beats a blank
                          // cell, which reads as "we forgot" rather than "there is nothing to know".
                          <Flex align="center" gap="1" color="fg.muted">
                            <Icon as={TriangleAlert} boxSize="4" />
                            <Text fontSize="sm" data-testid={`pick-line-noshelf-${item.productId}`}>
                              {t("picking.table.noRecordedShelf")}
                            </Text>
                          </Flex>
                        ) : (
                          // EVERY shelf the goods came from, each with its own quantity — never one
                          // shelf chosen on the picker's behalf (#135/#151). Two shelves means two
                          // walks, and the screen has to say so.
                          <Stack gap="1">
                            {shelves.map((loc) => (
                              <Flex
                                key={`${loc.rackId}-${loc.rackCode}`}
                                align="center"
                                gap="2"
                                data-testid={`pick-shelf-${item.productId}-${loc.rackId}`}
                              >
                                <Badge colorPalette={loc.rackId === 0n ? "gray" : "brand"}>
                                  {loc.rackId === 0n ? t("picking.table.unplaced") : loc.rackCode}
                                </Badge>
                                <Text fontSize="sm">×{String(loc.quantity)}</Text>
                              </Flex>
                            ))}
                          </Stack>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
