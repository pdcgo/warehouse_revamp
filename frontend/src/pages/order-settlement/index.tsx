import { useMemo } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Heading, Icon, NativeSelect, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowDown, ArrowUp, ArrowUpDown, TriangleAlert } from "lucide-react";

import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { ALL_DATES, DateRangePicker, isAllDates } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import type { SettlementSort, SettlementSortKey } from "../../features/settlement/queries";
import { useIsMobile } from "../../layouts/shell";
import { formatRupiah, formatSignedRupiah } from "../../lib/money";
import { netReceived, type OrderSettlement } from "./model";

// WHICH ORDERS LOST THE MOST AGAINST THEIR ESTIMATE — the settlement list.
//
// Takes its rows, sums, filters, sort and pager as PROPS — `SettlementListRoute` feeds them from
// `OrderSettlementList` — so its stories pin the design without a server.
//
// ── What this screen is NOT, and both are decisions rather than omissions ────────────────────────
//
// It is **not a worklist**. `a-residual-balance-is-normal` says almost every order ends non-zero, so
// a queue of "unsettled" orders would contain all of them and mean nothing. Nothing here is ticked
// off, cleared or assigned.
//
// It is **not a debt list**. `hidden-cost-is-left-in-the-balance` says the gap is money the platform
// already took and nobody is going to collect. The column is therefore an **Adjustment**
// (`the-gap-is-an-adjustment`), never "outstanding" or "unpaid" — a label implying somebody owes us
// would be wrong on every row.
//
// ── What it IS ──────────────────────────────────────────────────────────────────────────────────
//
// A ranking. Sorted by loss, worst first by default, because the only action this screen supports is
// *look at the ones that went furthest wrong* — and re-sortable by its money headings
// (`the-settlement-list-sorts-by-its-headings`). The SERVER sorts: the rows arrive in their order.
//
// ⚠ NO DEDUCTIONS COLUMN, and no source badge. Both read an order's ENTRIES, which a list row does not
// carry — they were only ever right in a story, whose sample rows carry theirs (owner: *"hilangkan
// potongan karena memang tidak ada"*). Both show in the order's ledger, where the entries are.

/**
 * The summary of the WHOLE filtered set — the server's sums, never this page's
 * (`the-settlement-list-summary-is-the-order-lists-cards`). Both sums skip an unrecorded sale, which
 * is counted instead.
 */
export interface SettlementTotals {
  /** Every account the filters match. */
  count: number;
  initialTotal: bigint;
  lastBalance: bigint;
  /** Accounts with no recorded sale — in `count`, out of both sums. */
  unrecorded: number;
}

/** The server's sums, computed from rows — the same rules, for a caller holding every row (a story). */
export function settlementTotalsOf(orders: OrderSettlement[]): SettlementTotals {
  const recorded = orders.filter((o) => o.initialTotal !== 0n);
  return {
    count: orders.length,
    initialTotal: recorded.reduce((sum, o) => sum + o.initialTotal, 0n),
    lastBalance: recorded.reduce((sum, o) => sum + o.lastBalance, 0n),
    unrecorded: orders.length - recorded.length,
  };
}

export interface OrderSettlementSorting extends SettlementSort {
  onChange: (sort: SettlementSort) => void;
}
export interface OrderSettlementPaging {
  page: number;
  pageSize: number;
  /** Every order the filters match, across all pages — the server's `total_items`. */
  count: number;
  onPageChange: (page: number) => void;
  /** The per-page choices. Required: the selector is on screen even when one page holds everything. */
  pageSizeOptions: number[];
  onPageSizeChange: (size: number) => void;
}

/**
 * The three narrowings the contract can actually do (`the-settlement-list-filters-what-the-contract-can`):
 * the order id, one shop, and the window the account last MOVED in. Controlled — the route holds the
 * state and the server does the narrowing, so the rows that come in are already the filtered set.
 */
export interface OrderSettlementFilters {
  /** The selling team whose shops the picker offers. */
  teamId: bigint;
  search: string;
  onSearchChange: (value: string) => void;
  /** 0n = every shop. */
  shopId: bigint;
  onShopChange: (shopId: bigint) => void;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
}

