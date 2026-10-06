import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  SegmentGroup,
  Heading,
  Icon,
  Spacer,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowRight, Download, PackageSearch, Printer, ScanLine, Truck, Undo2 } from "lucide-react";
import { Menu, Portal } from "@chakra-ui/react";

import { documentClient, rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import type { Order } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { OrderStatusBadge } from "../../components/badges/OrderStatusBadge";
import { Pagination } from "../../components/chrome/Pagination";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { ShippingSelect } from "../../components/pickers/ShippingSelect";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { ALL_DATES, DateRangePicker, isAllDates, resolveRange } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { CopyText } from "../../components/chrome/CopyText";
import { ShippingBadge } from "../../components/badges/ShippingBadge";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { useTeam } from "../../features/team/TeamContext";
import { useOrders, useOrderStat } from "../../features/orders/queries";
import type { OrderFilters } from "../../features/orders/queries";
import { summariseOrderStat } from "../../features/orders/stat";
import { useTeams } from "../../features/teams/queries";
import { PROCESSED_STEPS } from "../../features/orders/stages";
import {
  AwbCell,
  DateAgoCell,
  DeadlineCell,
  PersonTeamCell,
  ShopRefCell,
} from "../../features/orders/OrderRowCells";
import { deadlineUrgency, hoursFromNow, mockDeadline } from "../../features/orders/deadlineMock";
import { useTypists } from "../../features/orders/typists";
import {
  mockMarketplaceCreated,
  mockQuantity,
  mockReceiptCode,
  mockSellerShop,
} from "../../features/orders/rowMock";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTime, formatUnixRelative } from "../../lib/datetime";
import { useDebounced } from "../../lib/useDebounced";
import { WAREHOUSE_ORDERS_PENDING } from "./pending";
import type { WarehouseStep } from "./steps";
import { commonMoves, isBack, rpcFor, stepLabelKey, stepOfStatus } from "./steps";
import { useStepMove } from "./useStepMove";
import { RowActions } from "./components/RowActions";
import { StepBackDialog } from "./components/StepBackDialog";
import { HandoverScanDialog } from "./components/HandoverScanDialog";
import { FindParcelDialog } from "./components/FindParcelDialog";
import { ValidationScanDialog } from "./components/ValidationScanDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// THE WAREHOUSE'S TABS ARE THE STEPS OF ITS WORK, not the order's statuses (owner —
// `the-warehouse-tabs-are-the-processed-steps`). The order's statuses (Menunggu, Diproses, Dikirim, …)
// are what a seller and a buyer read; inside the building the order is one of the four steps of
// `processed`, preceded by the job the warehouse must accept first, and followed by nothing it acts on.
//
//   Perlu konfirmasi   PLACED — the warehouse's first job, so the screen opens here
//   Dikonfirmasi · Diambil · Dikemas · Sudah diserahkan
//                      the four steps of `processed` — `PROCESSED_STEPS`, the same names the seller's step
//                      filter uses. Handed over has no status yet: disabled, with the ⚠
//   Semua              not a status — no narrowing, for looking an old order up
interface WarehouseTab {
  id: string;
  labelKey: string;
  /** Undefined: a step the contract has no status for. UNSPECIFIED: no narrowing. */
  status?: OrderStatus;
}

const WAREHOUSE_TABS: WarehouseTab[] = [
  { id: "toConfirm", labelKey: "warehouseOrders.tab.toConfirm", status: OrderStatus.PLACED },
  ...PROCESSED_STEPS.map((step) => ({ id: step.id, labelKey: `orders.step.${step.id}`, status: step.status })),
  { id: "all", labelKey: "warehouseOrders.tab.all", status: OrderStatus.UNSPECIFIED },
];

/**
 * The name a row's status badge carries — the tab's, so a row reads what the tab above it says. An order
 * the warehouse is done with keeps its order status's name (Dikirim, Batal).
 */
function warehouseLabelKey(status: OrderStatus): string | undefined {
  const tab = WAREHOUSE_TABS.find((item) => item.status === status && status !== OrderStatus.UNSPECIFIED);
  if (tab) return tab.labelKey;
  if (status === OrderStatus.SHIPPED) return "orders.stage.shipped";
  if (status === OrderStatus.CANCELLED) return "orders.stage.cancel";
  return undefined;
}

