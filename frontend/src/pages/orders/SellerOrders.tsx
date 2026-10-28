import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
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
import { Download, Plus, Upload } from "lucide-react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { OrderDateField, OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useOrderCreators, useOrders, useOrderStat } from "../../features/orders/queries";
import { OrderExportView, useOrderExport } from "../../features/orders/useOrderExport";
import type { OrderFilters } from "../../features/orders/queries";
import {
  orderSummaryRows,
  orderSummaryTotal,
  summariseOrderStat,
} from "../../features/orders/stat";
import { ALL_STAGE, ORDER_STAGES, orderStage, stageOfStatus } from "../../features/orders/stages";
import { DRAFTS_TAB, StageTabs } from "../../features/orders/StageTabs";
import { OrderStatusBadge } from "../../components/badges/OrderStatusBadge";
import {
  CreatedCell,
  DateCell,
  MpTotalCell,
  OwnerCell,
  MpDateCell,
  OrderRefCell,
  ReceiptCell,
  SpendCell,
} from "../../features/orders/OrderRowCells";
import { deadlineUrgency, hoursFromNow, orderDeadline, orderPlatformDate } from "../../features/orders/deadline";
import { OrderRowActions } from "./components/OrderRowActions";
import { useShopOptions } from "../../features/shops/queries";
import { useTeams } from "../../features/teams/queries";
import { useOrderDrafts } from "../../features/orderDrafts/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ORDERS_LIST_PENDING } from "./pending";
import { Pagination } from "../../components/chrome/Pagination";
import {
  FilterBar,
  FilterField,
  FilterSearch,
} from "../../components/chrome/FilterBar";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { MarketplaceSelect } from "../../components/pickers/MarketplaceSelect";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { PersonFilterSelect } from "../../components/pickers/PersonFilterSelect";
import { useTypists } from "../../features/orders/typists";
import { TeamSelect } from "../../components/teams/TeamSelect";
import {
  ALL_DATES,
  DateRangePicker,
  isAllDates,
  resolveRange,
} from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { useDebounced } from "../../lib/useDebounced";
import { OrderSummary } from "../../features/orders/OrderSummary";
import { orderFee } from "../../features/orders/margin";
import { ImportOrdersDialog } from "./components/ImportOrdersDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// THE ORDERS LIST, WITH WHAT THE OWNER ASKED IT TO GROW — a PREVIEW (owner).
//
// This is `pages/orders/` plus four things, none of which has a backend yet:
//
//   • EXPORT the list
//   • IMPORT a marketplace's file — per storefront, because each one prints a different sheet
//   • three header actions, each with an icon (New Order was already here)
//   • four more filters — warehouse, the person who created the order, marketplace, shop
//
// ⚠ IT IS A SECOND FILE ON PURPOSE, and a temporary one. The live list at `/orders` is untouched
// while this is looked at; when it is accepted this page replaces it, exactly as `order-create-next`
// became the order form. Nothing here is routed — it is reached from Storybook.
//
// All four filters reach the server: the marketplace (the-filter-gains-seller-marketplace-and-courier), and the
// warehouse, which `OrderListFilter.warehouse_id` carries for exactly this list.
//
// WHY THEY ARE SEARCH SELECTS (owner). A picker over data that grows is typed into; only a static,
// small set stays a plain dropdown. Warehouse and creator and shop all grow, so all three search.
// Marketplace is seven values that change when the company enters a new country — it stays a list.
export function SellerOrdersPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [params] = useSearchParams();
  const [tab, setTab] = useState(
    () => orderStage(params.get("status") ?? "")?.id ?? ALL_STAGE,
  );
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // The filters above the tabs. Every one REACHES THE SERVER — the list is paginated, so a client-side filter
  // would narrow the loaded page only and leave the pager counting the whole set.
  const [search, setSearch] = useState("");
  const [shopId, setShopId] = useState(0n);
  const [warehouseId, setWarehouseId] = useState(0n);
  const [creatorId, setCreatorId] = useState<bigint | undefined>(undefined);
  const [marketplace, setMarketplace] = useState<Marketplace>(
    Marketplace.UNSPECIFIED,
  );
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  // Which date the window reads — created, by default (the-date-filter-switches-created-or-platform).
  const [dateField, setDateField] = useState<OrderDateField>(OrderDateField.CREATED);

  const [importing, setImporting] = useState(false);

  const teamId = current?.teamId;

  // A shop belongs to a SELLING team. This list is read from both ends (#151) — a warehouse sees the
  // orders shipping from it — and a warehouse holds no shops, so the picker would be an empty control
  // that never filters anything.
  //
  // ⚠ The test is NOT-A-WAREHOUSE, not IS-SELLING: the ROOT team is neither, and gating on
  // `=== SELLING` hid the filter from root and admin, who use this screen like anyone else.
  const canFilterByShop = !!current && current.teamType !== TeamType.WAREHOUSE;

  // WHICH OWNER THE ROW LEADS WITH — a separate question from whether the FILTER is offered, and the
  // two answers differ for root and admin.
  //
  // ⚠ ONLY A SELLING TEAM HAS SHOPS OF ITS OWN, so only there does a shop name tell two rows apart.
  // A warehouse sees many sellers' orders; root and admin see everyone's (owner: *"root bisa liat
  // team"*) — for all three the useful headline is the TEAM that sold it, and a Shop column would be
  // blank on every row. The filter above stays as it was decided: offered to anyone but a warehouse.
  const rowShowsShop = !!current && current.teamType === TeamType.SELLING;

  const debouncedSearch = useDebounced(search.trim());

  const filters: OrderFilters = useMemo(() => {
    const { fromUnix, toUnix } = resolveRange(range);

    return {
      search: debouncedSearch,
      shopId: canFilterByShop ? shopId : 0n,
      fromUnix,
      toUnix,
      createdByUserId: creatorId ?? 0n,
      marketplace,
      warehouseId,
      dateField,
    };
  }, [debouncedSearch, shopId, canFilterByShop, range, creatorId, marketplace, warehouseId, dateField]);

  // The "created by" filter's people: everyone who typed in an order this team may list
  // (a-who-filter-lists-the-people-on-its-rows) — Customer Service asks it too.
  const creators = useOrderCreators({ teamId });

  const stage = orderStage(tab);

  // A tab IS one status (one-tab-per-status), so it always narrows the table; All narrows nothing.
  const listStatus = stage ? stage.status : OrderStatus.UNSPECIFIED;

  const exporter = useOrderExport();

  const query = useOrders({
    teamId,
    page,
    pageSize,
    status: listStatus,
    filters,
  });
  const statQuery = useOrderStat({ teamId, filters });

  const draftsQuery = useOrderDrafts({ teamId, page: 1, pageSize: 1 });
  const draftCount = draftsQuery.data?.totalItems;

  // Any filter change restarts at page 1: the page number belongs to the old result set, and page 4
  // of a narrower one is usually empty — which reads as "nothing matched" when plenty did.
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // Whether ANYTHING is narrowing the list. Read off the live controls rather than off `filters`, so
  // Clear appears the moment somebody types instead of after the debounce.
  //
  // How many controls are narrowing the list — the number on the phone's Filter button.
  const filterCount = [
    search.trim() !== "",
    shopId > 0n,
    warehouseId > 0n,
    creatorId !== undefined,
    marketplace !== Marketplace.UNSPECIFIED,
    !isAllDates(range),
  ].filter(Boolean).length;
  const filtered = filterCount > 0;

  // `stat` survives for the TAB BADGES alone — the counts on the triggers, which every order screen
  // feeds the same way.
  // ── WHOSE ORDER IS THIS: two lookups, only one of which ever runs ───────────────────────────────
  //
  // A selling team resolves SHOPS; a warehouse resolves TEAMS. Neither list carries the other's
  // names — `OrderList` sends ids only — and each is a single batched read per page, never per row.
  //
  // ⚠ `useTeams` TRUNCATES at its page size, which `TeamByIds` would not. It is what five other list
  // pages already do, so it is what this follows; the day a team list outgrows 200 the fix is to
  // resolve exactly the page's ids instead, the way ProductPickerShell does.
  const shopOptions = useShopOptions({
    teamId: canFilterByShop ? (teamId ?? 0n) : 0n,
  });
  // Only the readers who get the Tim column need team names — a selling team would be resolving its
  // own, twenty times. (It was briefly always-on, to name the fulfilling warehouse; that column is
  // gone.)
  const teamOptions = useTeams({
    page: 1,
    pageSize: 200,
    reference: true,
    enabled: !rowShowsShop,
  });

  const shopNames = useMemo(() => {
    const out = new Map<string, { name: string; marketplace: Marketplace }>();
    for (const shop of shopOptions.data ?? []) {
      out.set(shop.id.toString(), {
        name: shop.name,
        marketplace: shop.marketplace,
      });
    }
    return out;
  }, [shopOptions.data]);

  const teamNames = useMemo(() => {
    const out = new Map<string, { teamName: string; teamType: TeamType }>();
    for (const team of teamOptions.data?.teams ?? []) {
      out.set(team.id.toString(), { teamName: team.name, teamType: team.type });
    }
    return out;
  }, [teamOptions.data]);

  // An id with no resolved name still renders — `ShopItem` and `TeamItem` both fall back to their
  // number rather than a blank cell, which would read as "no shop" instead of "name not loaded".
  function shopOf(shopId: bigint) {
    return shopId > 0n
      ? { shopId, ...shopNames.get(shopId.toString()) }
      : undefined;
  }

  // WHEN IT ENTERED THE STATUS BEING FILTERED (a-filtered-status-shows-its-own-date) — the order's own
  // `status_at_unix`. Under a status tab every row IS in that status, so its current-status date answers the
  // column. 0 is "no timeline row records the move", shown as nothing rather than as 1970.
  function stageDateOf(statusAt: bigint) {
    return statusAt > 0n ? statusAt : undefined;
  }

  function stageBadgeFor(status: OrderStatus) {
    const item = stageOfStatus(status);

    return item ? <OrderStatusBadge status={item.status} /> : undefined;
  }

  function teamOf(id: bigint) {
    return id > 0n
      ? { teamId: id, ...teamNames.get(id.toString()) }
      : undefined;
  }

  const stat = summariseOrderStat(statQuery.data);

  // THE SUMMARY'S OWN READING of the same census, one row per status in tab order so the strip and
  // the tabs read down the page in the same sequence. Every figure is the server's: the units, and the
  // margin's inputs over exactly the orders it can be taken over (`OrderStatusCount`).
  const summaryRows = useMemo(
    () =>
      orderSummaryRows(
        statQuery.data,
        ORDER_STAGES.map((item) => ({ key: item.id, statuses: item.statuses })),
      ),
    [statQuery.data],
  );

  const summaryTotal = useMemo(
    () => orderSummaryTotal(summaryRows),
    [summaryRows],
  );

  const orders = query.data?.orders ?? [];
  const totalItems = query.data?.totalItems ?? 0;

  // WHO TYPED EACH ROW IN — one UserByIDs for the page.
  const typistOf = useTypists(orders);
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // The badge on a tab. A stage sums every proto status it covers, so `processed` reads three at once
  // — the count is the one half of it the census CAN answer.
  function tabCount(value: string): number {
    if (value === ALL_STAGE) {
      return ORDER_STAGES.reduce(
        (sum, item) =>
          sum + item.statuses.reduce((n, s) => n + stat.count(s), 0),
        0,
      );
    }

    const item = orderStage(value);

    return item ? item.statuses.reduce((n, s) => n + stat.count(s), 0) : 0;
  }

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("orders.title")}</Heading>
        <Text color="fg.muted" data-testid="orders-no-team">
          {t("orders.selectTeamView")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {/* WHAT THIS SCREEN CANNOT DO, FIRST AND FOLDED AWAY — the same strip the order form carries,
          from the same component. It is above everything, the header included, because it is a
          statement about the whole page rather than about the table under it. */}
      <NotImplementedSummary list={ORDERS_LIST_PENDING} />

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("orders.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName ||
            t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />

        {/* THE THREE ACTIONS, EACH WITH ITS ICON (owner), in increasing commitment: Export takes
            nothing out of the screen, Import changes orders that already exist, New Order writes one.
            Only the last is the brand button — three coloured buttons side by side would say all
            three are the thing to do. */}
        <Flex gap="2" align="center" wrap="wrap">
          {/* THE LIST AS A FILE (one-export-is-the-list-as-a-file): exactly the rows on screen with this filter and
              tab, every page of them. */}
          <Button
            size="xs"
            variant="outline"
            colorPalette="gray"
            data-testid="orders-export"
            loading={exporter.running}
            loadingText={
              exporter.progress
                ? t("orders.export.running", { done: exporter.progress.done, total: exporter.progress.total })
                : undefined
            }
            onClick={() =>
              teamId !== undefined &&
              void exporter.start({ teamId, filters, status: listStatus, view: OrderExportView.SELLER })
            }
          >
            <Icon as={Download} boxSize="4" />
            {t("orders.export.action")}
          </Button>

          <Button
            size="xs"
            variant="outline"
            colorPalette="gray"
            data-testid="orders-import"
            onClick={() => setImporting(true)}
          >
            <Icon as={Upload} boxSize="4" />
            {t("orders.import.action")}
            <NotImplemented list={ORDERS_LIST_PENDING} id="import" />
          </Button>

          <Button
            size="xs"
            colorPalette="brand"
            data-testid="open-create-order"
            onClick={() => navigate("/orders/new")}
          >
            <Icon as={Plus} boxSize="4" />
            {t("orders.newOrder")}
          </Button>
        </Flex>
      </Flex>

      {/* The filter bar sits ABOVE the tabs, and the order is the meaning: these narrow which orders
          exist for the whole screen — the tab counts included — while the tab picks one status out of
          what is left. A filter inside the tab panel would read as belonging to that tab alone.

          It is the shared FilterBar rather than a hand-rolled Flex: six controls is exactly the width
          at which "wrap, never squeeze" stops being a detail. */}
      <FilterBar
        active={filtered}
        count={filterCount}
        testId="orders-filters"
        onClear={() =>
          refilter(() => {
            setSearch("");
            setShopId(0n);
            setWarehouseId(0n);
            setCreatorId(undefined);
            setMarketplace(Marketplace.UNSPECIFIED);
            setRange(ALL_DATES);
            setDateField(OrderDateField.CREATED);
          })
        }
      >
        <FilterSearch
          value={search}
          onChange={(value) => refilter(() => setSearch(value))}
          placeholder={t("orders.searchPlaceholder")}
          testId="orders-search"
        />

        {/* WHICH BUILDING THE GOODS LEAVE FROM. A search select over every warehouse — the list grows
            with the company, so it is typed into rather than scrolled. */}
        <FilterField w="15rem" testId="orders-warehouse-filter">
          <TeamSelect
            teamType={TeamType.WAREHOUSE}
            value={warehouseId > 0n ? warehouseId : undefined}
            placeholder={t("orders.warehouseAll")}
            onChange={(id) => refilter(() => setWarehouseId(id))}
          />
        </FilterField>

        {/* WHO TYPED THE ORDER — the people on this team's orders, answered by selling_service
            (a-who-filter-lists-the-people-on-its-rows): somebody who has since left still typed last
            year's orders in, and a member who never placed one is no answer. */}
        <FilterField w="15rem" testId="orders-creator-filter">
          <Flex align="center" gap="1">
            <Box flex="1" minW="0">
              <PersonFilterSelect
                people={creators.data}
                error={creators.isError}
                value={creatorId}
                placeholder={t("orders.creatorAll")}
                onChange={(id) => refilter(() => setCreatorId(id))}
              />
            </Box>
          </Flex>
        </FilterField>

        {/* ⚠ THE ONE PLAIN DROPDOWN, and the rule is the reason (owner): a static, small set is not
            typed into. Seven marketplaces, changed by entering a new country — searching a list you
            can see in full is a keystroke tax. */}
        <FilterField w="15rem" testId="orders-marketplace-filter">
          <MarketplaceSelect
            value={marketplace}
            placeholder={t("orders.marketplaceAll")}
            onChange={(m) => refilter(() => setMarketplace(m))}
          />
        </FilterField>

        {canFilterByShop && (
          <FilterField testId="orders-shop-filter">
            <ShopSelect
              teamId={teamId!}
              value={shopId > 0n ? shopId : undefined}
              placeholder={t("orders.shopAll")}
              marketplace={marketplace}
              onChange={(id) => refilter(() => setShopId(id))}
            />
          </FilterField>
        )}

        {/* WHICH DATE, THEN WHICH WINDOW (the-date-filter-switches-created-or-platform): when we wrote it down —
            the default — or when the buyer ordered on the storefront. One control, because the two answer
            different questions about the same orders: "what came in today" against "the buyers' Saturday". */}
        <FilterField w="auto">
          <DateRangePicker<OrderDateField>
            value={range}
            onChange={(r) => refilter(() => setRange(r))}
            fields={[
              { value: OrderDateField.CREATED, label: t("orders.dateField.created") },
              { value: OrderDateField.PLATFORM_CREATED, label: t("orders.dateField.platform") },
            ]}
            field={dateField}
            onFieldChange={(f) => refilter(() => setDateField(f))}
            testId="orders-date"
          />
        </FilterField>
      </FilterBar>

      {/* DRAFTS IS THE LAST TAB (owner), and selecting it LEAVES — the drafts screen is its own route
          with its own selection and bulk delete, so the tab is a way in rather than a panel here. */}
      <StageTabs
        value={tab}
        count={tabCount}
        draftCount={draftCount}
        onSelect={(value) => {
          if (value === DRAFTS_TAB) {
            void navigate("/order-drafts");
            return;
          }

          setTab(value);
          setPage(1);
        }}
      />

      {/* BY STATUS FIRST (owner), and BELOW THE STATUS FILTER — the tab strip above decides which
          pile the measure line describes, so the summary reads as the answer to the control right
          above it rather than as a control of its own.

          ⚠ IT NAVIGATES NOTHING AND FILTERS NOTHING (owner). The cards are a breakdown to look at;
          the tabs are how a status is chosen. Two controls doing one job is what this avoids.

          ⚠ NO 30-DAY TILES any more. Every figure follows the filter bar's date range, so the screen
          has ONE window instead of two; the old pair was labelled "30d" while the filter silently
          narrowed them to whatever was picked. */}
      <OrderSummary
        rows={summaryRows}
        total={summaryTotal}
        selectedKey={tab}
        badge={(row) => {
          const item = orderStage(row.key);

          return item ? <OrderStatusBadge status={item.status} /> : null;
        }}
      />

      <Tabs.Root value={tab}>
        <Tabs.Content value={tab}>
          <Stack gap="section">
            {error && (
              <Text color="error.fg" data-testid="orders-error">
                {error}
              </Text>
            )}

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <RefreshOverlay busy={query.isFetching && !query.isPending}>
                {/* ⚠ A DOZEN COLUMNS DO NOT FIT A PHONE, and the layout rule is that the PAGE never scrolls
                    sideways — only a table, inside its own container. Grinding the columns down
                    until a rupiah figure wraps mid-number is worse than scrolling. `minW` on the
                    scroller because a flex child's min-width is `auto`, which would let the table
                    push the page instead of scrolling inside its box. */}
                <Box overflowX="auto" w="full" maxW="full" minW="0">
                  <Table.Root size="sm" data-testid="orders-table">
                    <Table.Header>
                      {/* ONE CONTEXT PER COLUMN, AND NO CELL OVER TWO LINES (owner, 2026-09-28).
                        What counts as ONE fact is the owner's call and it moved several times; the
                        pairs that survived are in `OrderRowCells`. Penerima and Gudang came off the row
                        entirely — both answer *tell me about this order* rather than *which order do I
                        want*, and the search box already reaches the customer's name. */}
                      <Table.Row>
                        {/* ⚠ OUR OWN `#id` IS NOT ON THE ROW (owner). It had its own unlabelled column
                          for one round, and nothing reads it: the marketplace reference is what a
                          buyer, a shop and a courier all quote, and the row itself opens the order.
                          The id survives as the row's link target and its testid, not as a column. */}
                        <Table.ColumnHeader>{t("orders.orderIdColumn")}</Table.ColumnHeader>

                        <Table.ColumnHeader>{t("orders.receiptColumn")}</Table.ColumnHeader>

                        <Table.ColumnHeader>
                          {rowShowsShop ? t("orders.shop") : t("orders.team")}
                        </Table.ColumnHeader>

                        <Table.ColumnHeader>
                          <Flex gap="1" align="center">
                            {t("orders.placed")}
                          </Flex>
                        </Table.ColumnHeader>

                        {/* ⚠ THE DEADLINE LIVES UNDER THIS ONE (owner) — and causally, not just for
                          room: the ship-by window runs FROM the storefront's order time. Both are the
                          platform's own, `platform_created_at` and `platform_shipment_deadline`. */}
                        <Table.ColumnHeader>{t("orders.placedMpColumn")}</Table.ColumnHeader>

                        {/* ⚠ ONLY WHILE A STATUS IS FILTERED. "When did this ship" is a question you
                          ask while looking at shipped orders; on every other tab the column would be
                          blank, and a permanently blank column is one people stop reading. */}
                        {stage && (
                          <Table.ColumnHeader>
                            {t("orders.stageDateColumn", {
                              status: t(`orders.stage.${stage.id}`),
                            })}
                          </Table.ColumnHeader>
                        )}

                        {/* total beli = subtotal produk + biaya — the order's goodsCost and its frozen warehouse fee. */}
                        <Table.ColumnHeader textAlign="end">{t("orders.cost")}</Table.ColumnHeader>

                        {/* ⚠ THE MARGIN IS THE SECOND LINE HERE (owner: *"margin ikut total mp saja"*),
                          because this is the figure it is measured against. */}
                        <Table.ColumnHeader textAlign="end">
                          {t("orders.totalMpColumn")} · {t("orders.margin")}
                        </Table.ColumnHeader>

                        <Table.ColumnHeader textAlign="end">
                          {t("orders.actions")}
                        </Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>

                    <Table.Body>
                      {orders.map((o) => {
                        // The marketplace's own ship-by time — undefined when it set none, or once the parcel has left.
                        const deadline = orderDeadline(o);
                        const overdue =
                          deadline !== undefined && deadlineUrgency(hoursFromNow(deadline)) === "overdue";

                        return (
                          <Table.Row
                            key={o.id.toString()}
                            cursor="pointer"
                            /* ⚠ THE ROW ITSELF CARRIES THE ALARM when the deadline has passed
                               (owner: the deadline must be *mencolok*). A badge in one column is
                               visible; a tinted row is unmissable while scanning, and it is the only
                               thing on this table that colours a whole row — which is what keeps it
                               meaning one specific thing. */
                            bg={overdue ? "error.subtle" : undefined}
                            _hover={{ bg: overdue ? "error.muted" : "bg.muted" }}
                            data-testid={`order-row-${o.id}`}
                            data-overdue={overdue ? "true" : undefined}
                            onClick={() => navigate(`/orders/${o.id}`)}
                          >
                            {/* ⚠ The STAGE, not the proto status — otherwise the tab says "Diproses"
                              and the row says "Packed" about the same order. */}
                            <Table.Cell data-testid={`open-order-${o.id}`}>
                              <OrderRefCell
                                orderRefId={o.orderExternalRefId}
                                statusBadge={stageBadgeFor(o.status)}
                              />
                            </Table.Cell>

                            {/* The number printed on the slip — `receipt_code`, beside the slip itself. */}
                            <Table.Cell>
                              <ReceiptCell code={o.receiptCode} />
                            </Table.Cell>

                            <Table.Cell>
                              <OwnerCell
                                shop={rowShowsShop ? shopOf(o.shopId) : undefined}
                                team={rowShowsShop ? undefined : teamOf(o.teamId)}
                              />
                            </Table.Cell>

                            <Table.Cell>
                              <CreatedCell unix={o.createdAtUnix} by={typistOf(o.createdByUserId)} />
                            </Table.Cell>

                            {/* When the buyer ordered, and when it has to be out — both the platform's. */}
                            <Table.Cell>
                              <MpDateCell unix={orderPlatformDate(o)} deadline={deadline} />
                            </Table.Cell>

                            {stage && (
                              <Table.Cell>
                                <DateCell
                                  unix={stageDateOf(o.statusAtUnix)}
                                  testId="order-placed-stage"
                                />
                              </Table.Cell>
                            )}

                            {/* total beli = goodsCost + the frozen fee. */}
                            <Table.Cell textAlign="end">
                              <SpendCell goodsCost={o.goodsCost} fees={orderFee(o)} />
                            </Table.Cell>

                            {/* ⚠ THE MARGIN RIDES WITH THIS FIGURE (owner), because it is measured
                              against it — `harga MP − total beli`, as a share of the MP price. */}
                            <Table.Cell textAlign="end">
                              <MpTotalCell
                                platformTotal={o.platformTotal}
                                goodsCost={o.goodsCost}
                                fees={orderFee(o)}
                              />
                            </Table.Cell>

                            {/* ⚠ STOPS THE ROW'S NAVIGATE. The row opens the order on click, so
                              without this every menu press would also leave the page. */}
                            <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                              {/* The stage keys the owner's per-status action table; the warehouse id
                                decides whether "Jadikan Dikirim" is this reader's to press at all —
                                OrderStatusChange gives the warehouse's moves to the building holding the parcel. */}
                              <OrderRowActions
                                teamId={teamId}
                                orderId={o.id}
                                stage={stageOfStatus(o.status)?.id}
                                warehouseId={o.warehouseId}
                              />
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </Box>
              </RefreshOverlay>
            )}

            {!loading && orders.length === 0 && !error && (
              <Text color="fg.muted" data-testid="orders-empty">
                {filtered
                  ? t("orders.noOrdersMatching")
                  : stage === undefined
                    ? t("orders.noOrders")
                    : t("orders.noOrdersInStatus", {
                        status: t(`orders.stage.${stage.id}`),
                      })}
              </Text>
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

      <ImportOrdersDialog open={importing} onOpenChange={setImporting} />
    </Stack>
  );
}
