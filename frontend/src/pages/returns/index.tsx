import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Flex, Heading, Icon, Spacer, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { PackageOpen, SearchX, Undo2 } from "lucide-react";

import { CompactActions } from "../../components/chrome/CompactActions";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { ALL_DATES, DateRangePicker, isAllDates, resolveRange } from "../../components/datetime/DateRangePicker";
import { TeamItem } from "../../components/entity/TeamItem";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { MARKETPLACES, MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { TeamSelect } from "../../components/teams/TeamSelect";
import { AwbCell, DateAgoCell, ShopRefCell } from "../../features/orders/OrderRowCells";
import type { OrderFilters } from "../../features/orders/queries";
import { useOrders, useOrderStat } from "../../features/orders/queries";
import { ReceiveReturnDialog } from "../../features/orders/ReceiveReturnDialog";
import { useOpenReturnAccept } from "../../features/orders/returnAccept";
import { summariseOrderStat } from "../../features/orders/stat";
import { NO_SHOPS, useShopsByIds } from "../../features/shops/queries";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { Order } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderDateField, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useIsMobile } from "../../layouts/shell";
import { fromHere } from "../../lib/cameFrom";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, enumCodec, idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";
import { ReturnAcceptButton, ReturnBlock, ReturnStateCell } from "./components/ReturnRow";

// INVENTARIS › RETUR — THE WAREHOUSE'S REAL LIST OF RETURNS (the-retur-menu-is-the-warehouses-return-list, accepted as
// drawn in the-retur-list-prototype-is-accepted, docs/business/inventory/return_decision.md). Built on the order reads
// the warehouse list already makes — `OrderList` / `OrderStat`, no new request:
//
//   OrderList(team_id = this warehouse,
//             filter { statuses: [RETURN] | [RETURN_COMPLETED] | both      ← the tab
//                      date_field: ORDER_DATE_FIELD_ENTERED_RETURN         ← always: fills the row's `date_entered_at_unix`
//                                                                            (when the return was ASKED); the window reads it
//                      created_from/to_unix, search, seller_team_id, marketplace, shipment_channel_id },
//             page)
//   OrderStat(team_id, the same filter)                                    → the tabs' counts (return, return_completed)
//
// THE SCOPE IS THE SERVER'S (`orderReaders`, selling_v1/order_list.go): the orders this warehouse SHIPS and — for a return
// only — those of the selling teams whose configured return warehouse it is (a-return-may-land-in-another-warehouse).
// With the two return statuses that is exactly *shipped from here or returning here*. A return that never arrives goes
// `lost` (a-return-that-never-arrives-goes-lost) and leaves this list. No money (a-warehouse-sees-no-seller-money).
//
// WHERE A ROW GOES:
//   waiting  → the accept page (the-return-accept-page-is-accepted), carrying the list's address so its Back and its
//              Accept come back to the same narrowed list; a return addressed elsewhere opens it too, and the page says
//              where it goes
//   accepted → the order's page (`/warehouse-orders/:id`), where the accept's note names what was broken or missing
//   a monitor (no writes) → the order's page always: the accept page is a write, turned away at its door

type StateTab = "waiting" | "accepted" | "all";

const STATE_TABS: { id: StateTab; labelKey: string; statuses: OrderStatus[] }[] = [
  { id: "waiting", labelKey: "returnList.tab.waiting", statuses: [OrderStatus.RETURN] },
  { id: "accepted", labelKey: "returnList.tab.accepted", statuses: [OrderStatus.RETURN_COMPLETED] },
  { id: "all", labelKey: "returnList.tab.all", statuses: [OrderStatus.RETURN, OrderStatus.RETURN_COMPLETED] },
];

const TAB_CODEC = oneOfCodec(STATE_TABS.map((tab) => tab.id));
const MARKETPLACE_CODEC = enumCodec(MARKETPLACES);
const PAGE_SIZE_OPTIONS = [10, 20, 50];