/** Whether a handed-over parcel has started moving — a shipment's state, not the order's. */
type ShipmentState = "any" | "notMoving" | "inTransit";
const SHIPMENT_STATES: ShipmentState[] = ["any", "notMoving", "inTransit"];

/** The tabs a handed-over parcel can be listed under — the only ones the shipment filter means anything on. */
const SHIPMENT_TABS = new Set(["handover", "all"]);

/** Every status an order can be in today — what "Semua" counts. */
const EVERY_STATUS = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PICKING,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.CANCELLED,
];

// THE WAREHOUSE'S ORDER LIST — the old system's columns (`the-warehouse-row-is-the-old-systems-columns`),
// a PREVIEW of `/warehouse-orders`.
//
// The owner's row: who wrote it down (person, team) · the storefront (marketplace + shop, the order id
// under it) · the AWB (courier, resi under it) · qty · status · when we wrote it down and how long ago ·
// when the buyer ordered and how long ago — or, when the order has one, the ship-by DEADLINE in place of
// that "ago", loud as it is on the seller's list, with an overdue row tinted. No money anywhere: a
// building that ships for many sellers has no business reading their prices.
//
// ⚠ NOT ROUTED YET — `/warehouse-orders` still opens the pick queue as it was.
export function PickQueueNextPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();

  const [tab, setTab] = useState("toConfirm");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  // ⚠ THE FOUR BELOW REACH NOTHING YET — `OrderListFilter` takes a status, a search, a shop and a date
  // window, and no seller team, marketplace, courier or shipment state. They are on screen so the strip
  // can be judged, each with its ⚠ (`teamFilter`, `marketplaceFilter`, `courierFilter`, `shipmentStatus`).
  const [sellerId, setSellerId] = useState(0n);
  const [marketplace, setMarketplace] = useState<Marketplace>(Marketplace.UNSPECIFIED);
  const [courier, setCourier] = useState("");
  const [shipment, setShipment] = useState<ShipmentState>("any");

  // ── THE WORKBENCH (`a-warehouse-step-moves-by-the-old-systems-table`, `scanning-is-the-crews-hands`) ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [findOrder, setFindOrder] = useState<Order | null>(null);
  const [validateOrder, setValidateOrder] = useState<Order | null>(null);
  // Orders on their way back to the queue — the one move that asks for a reason first.
  const [goingBack, setGoingBack] = useState<Order[] | null>(null);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const debouncedSearch = useDebounced(search.trim());
  const filters: OrderFilters = useMemo(() => {
    const { fromUnix, toUnix } = resolveRange(range);
    return { search: debouncedSearch, shopId: 0n, fromUnix, toUnix };
  }, [debouncedSearch, range]);
  const filterCount = [
    search.trim() !== "",
    !isAllDates(range),
    sellerId > 0n,
    marketplace !== Marketplace.UNSPECIFIED,
    courier !== "",
    shipment !== "any",
  ].filter(Boolean).length;
  const filtered = filterCount > 0;

  const activeTab = WAREHOUSE_TABS.find((item) => item.id === tab) ?? WAREHOUSE_TABS[0]!;
  const status = activeTab.status ?? OrderStatus.UNSPECIFIED;

  const query = useOrders({ teamId: warehouseId, page, pageSize, status, filters });
  const stat = summariseOrderStat(useOrderStat({ teamId: warehouseId, filters }).data);
  const teams = useTeams({ page: 1, pageSize: 200, reference: true });
  const teamName = (id: bigint) => teams.data?.teams.find((team) => team.id === id)?.name ?? "";

  const orders = query.data?.orders ?? [];
  // Who typed each order in — one UserByIDs for the page.
  const typistOf = useTypists(orders);
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending && warehouseId !== undefined;
  const error = query.isError ? rpcError(query.error) : "";

  // The count on a tab — undefined for a step with no status, which shows no number rather than a 0.
  function tabCount(item: WarehouseTab): number | undefined {
    if (item.status === undefined) return undefined;
    if (item.status === OrderStatus.UNSPECIFIED) return EVERY_STATUS.reduce((n, s) => n + stat.count(s), 0);
    return stat.count(item.status);
  }

  const { move } = useStepMove(warehouseId);
  const selectedOrders = orders.filter((order) => selected.has(String(order.id)));
  const allOnPageSelected = orders.length > 0 && orders.every((order) => selected.has(String(order.id)));

  function toggle(id: bigint) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  }

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(orders.map((order) => String(order.id))));
  }

  // A move from a row or the bulk bar. Going BACK asks for a reason first; anything else runs.
  function requestMove(list: Order[], to: WarehouseStep) {
    const back = list.some((order) => {
      const from = stepOfStatus(order.status);
      return from !== undefined && isBack(from, to);
    });

    if (back) {
      setGoingBack(list);
      return;
    }

    void applyMove(list, to);
  }

  async function applyMove(list: Order[], to: WarehouseStep) {
    if (list.length === 1) {
      await move(list[0]!, to);
      return;
    }

    let done = 0;
    let unbuilt = 0;

    for (const order of list) {
      const from = stepOfStatus(order.status);
      if (from && rpcFor(from, to) === undefined) {
        unbuilt += 1;
        continue;
      }
      if (await move(order, to, true)) done += 1;
    }

    if (done > 0) toaster.create({ type: "success", title: `${t("warehouseOrders.moved", { step: t(stepLabelKey(to)) })} (${done})` });
    if (unbuilt > 0) toaster.create({ type: "info", title: t("warehouseOrders.pending.stepMove.reason") });
    setSelected(new Set());
  }

  // ONE label, through a short-lived signed URL fetched on the click — the receipt is a private document.
  async function printOne(order: Order) {
    const documentId = order.receipt?.documentId;
    if (!documentId || warehouseId === undefined) return;

    try {
      const res = await documentClient.getDownloadUrl({ teamId: warehouseId, documentId });
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  function handOverSelected() {
    const packed = selectedOrders.filter((order) => order.status === OrderStatus.PACKED);
    const skipped = selectedOrders.length - packed.length;

    if (skipped > 0) toaster.create({ type: "warning", title: t("warehouseOrders.bulk.skipped", { count: skipped }) });
    // ⚠ One call per parcel (`bulkHandover`).
    if (packed.length > 0) void applyMove(packed, "handover");
  }

  function rowActions(order: Order): ReactNode {
    return (
      <RowActions
        order={order}
        onMove={(to) => requestMove([order], to)}
        onValidate={() => setValidateOrder(order)}
        onFind={() => setFindOrder(order)}
        onPrint={() => void printOne(order)}
        onOpen={() => navigate(`/warehouse-orders/${order.id}`)}
      />
    );
  }

  function sayPending(id: "printMerge" | "exportFile") {
    toaster.create({ type: "info", title: t(`warehouseOrders.pending.${id}.reason`) });
  }

  function refilter(apply: () => void) {
    apply();
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
      <NotImplementedSummary list={WAREHOUSE_ORDERS_PENDING} />

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("picking.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
        <Flex gap="2" wrap="wrap">
          <Button size="xs" variant="outline" data-testid="warehouse-orders-handover" onClick={() => setHandoverOpen(true)}>
            <Icon as={ScanLine} boxSize="4" />
            {t("warehouseOrders.header.scanHandover")}
          </Button>
        </Flex>
      </Flex>

      {/* THE CREW'S FILTERS (owner — `the-warehouse-filters-by-team-marketplace-and-courier`). No "filter
          type" and no second status: one search box looks everywhere, and the steps are the tabs. */}
      <FilterBar
        active={filtered}
        count={filterCount}
        testId="warehouse-orders-filters"
        onClear={() =>
          refilter(() => {
            setSearch("");
            setRange(ALL_DATES);
            setSellerId(0n);
            setMarketplace(Marketplace.UNSPECIFIED);
            setCourier("");
            setShipment("any");
          })
        }
      >
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("orders.searchPlaceholder")}
          testId="warehouse-orders-search"
        />
        <FilterField w="auto">
          <DateRangePicker value={range} onChange={(r) => refilter(() => setRange(r))} testId="warehouse-orders-date" />
        </FilterField>

        {/* WHOSE ORDER — the selling team. A search select: sellers grow with the business. */}
        <FilterField w="15rem" testId="warehouse-orders-team-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <TeamSelect
                teamType={TeamType.SELLING}
                value={sellerId > 0n ? sellerId : undefined}
                placeholder={t("warehouseOrders.filter.team")}
                onChange={(id) => refilter(() => setSellerId(id))}
              />
            </Box>
            <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="teamFilter" />
          </Flex>
        </FilterField>

        <FilterField w="15rem" testId="warehouse-orders-marketplace-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <MarketplaceSelect
                value={marketplace}
                placeholder={t("orders.marketplaceAll")}
                onChange={(m) => refilter(() => setMarketplace(m))}
              />
            </Box>
            <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="marketplaceFilter" />
          </Flex>
        </FilterField>

        {/* THE COURIER — what parcels are grouped by before a pickup. */}
        <FilterField w="15rem" testId="warehouse-orders-courier-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <ShippingSelect
                value={courier}
                placeholder={t("warehouseOrders.filter.courier")}
                onChange={(code) => refilter(() => setCourier(code))}
              />
            </Box>
            <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="courierFilter" />
          </Flex>
        </FilterField>

        {/* WHETHER THE PARCEL HAS STARTED MOVING — it only means something once it has been handed to the
            courier, so it is offered only where such parcels are listed (owner). */}
        {SHIPMENT_TABS.has(tab) && (
          <FilterField w="auto" testId="warehouse-orders-shipment-filter">
            <Flex align="center" gap="1">
              <SegmentGroup.Root
                size="xs"
                value={shipment}
                onValueChange={(e) => e.value && refilter(() => setShipment(e.value as ShipmentState))}
                aria-label={t("warehouseOrders.filter.shipment")}
              >
                <SegmentGroup.Indicator />
                {SHIPMENT_STATES.map((state) => (
                  <SegmentGroup.Item key={state} value={state} data-testid={`warehouse-orders-shipment-${state}`}>
                    <SegmentGroup.ItemText>{t(`warehouseOrders.filter.shipmentState.${state}`)}</SegmentGroup.ItemText>
                    <SegmentGroup.ItemHiddenInput />
                  </SegmentGroup.Item>
                ))}
              </SegmentGroup.Root>
              <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="shipmentStatus" />
            </Flex>
          </FilterField>
        )}
      </FilterBar>

      <Tabs.Root
        value={tab}
        onValueChange={(e) => {
          setTab(e.value);
          // ⚠ The shipment filter belongs to its tabs — carried to another it would filter, invisibly,
          // something nobody can see the control for.
          if (!SHIPMENT_TABS.has(e.value)) setShipment("any");
          setSelected(new Set());
          setPage(1);
        }}
      >
        <Tabs.List flexWrap="wrap" rowGap="1">
          {WAREHOUSE_TABS.map((item) => {
            const count = tabCount(item);

            return (
              <Tabs.Trigger
                key={item.id}
                value={item.id}
                flexShrink="0"
                whiteSpace="nowrap"
                disabled={item.status === undefined}
                data-testid={`pick-tab-${item.id}`}
              >
                {t(item.labelKey)}
                {count !== undefined && (
                  <Badge size="xs" variant="subtle" data-testid={`pick-tab-count-${item.id}`}>
                    {count}
                  </Badge>
                )}
                {item.status === undefined && <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="statusSet" />}
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>
      </Tabs.Root>

          <Stack gap="card">
            {error && (
              <Text color="error.fg" data-testid="pick-queue-error">
                {error}
              </Text>
            )}

            {/* THE ACTION BAR — ON SCREEN FROM THE START (owner: *"aksi yang perlu centang apa tidak bisa muncul
                dari awal saja?"*). An action that waits for a tick says so on the bar instead of appearing
                out of nowhere; Export never waits — with nothing ticked it takes the whole filtered list. */}
            <BulkBar
              count={selectedOrders.length}
              moves={commonMoves(selectedOrders.map((order) => order.status))}
              onMove={(to) => requestMove(selectedOrders, to)}
              onPrint={() => sayPending("printMerge")}
              onHandover={handOverSelected}
              onExport={() => sayPending("exportFile")}
              onClear={() => setSelected(new Set())}
            />

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <RefreshOverlay busy={query.isFetching && !query.isPending}>
                {mobile ? (
                  <Stack gap="2" data-testid="pick-queue-blocks">
                    {orders.map((order) => (
                      <OrderBlock
                        key={String(order.id)}
                        order={order}
                        team={teamName(order.teamId)}
                        typist={typistOf(order.createdByUserId)}
                        selected={selected.has(String(order.id))}
                        onToggle={() => toggle(order.id)}
                        onOpen={() => navigate(`/warehouse-orders/${order.id}`)}
                        actions={rowActions(order)}
                      />
                    ))}
                  </Stack>
                ) : (
                  <Box overflowX="auto" w="full" maxW="full" minW="0">
                    <Table.Root size="sm" data-testid="pick-queue-table">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader w="1">
                            <Checkbox.Root
                              size="sm"
                              checked={allOnPageSelected}
                              onCheckedChange={toggleAll}
                              aria-label={t("warehouseOrders.row.selectAll")}
                              data-testid="pick-queue-select-all"
                            >
                              <Checkbox.HiddenInput />
                              <Checkbox.Control />
                            </Checkbox.Root>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <Flex align="center" gap="1">
                              {t("warehouseOrders.col.createdBy")}
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <Flex align="center" gap="1">
                              {t("warehouseOrders.col.shop")}
                              <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="shop" />
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <Flex align="center" gap="1">
                              {t("warehouseOrders.col.awb")}
                              <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="receiptCode" />
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">
                            <Flex align="center" gap="1" justify="flex-end">
                              {t("orders.qty")}
                              <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="quantity" />
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>{t("picking.table.status")}</Table.ColumnHeader>
                          <Table.ColumnHeader>{t("warehouseOrders.col.created")}</Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <Flex align="center" gap="1">
                              {t("warehouseOrders.col.mpDate")}
                              <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="mpDate" />
                              <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="deadline" />
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader w="1" />
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {orders.map((order) => {
                          const facts = rowFacts(order, teamName(order.teamId));

                          return (
                            <Table.Row
                              key={String(order.id)}
                              cursor="pointer"
                              bg={facts.overdue ? "error.subtle" : undefined}
                              _hover={{ bg: facts.overdue ? "error.muted" : "bg.muted" }}
                              data-overdue={facts.overdue ? "true" : undefined}
                              onClick={() => navigate(`/warehouse-orders/${order.id}`)}
                              data-testid={`pick-queue-row-${order.id}`}
                            >
                              <Table.Cell onClick={(e) => e.stopPropagation()}>
                                <SelectBox id={order.id} checked={selected.has(String(order.id))} onToggle={() => toggle(order.id)} />
                              </Table.Cell>
                              <Table.Cell>
                                <PersonTeamCell person={typistOf(order.createdByUserId)} team={teamName(order.teamId)} />
                              </Table.Cell>
                              <Table.Cell>
                                <ShopRefCell shop={facts.shop} orderRefId={order.orderExternalRefId} />
                              </Table.Cell>
                              <Table.Cell>
                                <AwbCell courier={order.shippingCode} code={facts.resi} />
                              </Table.Cell>
                              <Table.Cell textAlign="end" data-testid={`pick-queue-qty-${order.id}`}>
                                {facts.quantity}
                              </Table.Cell>
                              <Table.Cell>
                                <WarehouseStatusBadge status={order.status} />
                              </Table.Cell>
                              <Table.Cell>
                                <DateAgoCell unix={order.createdAtUnix} testId={`pick-queue-created-${order.id}`} />
                              </Table.Cell>
                              <Table.Cell>
                                <DateAgoCell
                                  unix={facts.mpCreated}
                                  testId={`pick-queue-mp-${order.id}`}
                                  under={facts.deadline !== undefined ? <DeadlineCell unix={facts.deadline} /> : undefined}
                                />
                              </Table.Cell>
                              <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                                {rowActions(order)}
                              </Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </Box>
                )}
              </RefreshOverlay>
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

      <HandoverScanDialog open={handoverOpen} warehouseId={warehouseId} onClose={() => setHandoverOpen(false)} />
      <FindParcelDialog order={findOrder} onClose={() => setFindOrder(null)} />
      <ValidationScanDialog
        order={validateOrder}
        warehouseId={warehouseId}
        onClose={() => setValidateOrder(null)}
        onNext={(order, to) => requestMove([order], to)}
      />
      <StepBackDialog
        open={goingBack !== null}
        count={goingBack?.length ?? 0}
        onClose={() => setGoingBack(null)}
        onConfirm={() => {
          // ⚠ The reason has nowhere to go yet, and neither does the move (`stepMove`).
          const list = goingBack ?? [];
          setGoingBack(null);
          void applyMove(list, "confirm");
        }}
      />
    </Stack>
  );
}

/** The row's invented facts, in one place — each one carries a mark on its column. */
function rowFacts(order: Order, team: string) {
  const back = mockMarketplaceCreated(order.id, order.orderExternalRefId);
  const deadline = mockDeadline(order.id, order.status);

  return {
    shop: mockSellerShop(order.id, order.orderExternalRefId, team),
    resi: mockReceiptCode(order.id, order.status),
    quantity: mockQuantity(order.id),
    mpCreated: back === undefined ? undefined : order.createdAtUnix - back,
    deadline,
    overdue: deadline !== undefined && deadlineUrgency(hoursFromNow(deadline)) === "overdue",
  };
}

/**
 * ONE ORDER ON A PHONE — a block, not seven clamped columns (CLAUDE.md, a phone gets its own
 * arrangement). The status and the deadline lead, because that is what decides which parcel is next.
 */
function OrderBlock({
  order,
  team,
  typist,
  selected,
  onToggle,
  onOpen,
  actions,
}: {
  order: Order;
  team: string;
  /** Who typed it in; "" when that was never recorded. */
  typist: string;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  actions: ReactNode;
}) {
  const { t } = useTranslation();
  const facts = rowFacts(order, team);
  const mark = (id: "shop" | "receiptCode" | "quantity" | "mpDate" | "deadline") => (
    <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id={id} />
  );

  return (
    <Box
      borderWidth="1px"
      borderColor={facts.overdue ? "error.emphasized" : "border"}
      bg={facts.overdue ? "error.subtle" : "bg"}
      borderRadius="l2"
      p="3"
      cursor="pointer"
      onClick={onOpen}
      data-testid={`pick-queue-block-${order.id}`}
      data-overdue={facts.overdue ? "true" : undefined}
    >
      {/* Every invented fact keeps its ⚠ here too — there are no column headers on a phone to carry them. */}
      <Stack gap="1.5">
        <Flex align="center" gap="2" wrap="wrap">
          <Box onClick={(e) => e.stopPropagation()}>
            <SelectBox id={order.id} checked={selected} onToggle={onToggle} />
          </Box>
          <WarehouseStatusBadge status={order.status} />
          {facts.deadline !== undefined && (
            <Flex align="center" gap="1">
              <DeadlineCell unix={facts.deadline} />
              {mark("deadline")}
            </Flex>
          )}
          <Spacer />
          <Flex align="center" gap="1">
            <Text fontSize="xs" color="fg.muted">
              {t("orders.qty")} {facts.quantity}
            </Text>
            {mark("quantity")}
          </Flex>
          <Box onClick={(e) => e.stopPropagation()}>{actions}</Box>
        </Flex>
        <Flex align="center" gap="1.5" minW="0" wrap="wrap">
          {facts.shop && <MarketplaceBadge marketplace={facts.shop.marketplace} size="sm" />}
          <Text fontSize="sm" lineClamp={1}>
            {facts.shop?.name ?? "—"}
          </Text>
          {mark("shop")}
          {order.orderExternalRefId && <CopyText value={order.orderExternalRefId} fontSize="xs" />}
        </Flex>
        <Flex align="center" gap="1.5" wrap="wrap">
          {order.shippingCode && <ShippingBadge code={order.shippingCode} />}
          <CopyText value={facts.resi} mono fontSize="xs" />
          {mark("receiptCode")}
        </Flex>
        <Flex align="center" gap="1" wrap="wrap">
          <Text fontSize="xs" color="fg.muted">
            {typist || "—"} · {team} · {formatUnixDateTime(order.createdAtUnix)} (
            {formatUnixRelative(order.createdAtUnix)})
          </Text>
        </Flex>
        {facts.mpCreated !== undefined && (
          <Flex align="center" gap="1" wrap="wrap">
            <Text fontSize="xs" color="fg.muted">
              {t("warehouseOrders.col.mpDate")} {formatUnixDateTime(facts.mpCreated)} ({formatUnixRelative(facts.mpCreated)})
            </Text>
            {mark("mpDate")}
          </Flex>
        )}
      </Stack>
    </Box>
  );
}

/** The status badge in the warehouse's words — see `warehouseLabelKey`. */
function WarehouseStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const key = warehouseLabelKey(status);

  return <OrderStatusBadge status={status} label={key ? t(key) : undefined} />;
}

function SelectBox({ id, checked, onToggle }: { id: bigint; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();

  return (
    <Checkbox.Root
      size="sm"
      checked={checked}
      onCheckedChange={onToggle}
      aria-label={t("warehouseOrders.row.select", { id: String(id) })}
      data-testid={`pick-queue-select-${id}`}
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
    </Checkbox.Root>
  );
}

/**
 * WHAT CAN BE DONE TO SEVERAL ORDERS AT ONCE — the moves every selected order allows, the labels, the
 * handover of the packed ones, and the export. Always on screen; the actions that need a tick are off,
 * and the bar says why, until one is ticked.
 */
function BulkBar({
  count,
  moves,
  onMove,
  onPrint,
  onHandover,
  onExport,
  onClear,
}: {
  count: number;
  moves: WarehouseStep[];
  onMove: (to: WarehouseStep) => void;
  onPrint: () => void;
  onHandover: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Flex
      align="center"
      gap="2"
      wrap="wrap"
      px="3"
      py="2"
      borderWidth="1px"
      borderColor="border"
      borderRadius="l2"
      bg="bg.subtle"
      data-testid="pick-queue-bulk-bar"
    >
      {count > 0 ? (
        <Text fontSize="sm" fontWeight="bold" me="2" data-testid="pick-queue-bulk-count">
          {t("warehouseOrders.bulk.selected", { count })}
        </Text>
      ) : (
        // WHY the buttons beside it are off — beside the disabled things, never left to be guessed.
        <Text fontSize="sm" color="fg.muted" me="2" data-testid="pick-queue-bulk-hint">
          {t("warehouseOrders.bulk.hint")}
        </Text>
      )}

      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="xs" variant="outline" disabled={count === 0 || moves.length === 0} data-testid="pick-queue-bulk-move">
            <Icon as={ArrowRight} boxSize="4" />
            {t("warehouseOrders.bulk.changeStep")}
            <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="stepMove" />
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content>
              {moves.map((to) => (
                <Menu.Item key={to} value={to} data-testid={`pick-queue-bulk-move-${to}`} onClick={() => onMove(to)}>
                  <Icon as={to === "confirm" ? Undo2 : ArrowRight} boxSize="4" />
                  {t(to === "confirm" ? "warehouseOrders.row.backTo" : "warehouseOrders.row.moveTo", {
                    step: t(stepLabelKey(to)),
                  })}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <Button size="xs" variant="outline" disabled={count === 0} data-testid="pick-queue-bulk-print" onClick={onPrint}>
        <Icon as={Printer} boxSize="4" />
        {t("warehouseOrders.bulk.print")}
        <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="printMerge" />
      </Button>

      <Button size="xs" variant="outline" disabled={count === 0} data-testid="pick-queue-bulk-handover" onClick={onHandover}>
        <Icon as={Truck} boxSize="4" />
        {t("warehouseOrders.bulk.handover")}
        <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="bulkHandover" />
      </Button>

      {/* Never off: the selection when there is one, else every order the filters show. */}
      <Button size="xs" variant="outline" colorPalette="gray" data-testid="pick-queue-bulk-export" onClick={onExport}>
        <Icon as={Download} boxSize="4" />
        {count > 0 ? t("warehouseOrders.bulk.exportSelected", { count }) : t("warehouseOrders.bulk.exportAll")}
        <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="exportFile" />
      </Button>

      <Spacer />
      {count > 0 && (
        <Button size="xs" variant="ghost" data-testid="pick-queue-bulk-clear" onClick={onClear}>
          {t("warehouseOrders.bulk.clear")}
        </Button>
      )}
    </Flex>
  );
}
