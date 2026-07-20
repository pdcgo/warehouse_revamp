import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Flex,
  Heading,
  Icon,
  Spacer,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { PackageSearch } from "lucide-react";

import { orderClient, rpcError } from "../api/clients";
import type { Order } from "../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";
import { OrderStatusBadge } from "../components/OrderStatusBadge";
import { Pagination } from "../components/Pagination";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The crew's day, in the order they work it: what is waiting, what is in hand, what is boxed, what has
// gone. Each tab is a STATE OF THE BUILDING rather than a filter someone chose — which is why "shipped"
// is last and not a tab anybody starts from.
//
// The default is To Pick, deliberately. A picker opening this screen wants the next job, not a history.
const STATUS_TABS = [
  { value: "topick", labelKey: "picking.tab.toPick", status: OrderStatus.CONFIRMED },
  { value: "picking", labelKey: "picking.tab.picking", status: OrderStatus.PICKING },
  { value: "packed", labelKey: "picking.tab.packed", status: OrderStatus.PACKED },
  { value: "shipped", labelKey: "picking.tab.shipped", status: OrderStatus.SHIPPED },
  { value: "all", labelKey: "picking.tab.all", status: OrderStatus.UNSPECIFIED },
];

// PickQueuePage — the orders waiting to be picked at THIS warehouse (#151).
//
// Scoped to the warehouse, not to a selling team: this is the crew's screen, and the crew holds a role
// in the building rather than in the shops it ships for. OrderList matches either end of an order, so
// passing the warehouse's team id is what asks the warehouse question.
export function PickQueuePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState("topick");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Only a WAREHOUSE team has a pick queue. A selling team has orders but no shelves and nobody to walk
  // to them, so the screen says so rather than showing an empty table that looks like a quiet day.
  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const activeTab = STATUS_TABS.find((i) => i.value === tab) ?? STATUS_TABS[0];
  const status = activeTab.status;

  const load = useCallback(async () => {
    if (warehouseId === undefined) return;

    setLoading(true);
    setError("");

    try {
      const res = await orderClient.orderList({
        teamId: warehouseId,
        page: { page, limit: pageSize },
        status,
      });

      setOrders(res.orders);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [warehouseId, page, pageSize, status]);

  useEffect(() => {
    void load();
  }, [load]);

  function selectTab(value: string) {
    setTab(value);
    setPage(1);
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("picking.title")}</Heading>
        <Text color="fg.muted" data-testid="pick-queue-no-team">
          {t("picking.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("picking.title")}</Heading>
        <Text color="fg.muted" data-testid="pick-queue-not-warehouse">
          {t("picking.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("picking.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
      </Flex>

      <Tabs.Root value={tab} onValueChange={(e) => selectTab(e.value)}>
        <Tabs.List>
          {STATUS_TABS.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} data-testid={`pick-tab-${item.value}`}>
              {t(item.labelKey)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value={tab}>
          <Stack gap="card">
            {error && (
              <Text color="red.fg" data-testid="pick-queue-error">
                {error}
              </Text>
            )}

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <Table.Root size="sm" data-testid="pick-queue-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("picking.table.order")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("picking.table.customer")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("picking.table.status")}</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {orders.map((order) => (
                    <Table.Row
                      key={String(order.id)}
                      cursor="pointer"
                      onClick={() => navigate(`/inventories/picking/${order.id}`)}
                      data-testid={`pick-queue-row-${order.id}`}
                    >
                      <Table.Cell>#{String(order.id)}</Table.Cell>
                      <Table.Cell>{order.customerName}</Table.Cell>
                      <Table.Cell>
                        <OrderStatusBadge status={order.status} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}

            {!loading && orders.length === 0 && !error && (
              <Flex align="center" gap="card" color="fg.muted" data-testid="pick-queue-empty">
                <Icon as={PackageSearch} boxSize="4" />
                <Text>
                  {status === OrderStatus.UNSPECIFIED
                    ? t("picking.empty")
                    : t("picking.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })}
                </Text>
              </Flex>
            )}

            {!loading && (
              <Pagination
                count={totalItems}
                pageSize={pageSize}
                page={page}
                onPageChange={setPage}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
              />
            )}
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