export interface OrderSettlementPageProps {
  orders: OrderSettlement[];
  onOpenOrder?: (orderId: bigint) => void;
  /**
   * The pager under the table. Optional so the component still renders from rows alone; the route
   * passes it from the query. When given it is ALWAYS on screen, on one page and on none
   * (`the-settlement-list-always-shows-its-pager`).
   */
  paging?: OrderSettlementPaging;
  /** The filter bar. Optional so the component still renders from rows alone. */
  filters?: OrderSettlementFilters;
  /** The sort the rows arrived in, and how to ask for another. Optional: without it no heading sorts. */
  sort?: OrderSettlementSorting;
  /** The server's sums over the filtered set. Omitted, they are computed from the rows given. */
  totals?: SettlementTotals;
  /**
   * A refetch is running over rows already on screen (HARD RULE 10: `isFetching && !isPending`).
   * Dims the card and the table only — never the filter bar, which is what somebody is using while
   * the next rows load, and which the overlay would otherwise make unclickable.
   */
  busy?: boolean;
}

export function OrderSettlementPage({
  orders,
  onOpenOrder,
  paging,
  filters,
  sort,
  totals,
  busy = false,
}: OrderSettlementPageProps) {
  const { t } = useTranslation();

  // ⚠ NOT re-sorted here. The server ranks the whole set (`the-settlement-list-sorts-by-its-headings`)
  // and a page re-sorted on the client would undo a heading the moment it was clicked.
  const rows = orders;
  const summary = useMemo(() => totals ?? settlementTotalsOf(orders), [totals, orders]);

  return (
    <Stack gap="section" data-testid="order-settlement-page">
      <Heading size="md">{t("orderSettlement.listTitle")}</Heading>

      <Text fontSize="sm" color="fg.muted">
        {t("orderSettlement.listSubtitle")}
      </Text>

      {filters && <SettlementFilterBar filters={filters} sort={sort} />}

      <RefreshOverlay busy={busy}>
        <Stack gap="section">
          <SettlementSummary totals={summary} />

          <Box overflowX="auto">
            <Table.Root size="sm" interactive data-testid="settlement-list-table">
              <Table.Header>
                <Table.Row>
                  <SortHeader by="orderId" sort={sort} label={t("orderSettlement.col.order")} />
                  {/* Not sortable: the server knows a shop's id, not its name, so the order would not
                      be alphabetical — narrowing to one shop is the filter's job. */}
                  <Table.ColumnHeader>{t("orderSettlement.col.shop")}</Table.ColumnHeader>
                  <SortHeader by="sold" sort={sort} label={t("orderSettlement.col.estimate")} end />
                  <SortHeader by="received" sort={sort} label={t("orderSettlement.col.received")} end />
                  <SortHeader by="loss" sort={sort} label={t("orderSettlement.col.lost")} end />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {rows.map((order) => (
                  <ListRow key={String(order.orderId)} order={order} onOpen={onOpenOrder} />
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        </Stack>
      </RefreshOverlay>

      {paging && (
        <Pagination
          page={paging.page}
          pageSize={paging.pageSize}
          count={paging.count}
          onPageChange={paging.onPageChange}
          pageSizeOptions={paging.pageSizeOptions}
          onPageSizeChange={paging.onPageSizeChange}
          alwaysShow
        />
      )}
    </Stack>
  );
}

// ── The summary ─────────────────────────────────────────────────────────────────────────────────

// THE ORDER LIST'S CARDS (owner: *"aku ingin statistik designnya seperti di order list"*) — the same
// `SummaryStrip` and `SummaryCard`, so the two lists read alike: a label, one figure, a quiet line.
//
// Every figure is the WHOLE filtered set. There is NO deductions card: `sale − Σ payout` cannot be summed
// without the payouts, which the server does not sum and the page does not hold — so it was removed
// rather than filled from this page (owner: *"kalau tidak statnya hilangkan saja"*).
function SettlementSummary({ totals }: { totals: SettlementTotals }) {
  const { t } = useTranslation();
  // The ADJUSTMENT (owner: *"untuk konteks order biasanya paling tepat adalah adjustment atau
  // penyesuaian"*) — what reached us less the selling price, signed: −10.000 is 10.000 short.
  const adjustment = totals.lastBalance;
  const received = totals.initialTotal + totals.lastBalance;

  // Two decimals, ROUNDED — so a share under 1% does not read "0%", and Received and Lost, which are
  // the two halves of the same sales, add up to 100% instead of 99.99%.
  const ofSales = (part: bigint) =>
    totals.initialTotal > 0n
      ? t("orderSettlement.stat.ofSales", {
          pct: ((Number(part) * 100) / Number(totals.initialTotal)).toFixed(2),
        })
      : "—";

  return (
    <SummaryStrip testId="settlement-summary">
      <SummaryCard
        label={t("orderSettlement.stat.orders")}
        value={totals.count.toLocaleString()}
        line={
          totals.unrecorded > 0
            ? t("orderSettlement.stat.unrecorded", { count: totals.unrecorded })
            : t("orderSettlement.stat.allRecorded")
        }
        testId="settlement-stat-orders"
      />
      <SummaryCard
        label={t("orderSettlement.stat.sold")}
        value={formatRupiah(totals.initialTotal)}
        line={t("orderSettlement.stat.soldLine", { count: totals.count - totals.unrecorded })}
        testId="settlement-stat-sold"
      />
      <SummaryCard
        label={t("orderSettlement.stat.received")}
        value={formatRupiah(received)}
        line={ofSales(received)}
        testId="settlement-stat-received"
      />
      <SummaryCard
        label={t("orderSettlement.stat.lost")}
        value={
          <Text as="span" color={adjustment < 0n ? "fg.error" : adjustment > 0n ? "fg.success" : undefined}>
            {formatSignedRupiah(adjustment)}
          </Text>
        }
        line={ofSales(adjustment < 0n ? -adjustment : adjustment)}
        testId="settlement-stat-lost"
      />
    </SummaryStrip>
  );
}

// ── The sortable heading ────────────────────────────────────────────────────────────────────────

// Click to sort by this column, LARGEST first; click again to flip (owner: *"cukup bolak-balik"* — no
// third click back to the default). The arrow shows on the active column; the others show that they
// can be sorted.
function SortHeader({
  by,
  sort,
  label,
  end = false,
}: {
  by: SettlementSortKey;
  sort?: OrderSettlementSorting;
  label: ReactNode;
  end?: boolean;
}) {
  const { t } = useTranslation();

  if (!sort) {
    return <Table.ColumnHeader textAlign={end ? "end" : undefined}>{label}</Table.ColumnHeader>;
  }

  const active = sort.by === by;
  const icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;

  return (
    <Table.ColumnHeader
      textAlign={end ? "end" : undefined}
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
    >
      <Flex
        as="button"
        align="center"
        justify={end ? "flex-end" : "flex-start"}
        gap="1"
        w="full"
        cursor="pointer"
        fontWeight={active ? "bold" : undefined}
        aria-label={t("orderSettlement.sortBy", { column: label })}
        data-testid={`settlement-sort-${by}`}
        data-sort={active ? sort.dir : undefined}
        onClick={() =>
          sort.onChange({ by, dir: active && sort.dir === "desc" ? "asc" : "desc" })
        }
      >
        {label}
        <Icon as={icon} boxSize="3.5" color={active ? "fg" : "fg.subtle"} />
      </Flex>
    </Table.ColumnHeader>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────────────────────────

function ListRow({
  order,
  onOpen,
}: {
  order: OrderSettlement;
  onOpen?: (orderId: bigint) => void;
}) {
  const { t } = useTranslation();
  const unknown = order.initialTotal === 0n;
  const adjustment = order.lastBalance;

  return (
    <Table.Row
      cursor={onOpen ? "pointer" : undefined}
      onClick={() => onOpen?.(order.orderId)}
      data-testid={`settlement-row-${order.orderId}`}
    >
      <Table.Cell>
        <Text fontSize="sm">{order.orderRef || t("orderSettlement.noRef")}</Text>
        {/* ⚠ NO SOURCE BADGE ON THE ROW (owner: *"hilangkan sama sekali"*). Whether an order holds a
            hand-typed entry needs its entries, which a list row does not carry — so a Manual mark here
            could only ever be right in a story. The source shows on each entry in the order's ledger. */}
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm">{order.shopName}</Text>
      </Table.Cell>

      {unknown ? (
        // ⚠ No estimate means no denominator, so every figure on this row would be a fiction.
        // The row refuses rather than printing one — see fixtures.noEstimate.
        <Table.Cell colSpan={3} data-testid="row-no-estimate">
          <Flex align="center" gap="2">
            <Icon as={TriangleAlert} boxSize="4" color="warning.fg" />
            <Text fontSize="sm" color="fg.muted">
              {t("orderSettlement.rowNoEstimate")}
            </Text>
          </Flex>
        </Table.Cell>
      ) : (
        <>
          <Table.Cell textAlign="end">
            <Text fontSize="sm">{formatRupiah(order.initialTotal)}</Text>
          </Table.Cell>
          <Table.Cell textAlign="end">
            <Text fontSize="sm">{formatRupiah(netReceived(order))}</Text>
          </Table.Cell>
          <Table.Cell textAlign="end">
            <Text
              fontSize="sm"
              fontWeight="medium"
              color={adjustment < 0n ? "fg.error" : adjustment > 0n ? "fg.success" : undefined}
            >
              {formatSignedRupiah(adjustment)}
            </Text>
          </Table.Cell>
        </>
      )}
    </Table.Row>
  );
}

// Every sort the headings offer, as the phone's one control lists them — the headings' order, each
// measure largest first then smallest.
const SORT_OPTIONS: [SettlementSortKey, "desc" | "asc"][] = [
  ["loss", "desc"],
  ["loss", "asc"],
  ["sold", "desc"],
  ["sold", "asc"],
  ["received", "desc"],
  ["received", "asc"],
  ["orderId", "desc"],
  ["orderId", "asc"],
];

// ── The filters ─────────────────────────────────────────────────────────────────────────────────

// The shared FilterBar (search in the row, the rest in a sheet on a phone), in reading order: the order
// id, the shop, then the date.
function SettlementFilterBar({
  filters,
  sort,
}: {
  filters: OrderSettlementFilters;
  sort?: OrderSettlementSorting;
}) {
  const { t } = useTranslation();
  // A phone reads the list without headings to tap, so the sort moves into the sheet
  // (`the-settlement-list-sorts-by-its-headings`). A JS breakpoint, never CSS hiding.
  const isMobile = useIsMobile();
  const count = [filters.search.trim() !== "", filters.shopId > 0n, !isAllDates(filters.range)].filter(
    Boolean,
  ).length;

  return (
    <FilterBar
      active={count > 0}
      count={count}
      testId="settlement-filters"
      onClear={() => {
        filters.onSearchChange("");
        filters.onShopChange(0n);
        filters.onRangeChange(ALL_DATES);
      }}
    >
      {/* ⚠ THE ORDER ID, not the marketplace's reference: settlement keys on our id and never sees
          the platform's, so the server matches `CAST(order_id AS TEXT) LIKE %q%` and nothing else. The
          placeholder says so, or somebody types a resi and concludes the order has no account. */}
      <FilterSearch
        value={filters.search}
        onChange={filters.onSearchChange}
        placeholder={t("orderSettlement.searchPlaceholder")}
        testId="settlement-search"
      />

      <FilterField testId="settlement-shop-filter">
        <ShopSelect
          teamId={filters.teamId}
          value={filters.shopId > 0n ? filters.shopId : undefined}
          placeholder={t("orderSettlement.allShops")}
          onChange={filters.onShopChange}
        />
      </FilterField>

      {/* The order list's picker (owner), with ONE field segment that names the date: it is when the
          account last MOVED — its latest entry — not when the order was placed. A plain picker would
          read as the order date and quietly answer a different question. The segment is also where an
          order-date choice goes the day the contract can filter on it. */}
      <FilterField w="auto">
        <DateRangePicker
          value={filters.range}
          onChange={filters.onRangeChange}
          fields={[{ value: "moved", label: t("orderSettlement.lastMoved") }]}
          field="moved"
          testId="settlement-date"
        />
      </FilterField>

      {isMobile && sort && (
        <FilterField testId="settlement-sort-field">
          <NativeSelect.Root>
            <NativeSelect.Field
              aria-label={t("orderSettlement.sortLabel")}
              data-testid="settlement-sort-select"
              value={`${sort.by}:${sort.dir}`}
              onChange={(e) => {
                const [by, dir] = e.target.value.split(":") as [SettlementSortKey, "desc" | "asc"];
                sort.onChange({ by, dir });
              }}
            >
              {SORT_OPTIONS.map(([by, dir]) => (
                <option key={`${by}:${dir}`} value={`${by}:${dir}`}>
                  {t(`orderSettlement.sortOption.${by}.${dir}`)}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FilterField>
      )}
    </FilterBar>
  );
}
