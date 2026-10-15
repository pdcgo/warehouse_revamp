import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Flex, Icon, Stack } from "@chakra-ui/react";
import { TrendingDown } from "lucide-react";

import { ALL_DATES } from "../../components/datetime/DateRangePicker";
import { useTeam } from "../../features/team/TeamContext";
import {
  DEFAULT_SETTLEMENT_SORT,
  useOrderSettlements,
  type SettlementSort,
  type SettlementSortKey,
} from "../../features/settlement/queries";
import { windowOf } from "../../features/settlement/window";
import { useDebounced } from "../../lib/useDebounced";
import { dateRangeCodec, idCodec, sortCodec, textCodec, useUrlState } from "../../lib/urlState";
import { OrderSettlementPage } from "./index";

// THE ROUTE-LEVEL CONTAINER for the settlement list.
//
// ⚠ It is separate from `OrderSettlementPage` on purpose. That component takes its rows as a PROP,
// which is what lets its 29 story tests pin the design without a server — the prototype was reviewed
// and accepted in exactly that shape (`design-accepted`), so wiring it up must not rewrite it. The
// query lives here instead, and the accepted component is used unchanged.

// The app's per-page choices and default (shops, suppliers, racks, financial accounts all use them).
export const SETTLEMENT_PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;

// The columns the list sorts by (SettlementSortKey).
const SORT_CODEC = sortCodec<SettlementSortKey>(["orderId", "sold", "received", "loss"]);

export function SettlementListRoute() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // THE FILTERS AND THE SORT LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh, or Back from an order,
  // opens the same narrowed list.
  const [search, setSearch] = useUrlState("q", "", textCodec);
  const [shopId, setShopId] = useUrlState("shop", 0n, idCodec);
  const [range, setRange] = useUrlState("range", ALL_DATES, dateRangeCodec);
  const [sort, setSort] = useUrlState<SettlementSort>("sort", DEFAULT_SETTLEMENT_SORT, SORT_CODEC);

  const teamId = current?.teamId;
  const q = useDebounced(search.trim());
  const { from, to } = windowOf(range);
  const query = useOrderSettlements({ teamId, shopId, q, from, to, sort, page, pageSize });

  // Any filter change restarts at page 1: the page number belongs to the old result set, and page 4
  // of a narrower one is usually empty — which reads as "nothing matched" when plenty did.
  function refilter(apply: () => void) {
    apply();
    setPage(1);
  }

  return (
    <Stack gap="section">
      {/* The way from one order at a time to the period view. Here rather than inside the accepted
          component, for the reason above. */}
      <Flex justify="flex-end">
        <Button
          variant="outline"
          onClick={() => navigate("/settlement/report")}
          data-testid="open-settlement-report"
        >
          <Icon as={TrendingDown} boxSize="4" />
          {t("settlementReport.openReport")}
        </Button>
      </Flex>

      {/*
        The pair from HARD RULE 10: always-fresh reads, and the PREVIOUS rows kept on screen while
        the next ones load. `isPending` is excluded — a genuine first load has no rows to keep, and
        dimming an empty table behind a progress bar is two spinners for one wait. The overlay is
        INSIDE the list, around the card and the table, so the filter bar stays usable while it runs.
      */}
      <OrderSettlementPage
        orders={query.data?.settlements ?? []}
        onOpenOrder={(orderId) => navigate(`/orders/${orderId}`)}
        busy={query.isFetching && !query.isPending}
        loading={query.isPending}
        // A new order is a new first page: page 3 of one ranking is not page 3 of another.
        sort={{ ...sort, onChange: (next) => refilter(() => setSort(next)) }}
        totals={
          query.data && {
            count: query.data.totalItems,
            initialTotal: query.data.totalInitialTotal,
            lastBalance: query.data.totalLastBalance,
            unrecorded: query.data.totalUnrecorded,
          }
        }
        filters={
          teamId === undefined
            ? undefined
            : {
                teamId,
                search,
                onSearchChange: (value) => refilter(() => setSearch(value)),
                shopId,
                onShopChange: (id) => refilter(() => setShopId(id)),
                range,
                onRangeChange: (r) => refilter(() => setRange(r)),
              }
        }
        paging={{
          page,
          pageSize,
          count: query.data?.totalItems ?? 0,
          onPageChange: setPage,
          pageSizeOptions: SETTLEMENT_PAGE_SIZE_OPTIONS,
          onPageSizeChange: (size) => refilter(() => setPageSize(size)),
        }}
      />
    </Stack>
  );
}
