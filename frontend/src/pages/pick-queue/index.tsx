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
  Heading,
  Icon,
  Spacer,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowRight, Download, PackageOpen, PackageSearch, Printer, ScanBarcode, ScanLine, SearchX, Truck, Undo2 } from "lucide-react";
import { Menu, Portal } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import type { Order } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { CompactActions } from "../../components/chrome/CompactActions";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { MARKETPLACES, MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { ALL_DATES, DateRangePicker, isAllDates, resolveRange } from "../../components/datetime/DateRangePicker";
import { CopyText } from "../../components/chrome/CopyText";
import { OrderCourierBadge } from "../../features/orders/OrderCourierBadge";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useOrderLabels } from "../../features/orders/labels";
import { useOrders, useOrderStat } from "../../features/orders/queries";
import { OrderExportView, useOrderExport } from "../../features/orders/useOrderExport";
import type { OrderFilters } from "../../features/orders/queries";
import { summariseOrderStat } from "../../features/orders/stat";
import { useTeams } from "../../features/teams/queries";
import { ORDER_STATUSES } from "../../components/badges/OrderStatusBadge";
import {
  AwbCell,
  DateAgoCell,
  DeadlineCell,
  PersonTeamCell,
  ShopRefCell,
} from "../../features/orders/OrderRowCells";
import { deadlineUrgency, hoursFromNow, orderDeadline, orderPlatformDate } from "../../features/orders/deadline";
import { useTypists } from "../../features/orders/typists";
import { NO_SHOPS, useShopsByIds, type ShopNames } from "../../features/shops/queries";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTimeShort, formatUnixRelative } from "../../lib/datetime";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, enumCodec, idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";
import type { WarehouseStep } from "./steps";
import { commonMoves, isBack, stepLabelKey, stepOfStatus } from "./steps";
import type { WarehouseTab } from "./tabs";
import { WAREHOUSE_TABS } from "./tabs";
import { useStepMove } from "./useStepMove";
import { RowActions } from "./components/RowActions";
import { StepBackDialog } from "./components/StepBackDialog";
import { HandoverScanDialog } from "./components/HandoverScanDialog";
import { FindParcelDialog } from "./components/FindParcelDialog";
import { ReceiveReturnDialog } from "./components/ReceiveReturnDialog";
import { ScanLabelDialog } from "./components/ScanLabelDialog";
import { WarehouseStatusBadge } from "./components/WarehouseStatusBadge";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// Every tab is a status (or two) now, so any of them is read back from the URL — Retur included
// (the-warehouse-list-has-a-returns-tab).
const TAB_CODEC = oneOfCodec(WAREHOUSE_TABS.map((item) => item.id));
const MARKETPLACE_CODEC = enumCodec(MARKETPLACES);

/** Every status an order can be in — what "Semua" counts. */
const EVERY_STATUS = ORDER_STATUSES.map((meta) => meta.status);