export function ReturnsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useIsMobile();
  const openAccept = useOpenReturnAccept();

  // THE STATE TAB AND THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — Back from the accept page or an
  // order, or a reload, opens the same narrowed list. The page does not.
  const [tab, setTab] = useUrlState<StateTab>("state", "waiting", TAB_CODEC);
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [range, setRange] = useUrlState("range", ALL_DATES, dateRangeCodec);
  const [sellerId, setSellerId] = useUrlState("team", 0n, idCodec);
  const [marketplace, setMarketplace] = useUrlState("marketplace", Marketplace.UNSPECIFIED, MARKETPLACE_CODEC);
  const [courier, setCourier] = useUrlState("courier", 0n, idCodec);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [receiving, setReceiving] = useState(false);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;
  // The warehouse's Owner, Admin and Staff accept and receive; a monitoring team reads only (the-admin-team-monitors-read-only).
  const mayWrite = canWrite(current);

  const debouncedSearch = useDebounced(search.trim());
  // ONE filter for the list and the counts, so a tab's number describes the rows under it.
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
      // ALWAYS when the return was asked: it fills the row's asked date, and the window reads it.
      dateField: OrderDateField.ENTERED_RETURN,
    };
  }, [debouncedSearch, range, sellerId, marketplace, courier]);
  const filterKey = [debouncedSearch, JSON.stringify(range), sellerId, marketplace, courier].join("|");
  const filterCount = [search.trim() !== "", !isAllDates(range), sellerId > 0n, marketplace !== Marketplace.UNSPECIFIED, courier > 0n].filter(
    Boolean,
  ).length;
  const filtered = filterCount > 0;

  const activeTab = STATE_TABS.find((item) => item.id === tab) ?? STATE_TABS[0]!;

  // OrderList — the tab is `statuses`; `status` stays unset (UNSPECIFIED is no filter). Paged (HARD RULE 9).
  const query = useOrders({
    teamId: warehouseId,
    page,
    pageSize,
    status: OrderStatus.UNSPECIFIED,
    statuses: activeTab.statuses,
    filters,
  });
  // OrderStat — the tabs' counts, over the filters but never the tab.
  const statQuery = useOrderStat({ teamId: warehouseId, filters });
  const stat = statQuery.data ? summariseOrderStat(statQuery.data) : undefined;

  const orders = query.data?.orders ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending && warehouseId !== undefined;
  const shopNames = useShopsByIds({ shopIds: orders.map((order) => order.shopId) }).data ?? NO_SHOPS;
  // The sellers and the return warehouses the page names, in one TeamByIds.
  const names = useTeamsByIds({ ids: orders.flatMap((order) => [order.teamId, order.returnWarehouseId]) }).data;
  const teamName = (id: bigint) => names?.[id.toString()]?.name ?? (id > 0n ? `#${id}` : "");

  function tabCount(item: (typeof STATE_TABS)[number]): number | undefined {
    if (!stat) return undefined;
    return item.statuses.reduce((n, s) => n + stat.count(s), 0);
  }

  // A WAITING RETURN OPENS THE ACCEPT PAGE (the-retur-menu-is-the-warehouses-return-list); an accepted one, and every row
  // for a monitor, the order's page (the-retur-list-prototype-is-accepted).
  function openRow(order: Order) {
    if (order.status === OrderStatus.RETURN && mayWrite) {
      openAccept(order.id);
      return;
    }
    navigate(`/warehouse-orders/${order.id}`, { state: fromHere(location) });
  }

  /** Where a return of this order goes, when it is not here — the team's return warehouse, read now. */
  function goesTo(order: Order): string | undefined {
    if (order.returnWarehouseId === warehouseId) return undefined;
    if (order.returnWarehouseId === 0n) return t("returnList.noReturnWarehouse");
    return t("returnList.goesTo", { warehouse: teamName(order.returnWarehouseId) });
  }

  /** The row's Terima — only where this warehouse may accept it (only-the-return-warehouse-accepts-a-return). */
  const acceptsHere = (order: Order) =>
    mayWrite && order.status === OrderStatus.RETURN && warehouseId !== undefined && order.returnWarehouseId === warehouseId;

  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

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
        <Heading size="md">{t("returnList.title")}</Heading>
        <Text color="fg.muted">{t("returns.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("returnList.title")}</Heading>
        <Text color="fg.muted" data-testid="returns-not-warehouse">
          {t("returns.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  const showAccepted = activeTab.id !== "waiting";

  return (
    <Stack gap="section" animationStyle="enter" data-testid="return-list-page">
      {/* ONE HEADER ROW (the-phone-header-is-one-row): the title, the team, and Receive a Return — the crew's way in for a
          parcel at the door (search, force if needed, accept). An icon on a phone (a-phone-header-action-is-an-icon). */}
      <Flex align="center" gap="card" wrap={mobile ? "nowrap" : "wrap"} data-testid="return-list-header">
        <Heading size="md" flexShrink={0}>
          {t("returnList.title")}
        </Heading>
        <Badge colorPalette="brand" truncate minW="0">
          {current.teamName}
        </Badge>
        <Spacer />
        {mayWrite &&
          (mobile ? (
            <CompactActions
              menuLabel={t("orders.actions")}
              menuTestId="return-list-actions"
              actions={[
                {
                  id: "receive",
                  label: t("picking.action.receiveReturn"),
                  icon: PackageOpen,
                  primary: true,
                  testId: "return-list-receive",
                  onClick: () => setReceiving(true),
                },
              ]}
            />
          ) : (
            <Button size="xs" colorPalette="brand" data-testid="return-list-receive" onClick={() => setReceiving(true)}>
              <Icon as={PackageOpen} boxSize="4" />
              {t("picking.action.receiveReturn")}
            </Button>
          ))}
      </Flex>

      {/* THE CREW'S FILTERS, as on the warehouse list (the-warehouse-filters-by-team-marketplace-and-courier); the date
          window reads when the return was asked, and the trigger says so. */}
      <FilterBar active={filtered} count={filterCount} testId="return-list-filters" onClear={clearFilters}>
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("returnList.searchPlaceholder")}
          testId="return-list-search"
        />
        <FilterField w="auto">
          <DateRangePicker
            value={range}
            onChange={(r) => refilter(() => setRange(r))}
            fields={[{ value: "asked", label: t("returnList.col.asked") }]}
            field="asked"
            testId="return-list-date"
          />
        </FilterField>
        <FilterField w="15rem" testId="return-list-team-filter">
          <TeamSelect
            teamType={TeamType.SELLING}
            value={sellerId > 0n ? sellerId : undefined}
            placeholder={t("warehouseOrders.filter.team")}
            showType={false}
            onChange={(id) => refilter(() => setSellerId(id))}
          />
        </FilterField>
        <FilterField w="15rem" testId="return-list-marketplace-filter">
          <MarketplaceSelect
            value={marketplace}
            placeholder={t("orders.marketplaceAll")}
            onChange={(m) => refilter(() => setMarketplace(m))}
          />
        </FilterField>
        <FilterField w="15rem" testId="return-list-courier-filter">
          <ShipmentChannelSelect
            value={courier}
            placeholder={t("warehouseOrders.filter.courier")}
            onChange={(channelId) => refilter(() => setCourier(channelId))}
          />
        </FilterField>
      </FilterBar>

      {/* THE STATE IS THE TAB — waiting first, the work; each counted over the filters. */}
      <Tabs.Root
        value={tab}
        onValueChange={(e) => {
          setTab(e.value as StateTab);
          setPage(1);
        }}
      >
        <Tabs.List overflowX="auto" overflowY="hidden" css={{ scrollbarWidth: "none" }}>
          {STATE_TABS.map((item) => {
            const count = tabCount(item);

            return (
              <Tabs.Trigger
                key={item.id}
                value={item.id}
                flexShrink="0"
                whiteSpace="nowrap"
                data-testid={`return-list-tab-${item.id}`}
              >
                {t(item.labelKey)}
                {count !== undefined && (
                  <Badge size="xs" variant="subtle" data-testid={`return-list-tab-count-${item.id}`}>
                    {count}
                  </Badge>
                )}
              </Tabs.Trigger>
            );
          })}
          <Tabs.Indicator />
        </Tabs.List>
      </Tabs.Root>

      <Stack gap="card">
        {loading ? (
          <ListSkeleton testId="return-list-loading" />
        ) : (
          <RefreshOverlay busy={query.isFetching && !query.isPending}>
            {mobile ? (
              <Stack gap="2" data-testid="return-list-blocks">
                {orders.map((order) => (
                  <ReturnBlock
                    key={String(order.id)}
                    order={order}
                    team={teamName(order.teamId)}
                    shops={shopNames}
                    goesTo={goesTo(order)}
                    accept={acceptsHere(order) ? <ReturnAcceptButton order={order} onAccept={() => openAccept(order.id)} /> : undefined}
                    onOpen={() => openRow(order)}
                  />
                ))}
              </Stack>
            ) : (
              orders.length > 0 && (
                <Box overflowX="auto" w="full" maxW="full" minW="0">
                  <Table.Root size="sm" data-testid="return-list-table">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>{t("returnList.col.order")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("returnList.col.seller")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseOrders.col.shop")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("warehouseOrders.col.awb")}</Table.ColumnHeader>
                        <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("picking.table.status")}</Table.ColumnHeader>
                        <Table.ColumnHeader>{t("returnList.col.asked")}</Table.ColumnHeader>
                        {showAccepted && <Table.ColumnHeader>{t("returnList.col.accepted")}</Table.ColumnHeader>}
                        <Table.ColumnHeader w="1" />
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {orders.map((order) => {
                        const shop = shopNames.get(order.shopId.toString());

                        return (
                          <Table.Row
                            key={String(order.id)}
                            cursor="pointer"
                            _hover={{ bg: "bg.muted" }}
                            onClick={() => openRow(order)}
                            data-testid={`return-list-row-${order.id}`}
                          >
                            <Table.Cell>
                              <Stack gap="0.5" minW="0">
                                <Text fontWeight="bold" whiteSpace="nowrap" data-testid={`return-list-order-${order.id}`}>
                                  #{order.id.toString()}
                                </Text>
                                <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                                  {order.customerName || "—"}
                                </Text>
                              </Stack>
                            </Table.Cell>
                            <Table.Cell data-testid={`return-list-seller-${order.id}`}>
                              <TeamItem
                                size="xs"
                                team={{ teamName: teamName(order.teamId), teamType: TeamType.SELLING, teamId: order.teamId }}
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <ShopRefCell shop={shop} orderRefId={order.orderExternalRefId} />
                            </Table.Cell>
                            <Table.Cell>
                              <AwbCell channelId={order.shipmentChannelId} code={order.receiptCode} />
                            </Table.Cell>
                            <Table.Cell textAlign="end" data-testid={`return-list-qty-${order.id}`}>
                              {Number(order.itemQuantity)}
                            </Table.Cell>
                            <Table.Cell>
                              <ReturnStateCell order={order} goesTo={goesTo(order)} />
                            </Table.Cell>
                            <Table.Cell>
                              <DateAgoCell unix={order.dateEnteredAtUnix} testId={`return-list-asked-${order.id}`} />
                            </Table.Cell>
                            {showAccepted && (
                              <Table.Cell>
                                {order.status === OrderStatus.RETURN_COMPLETED ? (
                                  <DateAgoCell unix={order.statusAtUnix} testId={`return-list-accepted-${order.id}`} />
                                ) : (
                                  <Text color="fg.subtle">—</Text>
                                )}
                              </Table.Cell>
                            )}
                            <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                              {acceptsHere(order) && <ReturnAcceptButton order={order} onAccept={() => openAccept(order.id)} />}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </Box>
              )
            )}
          </RefreshOverlay>
        )}

        {/* WHICH EMPTINESS (an-empty-list-shows-a-hint): a filter that matches nothing clears from here; an empty tab says
            what fills it. */}
        {!loading && orders.length === 0 && (
          <EmptyHint
            icon={filtered ? SearchX : Undo2}
            title={
              filtered
                ? t("orders.noOrdersMatching")
                : activeTab.id === "waiting"
                  ? t("returnList.empty.waiting")
                  : activeTab.id === "accepted"
                    ? t("returnList.empty.accepted")
                    : t("warehouseOrders.emptyReturns")
            }
            description={filtered ? t("emptyHint.noMatch") : t("returnList.empty.hint")}
            action={
              filtered ? (
                <Button size="xs" variant="outline" data-testid="return-list-empty-clear" onClick={clearFilters}>
                  {t("orders.clearFilters")}
                </Button>
              ) : undefined
            }
            testId="return-list-empty"
          />
        )}

        {/* THE PAGES GROW AS THEY ARE OPENED, and the pager is always on screen (every-list-pages-with-the-growing-pager). */}
        {!loading && (
          <GrowingPager
            page={page}
            onPageChange={setPage}
            hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
            resetKey={[tab, filterKey, pageSize].join("|")}
            pageSize={pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            testId="return-list-pager"
          />
        )}
      </Stack>

      {mayWrite && <ReceiveReturnDialog open={receiving} onOpenChange={setReceiving} warehouseId={current.teamId} />}
    </Stack>
  );
}
