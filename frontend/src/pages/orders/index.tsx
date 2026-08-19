import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { rpcError } from "../../api/clients";
import { useTeam } from "../../features/team/TeamContext";
import { useOrders, useOrderStat } from "../../features/orders/queries";
import type { OrderFilters } from "../../features/orders/queries";
import { summariseOrderStat } from "../../features/orders/stat";
import { ORDER_STATUS_TABS, orderTab } from "../../features/orders/statusTabs";
import { DRAFTS_TAB, OrderTabs } from "../../features/orders/OrderTabs";
import { useOrderDrafts } from "../../features/orderDrafts/queries";
import { CustomerLineItem } from "../../components/customers/CustomerLineItem";
import { OrderLineItem } from "../../components/orders/OrderLineItem";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import {
  ALL_DATES,
  DateRangePicker,
  isAllDates,
  resolveRange,
} from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { useDebounced } from "../../lib/useDebounced";
import { formatRupiah } from "../../lib/money";
import { OrderStatRow } from "./components/OrderStatRow";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrdersPage lists the CURRENT selling TEAM's orders (#68), newest first, paginated. The team is the
// scope — a team only ever sees its own orders (and, since #151, the ones shipping from it). Rows open
// the read-only detail page.
//
// The header and the tabs answer two different questions, and that is why both are here:
//
//   the STAT says what is waiting and what it has been worth — the whole team, never the visible page.
//   the TAB narrows the TABLE to one status, server-side, and does not touch the stat. Filtering the
//   counts by the tab you are standing in would blank the number you use to pick the next tab.
export function OrdersPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  // `?status=` is how the DRAFTS tab comes back to a specific status — read once, as the initial
  // value, and never again. Keeping it in the URL from then on would mean every tab click pushed a
  // history entry, so Back would walk the tabs instead of leaving the screen.
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => orderTab(params.get("status") ?? "all").value);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // The three filters above the tabs. All of them are SERVER-SIDE: the list is paginated, so a
  // client-side filter would narrow the loaded page only and leave the pager counting the whole set.
  const [search, setSearch] = useState("");
  const [shopId, setShopId] = useState(0n);
  const [range, setRange] = useState<DateRange>(ALL_DATES);

  const teamId = current?.teamId;

  // A shop belongs to a SELLING team. This list is read from both ends (#151) — a warehouse sees the
  // orders shipping from it — and a warehouse holds no shops, so the picker would be an empty control
  // that never filters anything. It is hidden there rather than shown disabled: an empty dropdown
  // reads as "no shops loaded", which is a bug report waiting to happen.
  //
  // ⚠ The test is NOT-A-WAREHOUSE, not IS-SELLING, and the difference is not pedantic: the ROOT team
  // is neither, and gating on `=== SELLING` hid the filter from root and admin — who use this screen
  // like anyone else. Excluding the one type that genuinely cannot have shops is the same shape the
  // rest of the app already uses.
  const canFilterByShop = !!current && current.teamType !== TeamType.WAREHOUSE;

  // Debounced so a search re-queries per PAUSE rather than per keystroke. The query still decides
  // which answer is current — this only keeps the request count down (see lib/useDebounced).
  const debouncedSearch = useDebounced(search.trim());

  const filters: OrderFilters = useMemo(() => {
    const { fromUnix, toUnix } = resolveRange(range);

    return {
      search: debouncedSearch,
      shopId: canFilterByShop ? shopId : 0n,
      fromUnix,
      toUnix,
    };
  }, [debouncedSearch, shopId, canFilterByShop, range]);

  // The tab IS the status filter: it decides the `status` the RPC gets, and nothing else. Keeping the
  // tab (a string, what Tabs speaks) as the state and deriving the rest from it means the status the
  // server filters on and the count on the trigger can never drift apart.
  const activeTab = orderTab(tab);

  // The SAME `filters` to both, which is what keeps the counts on the tabs true of the table under
  // them. Only the status differs — that is the tab, and the stat groups by it.
  const query = useOrders({ teamId, page, pageSize, status: activeTab.status, filters });
  const statQuery = useOrderStat({ teamId, filters });

  // How many drafts are waiting, for the badge on the Drafts tab. ONE ROW is fetched, not the list —
  // the number comes from the pager's total, and this screen never shows a draft.
  //
  // Deliberately NOT narrowed by the filter bar above: those filters are OrderList's, and a draft has
  // no status to filter by and no shop half the time. The badge answers "is there anything waiting",
  // which is a question about the whole pile.
  const draftsQuery = useOrderDrafts({ teamId, page: 1, pageSize: 1 });
  const draftCount = draftsQuery.data?.totalItems;

  // Any filter change restarts at page 1, for the same reason a tab change does: the page number
  // belongs to the old result set, and page 4 of a narrower one is usually empty — which reads as
  // "nothing matched" when in fact plenty did.
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  // Whether ANY of the three is narrowing the list. Read off the live controls rather than off
  // `filters`, so the Clear button appears the moment somebody types instead of after the debounce.
  // `isAllDates`, not `range !== ALL_DATES`: clearing both ends by hand in the picker emits a fresh
  // `{from:"",to:""}` that means the same thing but is a different object, and a reference comparison
  // would leave the Clear button showing over an unfiltered list.
  const filtered = search.trim() !== "" || shopId > 0n || !isAllDates(range);

  const stat = summariseOrderStat(statQuery.data);

  const orders = query.data?.orders ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // The count on a tab trigger. "All" has no status of its own, so it is the 30-day figure's stablemate
  // — the census summed — rather than a number the server sends separately.
  function tabCount(value: string): number {
    const item = orderTab(value);

    if (item.value === "all") {
      return ORDER_STATUS_TABS.reduce(
        (sum, other) => (other.value === "all" ? sum : sum + stat.count(other.status)),
        0,
      );
    }

    return stat.count(item.status);
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
      <Flex align="center" gap="card">
        <Heading size="md">{t("orders.title")}</Heading>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <Spacer />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="open-create-order"
          onClick={() => navigate("/orders/new")}
        >
          {t("orders.newOrder")}
        </Button>
      </Flex>

      <OrderStatRow stat={stat} />

      {/* The filter bar sits ABOVE the tabs, and the order is the meaning: these three narrow which
          orders exist for the whole screen — the tab counts included — while the tab picks one status
          out of what is left. A filter placed inside the tab panel would read as belonging to that
          tab alone. */}
      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="sm"
          placeholder={t("orders.searchPlaceholder")}
          value={search}
          data-testid="orders-search"
          onChange={(e) => refilter(() => setSearch(e.target.value))}
        />

        {canFilterByShop && (
          <Box maxW="52" w="full">
            <ShopSelect
              teamId={teamId!}
              value={shopId > 0n ? shopId : undefined}
              placeholder={t("orders.shopAll")}
              onChange={(id) => refilter(() => setShopId(id))}
            />
          </Box>
        )}

        {/* No `fields` segment: an order has exactly one date that means anything to the person
            filtering — when it was placed. When fulfilment starts stamping picked_at / shipped_at,
            THAT is when this grows a which-timestamp choice. */}
        <DateRangePicker
          value={range}
          onChange={(r) => refilter(() => setRange(r))}
          testId="orders-date"
        />

        {filtered && (
          <Button
            variant="ghost"
            colorPalette="gray"
            data-testid="orders-clear-filters"
            onClick={() =>
              refilter(() => {
                setSearch("");
                setShopId(0n);
                setRange(ALL_DATES);
              })
            }
          >
            {t("orders.clearFilters")}
          </Button>
        )}
        <Spacer />
      </Flex>

      {/* DRAFTS IS THE LAST TAB (owner), and selecting it LEAVES — the drafts screen is its own route
          with its own selection and bulk delete, so the tab is a way in rather than a panel here.
          Everything else on this strip is a status filter that stays on this page. */}
      <OrderTabs
        value={tab}
        count={tabCount}
        draftCount={draftCount}
        onSelect={(value) => {
          if (value === DRAFTS_TAB) {
            void navigate("/order-drafts");
            return;
          }

          setTab(value);
          // Page 1, always. Staying on page 4 while the set underneath changes lands on a page that may
          // not exist in the new filter, and an empty table there reads as "no orders in this status".
          setPage(1);
        }}
      />

      <Tabs.Root value={tab}>

        <Tabs.Content value={tab}>
          <Stack gap="section">
            {error && (
              <Text color="red.fg" data-testid="orders-error">
                {error}
              </Text>
            )}

            {loading ? (
              <Spinner colorPalette="brand" />
            ) : (
              <RefreshOverlay busy={query.isFetching && !query.isPending}>
                <Table.Root size="sm" data-testid="orders-table">
                  <Table.Header>
                    <Table.Row>
                      {/* No STATUS column any more: the badge is part of the order's identity block
                          now, beside the number it belongs to. Two columns that both answered "which
                          order is this" were a split the table did not need. */}
                      <Table.ColumnHeader>{t("orders.orderColumn")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("orders.customer")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("orders.total")}</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>

                  <Table.Body>
                    {/* The WHOLE ROW opens the order, as every other list in the app does. The click
                        target used to be the `#id` text alone — a few characters wide, with no hover
                        feedback — so a row that looked clickable everywhere else on the screen did
                        nothing when you clicked the customer or the total. */}
                    {orders.map((o) => (
                      <Table.Row
                        key={o.id.toString()}
                        cursor="pointer"
                        _hover={{ bg: "bg.muted" }}
                        data-testid={`order-row-${o.id}`}
                        onClick={() => navigate(`/orders/${o.id}`)}
                      >
                        {/* THE ORDER'S IDENTITY, from the shared component — its number, its status,
                            and (once the contract carries them) its own ref and the courier's receipt
                            code. The cell used to be a bare `#id` with the status two columns away.

                            ⚠ `orderRefId` and `receiptCode` are not passed because nothing on the wire
                            holds them yet: `Order` has no ref, `OrderReceipt` is the attached FILE and
                            `shipping_code` is the courier. Both render as nothing until the proto
                            gains them, so this row grows the two extra names without another edit
                            here. */}
                        <Table.Cell data-testid={`open-order-${o.id}`}>
                          <OrderLineItem id={o.id} status={o.status} />
                        </Table.Cell>
                        {/* BOTH ENDS OF THE LIST GET THE SAME CUSTOMER CELL. This is one page read
                            from two sides (#151), and who the parcel is for does not change with
                            who is looking — the seller chases the buyer, the warehouse ships to
                            them, and both read the phone off this row.

                            The list returns the whole Order minus its items (OrderRowMapItem), so
                            the phone is already on the wire — no extra call, no N+1.

                            The ADDRESS is deliberately off. It is available here too, but it turns
                            a one-line row into two across the whole page, and where the parcel goes
                            is the shipping label's question, answered in full on the detail page. */}
                        <Table.Cell>
                          <CustomerLineItem
                            name={o.customerName}
                            phone={o.customerPhone}
                            testId={o.id}
                          />
                        </Table.Cell>
                        <Table.Cell textAlign="end">{formatRupiah(o.total)}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </RefreshOverlay>
            )}

            {!loading && orders.length === 0 && !error && (
              <Text color="fg.muted" data-testid="orders-empty">
                {/* Which emptiness this is, and the three cases are genuinely different. "No orders
                    yet" is a statement about the TEAM; the other two are statements about what you
                    asked for. Saying the first while a filter is narrowing the list would tell
                    somebody their orders are gone when they are one Clear away. Filters are named
                    first because they outrank the tab: they narrow the whole screen, the tab counts
                    included. */}
                {filtered
                  ? t("orders.noOrdersMatching")
                  : activeTab.value === "all"
                    ? t("orders.noOrders")
                    : t("orders.noOrdersInStatus", { status: t(activeTab.labelKey) })}
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
    </Stack>
  );
}