// THE WAREHOUSE'S ORDER LIST — `/warehouse-orders`, the crew's screen, with the old system's columns
// (`the-warehouse-row-is-the-old-systems-columns`), accepted as the design with its gaps closed
// (`the-warehouse-order-list-is-accepted`).
//
// The owner's row: who wrote it down (person, team) · the storefront (marketplace + shop, the order id
// under it) · the AWB (courier, resi under it) · qty · status · when we wrote it down and how long ago ·
// when the buyer ordered and how long ago — or, when the order has one, the ship-by DEADLINE in place of
// that "ago", loud as it is on the seller's list, with an overdue row tinted. No money anywhere: a
// building that ships for many sellers has no business reading their prices.
//
// THE GAPS IT WENT LIVE WITH CLOSED:
//   · Set Picked is the pick page's, after every line is scanned exact — no row menu or Change Step offers it
//     (the-item-scans-live-on-the-page); the item scan lives on that one page, opened by Scan Label
//     (the-pick-page-opens-first-by-the-label, scan-label-opens-the-pick-page);
//   · a label is looked up on the server, every match shown, cancelled ones skipped — Scan Label and the handover alike
//     (two-orders-on-one-label-are-shown-not-chosen);
//   · Retur after Sudah diserahkan, with Receive a Return in the header (the-warehouse-list-has-a-returns-tab);
//   · a monitoring team reads it all and writes nothing (canWrite, as the old page had it).
export function PickQueuePage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const mobile = useIsMobile();

  // THE STEP TAB AND THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from an
  // order, opens the same narrowed list. The selection, the page and the dialogs do not.
  const [tab, setTab] = useUrlState("step", "toConfirm", TAB_CODEC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [range, setRange] = useUrlState("range", ALL_DATES, dateRangeCodec);
  // The crew's three filters — seller team, marketplace, courier (the-filter-gains-seller-marketplace-and-courier).
  // The shipment-state switch is gone: the status tabs are it.
  const [sellerId, setSellerId] = useUrlState("team", 0n, idCodec);
  const [marketplace, setMarketplace] = useUrlState("marketplace", Marketplace.UNSPECIFIED, MARKETPLACE_CODEC);
  // The courier is its shipment channel id (shipment-channel-is-an-id-into-shipment-service).
  const [courier, setCourier] = useUrlState("courier", 0n, idCodec);

  // ── THE WORKBENCH (`a-warehouse-step-moves-by-the-old-systems-table`, `scanning-is-the-crews-hands`) ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [findOrder, setFindOrder] = useState<Order | null>(null);
  // SCAN LABEL (scan-label-opens-the-pick-page) and RECEIVE A RETURN (a-return-is-received-by-search-then-forced).
  const [scanLabelOpen, setScanLabelOpen] = useState(false);
  const [receiving, setReceiving] = useState(false);
  // Orders on their way back to the queue — the one move that asks for a reason first.
  const [goingBack, setGoingBack] = useState<Order[] | null>(null);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;
  // The warehouse's Owner, Admin and Staff move orders and receive returns; a monitoring team reads only
  // (the-admin-team-monitors-read-only). Printing and exporting are reads, so they stay.
  const mayWrite = canWrite(current);
  const { openLabel, printLabels, opening: printing } = useOrderLabels();

  const debouncedSearch = useDebounced(search.trim());
  const filters: OrderFilters = useMemo(() => {
    const { fromUnix, toUnix } = resolveRange(range);
    return {
      search: debouncedSearch,
      shopId: 0n,
      fromUnix,
      toUnix,
      sellerTeamId: sellerId,
      marketplace,
      shipmentChannelId: courier,
    };
  }, [debouncedSearch, range, sellerId, marketplace, courier]);
  const filterCount = [
    search.trim() !== "",
    !isAllDates(range),
    sellerId > 0n,
    marketplace !== Marketplace.UNSPECIFIED,
    courier > 0n,
  ].filter(Boolean).length;
  const filtered = filterCount > 0;

  const activeTab = WAREHOUSE_TABS.find((item) => item.id === tab) ?? WAREHOUSE_TABS[0]!;
  const status = activeTab.status ?? OrderStatus.UNSPECIFIED;
  // Retur is two statuses at once — return and return_completed.
  const statuses = activeTab.statuses;

  const query = useOrders({ teamId: warehouseId, page, pageSize, status, statuses, filters });
  const stat = summariseOrderStat(useOrderStat({ teamId: warehouseId, filters }).data);
  const teams = useTeams({ page: 1, pageSize: 200, reference: true });
  const teamName = (id: bigint) => teams.data?.teams.find((team) => team.id === id)?.name ?? "";
  // The page's shops, named across teams in one read (the-warehouse-row-fills-from-shop-and-user-by-ids).
  const shopNames = useShopsByIds({ shopIds: (query.data?.orders ?? []).map((order) => order.shopId) }).data ?? NO_SHOPS;

  const orders = query.data?.orders ?? [];
  // Who typed each order in — one UserByIDs for the page.
  const typistOf = useTypists(orders);
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending && warehouseId !== undefined;
  const error = query.isError ? rpcError(query.error) : "";

  // The count on a tab — Retur's is its two statuses together, Semua's every status.
  function tabCount(item: WarehouseTab): number | undefined {
    if (item.status === undefined) return undefined;
    if (item.statuses) return item.statuses.reduce((n, s) => n + stat.count(s), 0);
    if (item.status === OrderStatus.UNSPECIFIED) return EVERY_STATUS.reduce((n, s) => n + stat.count(s), 0);
    return stat.count(item.status);
  }

  const { move } = useStepMove(warehouseId);
  const selectedOrders = orders.filter((order) => selected.has(String(order.id)));
  const exporter = useOrderExport();
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

  // ONE CALL for the whole list, each order with its own result — the toast says what did not move.
  async function applyMove(list: Order[], to: WarehouseStep, note = "") {
    await move(list, to, { note });
    setSelected(new Set());
  }

  // ONE label, through a short-lived signed URL fetched on the click — the receipt is the SELLER's private document, so
  // the warehouse asks the order for it (OrderLabels, a-warehouse-prints-the-labels-of-orders-it-ships).
  async function printOne(order: Order) {
    if (warehouseId === undefined) return;

    await openLabel({ teamId: warehouseId, teamType: TeamType.WAREHOUSE, order });
  }

  // THE TICKED ROWS' LABELS AS ONE PDF — the same OrderLabels with every ticked id, in the list's order; the server
  // merges them and names each order it left out.
  function printSelected() {
    void printLabels({ teamId: warehouseId, orders: selectedOrders });
  }

  function handOverSelected() {
    const picked = selectedOrders.filter((order) => order.status === OrderStatus.PICKED);
    const skipped = selectedOrders.length - picked.length;

    if (skipped > 0) toaster.create({ type: "warning", title: t("warehouseOrders.bulk.skipped", { count: skipped }) });
    if (picked.length > 0) void applyMove(picked, "handover");
  }

  function rowActions(order: Order): ReactNode {
    return (
      <RowActions
        order={order}
        canMove={mayWrite}
        onMove={(to) => requestMove([order], to)}
        onFind={() => setFindOrder(order)}
        onPrint={() => void printOne(order)}
        onOpen={() => navigate(`/warehouse-orders/${order.id}`)}
      />
    );
  }

  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // The strip's Hapus Filter and the empty hint's are one function (an-empty-list-shows-a-hint).
  function clearFilters() {
    refilter(() => {
      setSearch("");
      setRange(ALL_DATES);
      setSellerId(0n);
      setMarketplace(Marketplace.UNSPECIFIED);
      setCourier(0n);
    });
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
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter">
      {/* A PHONE'S HEADER IS ONE ROW (the-phone-header-is-one-row), its actions their icons — past two they fold into ⋯
          (a-phone-header-action-is-an-icon); the desktop keeps the labelled buttons. Scan Label first: it is how the crew
          opens an order (scan-label-opens-the-pick-page), and it only reads, so a monitor has it too. It is PINNED — always
          its own icon, the others behind ⋯ (scan-label-stays-an-icon-on-a-phone). */}
      <Flex align="center" gap="card" wrap={mobile ? "nowrap" : "wrap"} data-testid="warehouse-orders-header">
        <Heading size="md" flexShrink={0}>
          {t("picking.title")}
        </Heading>
        <Badge colorPalette="brand" truncate minW="0">
          {current.teamName}
        </Badge>
        <Spacer />
        {mobile ? (
          <CompactActions
            menuLabel={t("orders.actions")}
            menuTestId="warehouse-orders-actions"
            actions={[
              {
                id: "scanLabel",
                label: t("warehouseOrders.header.scanLabel"),
                icon: ScanBarcode,
                testId: "warehouse-orders-scan-label",
                pinned: true,
                onClick: () => setScanLabelOpen(true),
              },
              mayWrite && {
                id: "handover",
                label: t("warehouseOrders.header.scanHandover"),
                icon: ScanLine,
                testId: "warehouse-orders-handover",
                onClick: () => setHandoverOpen(true),
              },
              mayWrite && {
                id: "receive",
                label: t("picking.action.receiveReturn"),
                icon: PackageOpen,
                primary: true,
                testId: "pick-queue-receive",
                onClick: () => setReceiving(true),
              },
            ]}
          />
        ) : (
          <Flex align="center" gap="2" wrap="wrap">
            <Button
              size="xs"
              variant="outline"
              data-testid="warehouse-orders-scan-label"
              onClick={() => setScanLabelOpen(true)}
            >
              <Icon as={ScanBarcode} boxSize="4" />
              {t("warehouseOrders.header.scanLabel")}
            </Button>
            {mayWrite && (
              <Button size="xs" variant="outline" data-testid="warehouse-orders-handover" onClick={() => setHandoverOpen(true)}>
                <Icon as={ScanLine} boxSize="4" />
                {t("warehouseOrders.header.scanHandover")}
              </Button>
            )}
            {/* RECEIVE A RETURN (a-return-is-received-by-search-then-forced) — the parcel came back to the door. */}
            {mayWrite && (
              <Button size="xs" colorPalette="brand" data-testid="pick-queue-receive" onClick={() => setReceiving(true)}>
                <Icon as={PackageOpen} boxSize="4" />
                {t("picking.action.receiveReturn")}
              </Button>
            )}
          </Flex>
        )}
      </Flex>

      {/* THE CREW'S FILTERS (owner — `the-warehouse-filters-by-team-marketplace-and-courier`). No "filter
          type" and no second status: one search box looks everywhere, and the steps are the tabs. */}
      <FilterBar
        active={filtered}
        count={filterCount}
        testId="warehouse-orders-filters"
        onClear={clearFilters}
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
          <TeamSelect
            teamType={TeamType.SELLING}
            value={sellerId > 0n ? sellerId : undefined}
            placeholder={t("warehouseOrders.filter.team")}
            // Every option is a selling team — the pick reads as its name alone (a-one-type-picker-shows-the-name-alone).
            showType={false}
            onChange={(id) => refilter(() => setSellerId(id))}
          />
        </FilterField>

        <FilterField w="15rem" testId="warehouse-orders-marketplace-filter">
          <MarketplaceSelect
            value={marketplace}
            placeholder={t("orders.marketplaceAll")}
            onChange={(m) => refilter(() => setMarketplace(m))}
          />
        </FilterField>

        {/* THE COURIER — what parcels are grouped by before a pickup. */}
        <FilterField w="15rem" testId="warehouse-orders-courier-filter">
          <ShipmentChannelSelect
            value={courier}
            placeholder={t("warehouseOrders.filter.courier")}
            onChange={(channelId) => refilter(() => setCourier(channelId))}
          />
        </FilterField>

      </FilterBar>

      <Tabs.Root
        value={tab}
        onValueChange={(e) => {
          setTab(e.value);
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
                data-testid={`pick-tab-${item.id}`}
              >
                {t(item.labelKey)}
                {count !== undefined && (
                  <Badge size="xs" variant="subtle" data-testid={`pick-tab-count-${item.id}`}>
                    {count}
                  </Badge>
                )}
              </Tabs.Trigger>
            );
          })}

          {/* One underline, sliding to the picked tab (motion-is-small-quick-and-shared). The rows under it do not
              fade: a tab here narrows the list (a-filter-answers-as-it-changes). */}
          <Tabs.Indicator />
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
              canWrite={mayWrite}
              moves={commonMoves(selectedOrders.map((order) => order.status))}
              onMove={(to) => requestMove(selectedOrders, to)}
              onPrint={printSelected}
              printing={printing}
              onHandover={handOverSelected}
              exportLabel={
                exporter.progress
                  ? t("orders.export.running", { done: exporter.progress.done, total: exporter.progress.total })
                  : undefined
              }
              onExport={() =>
                warehouseId !== undefined &&
                void exporter.start({
                  teamId: warehouseId,
                  filters,
                  status,
                  view: OrderExportView.WAREHOUSE,
                  // The bar's selection when there is one, else every row the filters show
                  // (the-bulk-actions-are-always-on-screen).
                  orderIds: selectedOrders.map((order) => order.id),
                  statuses,
                })
              }
              onClear={() => setSelected(new Set())}
            />

            {/* The first load shows the rows' shape, never a spinner on an empty page (motion-is-small-quick-and-shared). */}
            {loading ? (
              <ListSkeleton testId="pick-queue-loading" />
            ) : (
              <RefreshOverlay busy={query.isFetching && !query.isPending}>
                {mobile ? (
                  <Stack gap="2" data-testid="pick-queue-blocks">
                    {orders.map((order) => (
                      <OrderBlock
                        key={String(order.id)}
                        order={order}
                        team={teamName(order.teamId)}
                        shops={shopNames}
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
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>
                            <Flex align="center" gap="1">
                              {t("warehouseOrders.col.awb")}
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">
                            <Flex align="center" gap="1" justify="flex-end">
                              {t("orders.qty")}
                            </Flex>
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>{t("picking.table.status")}</Table.ColumnHeader>
                          <Table.ColumnHeader>{t("warehouseOrders.col.created")}</Table.ColumnHeader>
                          <Table.ColumnHeader>
                            {t("warehouseOrders.col.mpDate")}
                          </Table.ColumnHeader>
                          <Table.ColumnHeader w="1" />
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {orders.map((order) => {
                          const facts = rowFacts(order, shopNames);

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
                                <AwbCell channelId={order.shipmentChannelId} code={facts.resi} />
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

            {/* WHICH EMPTINESS (an-empty-list-shows-a-hint): a filter that matches nothing says so and clears from here;
                an empty step keeps the sentence the screen said before, and the test id stays on it. */}
            {!loading && orders.length === 0 && !error && (
              <EmptyHint
                icon={filtered ? SearchX : PackageSearch}
                title={
                  filtered
                    ? t("orders.noOrdersMatching")
                    : statuses
                      ? t("warehouseOrders.emptyReturns")
                      : status === OrderStatus.UNSPECIFIED
                        ? t("picking.empty")
                        : t("picking.emptyFiltered", { status: t(activeTab.labelKey).toLowerCase() })
                }
                description={
                  filtered
                    ? t("emptyHint.noMatch")
                    : status === OrderStatus.UNSPECIFIED && !statuses
                      ? t("orders.noWarehouseOrdersHint")
                      : undefined
                }
                action={
                  filtered ? (
                    <Button size="xs" variant="outline" data-testid="pick-queue-empty-clear" onClick={clearFilters}>
                      {t("orders.clearFilters")}
                    </Button>
                  ) : undefined
                }
                testId="pick-queue-empty"
              />
            )}

            {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-pager,
                the-pager-is-always-on-screen). A new tab, filter or page size starts the trail over. */}
            {!loading && (
              <GrowingPager
                page={page}
                onPageChange={setPage}
                hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
                resetKey={[tab, debouncedSearch, JSON.stringify(range), sellerId, marketplace, courier, pageSize].join("|")}
                pageSize={pageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
                testId="pick-queue-pager"
              />
            )}
          </Stack>

      <ScanLabelDialog open={scanLabelOpen} warehouseId={warehouseId} onClose={() => setScanLabelOpen(false)} />
      {mayWrite && (
        <HandoverScanDialog open={handoverOpen} warehouseId={warehouseId} onClose={() => setHandoverOpen(false)} />
      )}
      {mayWrite && <ReceiveReturnDialog open={receiving} onOpenChange={setReceiving} warehouseId={current.teamId} />}
      <FindParcelDialog order={findOrder} onClose={() => setFindOrder(null)} />
      <StepBackDialog
        open={goingBack !== null}
        count={goingBack?.length ?? 0}
        onClose={() => setGoingBack(null)}
        onConfirm={(reason) => {
          // The reason travels with the move and is kept on each order's history.
          const list = goingBack ?? [];
          setGoingBack(null);
          void applyMove(list, "toConfirm", reason);
        }}
      />
    </Stack>
  );
}

/** The row's facts in one place — every one of them the order's own now. */
function rowFacts(order: Order, shops: ShopNames) {
  // The marketplace's ship-by time while the parcel is still here; nothing once it has left.
  const deadline = orderDeadline(order);

  return {
    // ShopByIds, one read per page (the-warehouse-row-fills-from-shop-and-user-by-ids).
    shop: shops.get(order.shopId.toString()),
    // The tracking number typed at create (`receipt_code`); "" when nobody recorded one.
    resi: order.receiptCode,
    // Summed by the list query — the lines themselves never travel with a list.
    quantity: Number(order.itemQuantity),
    // When the buyer ordered on the storefront.
    mpCreated: orderPlatformDate(order),
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
  shops,
  typist,
  selected,
  onToggle,
  onOpen,
  actions,
}: {
  order: Order;
  team: string;
  /** The page's shops by id, from ShopByIds. */
  shops: ShopNames;
  /** Who typed it in; "" when that was never recorded. */
  typist: string;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  actions: ReactNode;
}) {
  const { t } = useTranslation();
  const facts = rowFacts(order, shops);

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
      <Stack gap="1.5">
        <Flex align="center" gap="2" wrap="wrap">
          <Box onClick={(e) => e.stopPropagation()}>
            <SelectBox id={order.id} checked={selected} onToggle={onToggle} />
          </Box>
          <WarehouseStatusBadge status={order.status} />
          {facts.deadline !== undefined && (
            <DeadlineCell unix={facts.deadline} />
          )}
          <Spacer />
          <Flex align="center" gap="1">
            <Text fontSize="xs" color="fg.muted">
              {t("orders.qty")} {facts.quantity}
            </Text>
          </Flex>
          <Box onClick={(e) => e.stopPropagation()}>{actions}</Box>
        </Flex>
        <Flex align="center" gap="1.5" minW="0" wrap="wrap">
          {facts.shop && <MarketplaceBadge marketplace={facts.shop.marketplace} size="sm" />}
          <Text fontSize="sm" lineClamp={1}>
            {facts.shop?.name ?? "—"}
          </Text>
          {order.orderExternalRefId && <CopyText value={order.orderExternalRefId} fontSize="xs" />}
        </Flex>
        <Flex align="center" gap="1.5" wrap="wrap">
          {order.shipmentChannelId > 0n && <OrderCourierBadge channelId={order.shipmentChannelId} />}
          {facts.resi && <CopyText value={facts.resi} mono fontSize="xs" />}
        </Flex>
        <Flex align="center" gap="1" wrap="wrap">
          <Text fontSize="xs" color="fg.muted">
            {typist || "—"} · {team} · {formatUnixDateTimeShort(order.createdAtUnix)} (
            {formatUnixRelative(order.createdAtUnix)})
          </Text>
        </Flex>
        {facts.mpCreated !== undefined && (
          <Text fontSize="xs" color="fg.muted">
            {t("warehouseOrders.col.mpDate")} {formatUnixDateTimeShort(facts.mpCreated)} ({formatUnixRelative(facts.mpCreated)})
          </Text>
        )}
      </Stack>
    </Box>
  );
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
 * handover of the picked ones, and the export. Always on screen; the actions that need a tick are off,
 * and the bar says why, until one is ticked. A monitoring team gets the two that only read: the labels
 * and the export.
 *
 * ⚠ CHANGE STEP NEVER OFFERS SUDAH DIAMBIL (the-item-scans-live-on-the-page): `moves` comes from the step table, which
 * leaves processed → picked to the pick page's Set Picked.
 */
function BulkBar({
  count,
  canWrite: mayWrite,
  moves,
  onMove,
  onPrint,
  printing = false,
  onHandover,
  onExport,
  exportLabel,
  onClear,
}: {
  count: number;
  /** Whether this person may move orders — false for a team they only monitor. */
  canWrite: boolean;
  moves: WarehouseStep[];
  onMove: (to: WarehouseStep) => void;
  onPrint: () => void;
  /** A print of the ticked labels is on its way. */
  printing?: boolean;
  onHandover: () => void;
  onExport: () => void;
  /** "Exporting 200 / 456" while an export runs; undefined otherwise. */
  exportLabel?: string;
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

      {mayWrite && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="xs" variant="outline" disabled={count === 0 || moves.length === 0} data-testid="pick-queue-bulk-move">
              <Icon as={ArrowRight} boxSize="4" />
              {t("warehouseOrders.bulk.changeStep")}
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                {moves.map((to) => (
                  <Menu.Item key={to} value={to} data-testid={`pick-queue-bulk-move-${to}`} onClick={() => onMove(to)}>
                    <Icon as={to === "toConfirm" ? Undo2 : ArrowRight} boxSize="4" />
                    {t(to === "toConfirm" ? "warehouseOrders.row.backTo" : "warehouseOrders.row.moveTo", {
                      step: t(stepLabelKey(to)),
                    })}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      )}

      {/* One PDF of every ticked order's label (a-warehouse-prints-the-labels-of-orders-it-ships). */}
      <Button
        size="xs"
        variant="outline"
        disabled={count === 0}
        loading={printing}
        data-testid="pick-queue-bulk-print"
        onClick={onPrint}
      >
        <Icon as={Printer} boxSize="4" />
        {t("warehouseOrders.bulk.print")}
      </Button>

      {mayWrite && (
        <Button size="xs" variant="outline" disabled={count === 0} data-testid="pick-queue-bulk-handover" onClick={onHandover}>
          <Icon as={Truck} boxSize="4" />
          {t("warehouseOrders.bulk.handover")}
        </Button>
      )}

      {/* Never off: the selection when there is one, else every order the filters show. */}
      <Button
        size="xs"
        variant="outline"
        colorPalette="gray"
        data-testid="pick-queue-bulk-export"
        loading={exportLabel !== undefined}
        loadingText={exportLabel}
        onClick={onExport}
      >
        <Icon as={Download} boxSize="4" />
        {count > 0 ? t("warehouseOrders.bulk.exportSelected", { count }) : t("warehouseOrders.bulk.exportAll")}
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
