import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Box, Flex, HStack, Heading, Icon, Stack, Tabs, Tag, Text } from "@chakra-ui/react";
import { ChartLine, Info, Table2 } from "lucide-react";

import { rpcError } from "../../api/clients";
import { listQuery } from "../../api/queryClient";
import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker } from "../../components/datetime/DateRangePicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { PersonFilterSelect } from "../../components/pickers/PersonFilterSelect";
import { TeamSelect } from "../../components/teams/TeamSelect";
import {
  type FilterType,
  type MetricDef,
  type TableGroup,
  isTimeGroup,
  metricById,
  metricSlug,
  sharedFilters,
  tableGroups,
} from "../../features/analytic/catalogue";
import { useAnalyticPeople } from "../../features/analytic/people";
import { EMPTY_REPORT, type ReportSort, answeredFields, loadReport } from "../../features/analytic/provider";
import {
  DEFAULT_RANGE,
  PAGE_SIZES,
  type ReportState,
  type ReportView,
  defaultSort,
  formatReportState,
  parseReportState,
} from "../../features/analytic/url";
import { windowOf } from "../../features/settlement/window";
import { useTeam } from "../../features/team/TeamContext";
import { AccountsFilter } from "../../features/financialAccount/AccountsFilter";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useIsMobile } from "../../layouts/shell";
import { EntityFilter, type EntityFilterKind } from "./components/EntityFilter";
import { CATEGORY_ICON, MetricPicker } from "./components/MetricPicker";
import { PlainSelect } from "./components/PlainSelect";
import { ReportGraphs } from "./components/ReportGraphs";
import { ReportHeadline } from "./components/ReportHeadline";
import { ReportTable } from "./components/ReportTable";
import { fieldLabel, keyLabel, useKeyNames } from "./format";
import { MAX_PERIOD_DAYS, spanDays } from "../../lib/period";
import { formatUnixDateTimeShort } from "../../lib/datetime";

/** Every filter naming one entity — what a metric that cannot use one makes the screen drop. */
const ENTITY_FILTERS = ["shop", "team", "warehouse", "user", "product", "supplier"] as const;

/** No metric asks for people — the "created by" field is not on the screen. */
const NO_METRICS: MetricDef[] = [];

const isDefaultRange = (state: ReportState) =>
  state.range.kind === "relative" && DEFAULT_RANGE.kind === "relative" && state.range.days === DEFAULT_RANGE.days;

function defsOf(metricIds: string[]): MetricDef[] {
  return metricIds.map(metricById).filter((d): d is MetricDef => d !== undefined);
}

/** The sort as one string, for the phone's sort select — `key:desc`, `<metricId>:<field>:asc`. */
function sortValue(sort: ReportSort | null): string {
  if (!sort) return "";

  return sort.by === "key" ? `key:${sort.dir}` : `${sort.metricId}:${sort.field}:${sort.dir}`;
}

// AnalyticPage — the composer behind the Analytic menu (docs/business/analytic/rpc_provide.md): the person picks how the
// table is GROUPED, which METRICS are its columns — from any service — one column to SORT by, and the filters every
// chosen metric shares. One service ranks the rows; every service fills them (the-two-steps).
//
// Every metric is SERVED and read off its service's contract (features/analytic/catalogue.ts) — the expense metrics last,
// 2026-11-06 — so the screen carries no pending mark any more. A new metric is drawn as a Storybook prototype first.
//
// The whole state lives in the URL (the-report-lives-in-the-url), so a second tab is the compare view
// (compare-in-another-tab-for-now).
export function AnalyticPage() {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { current } = useTeam();
  const teamId = current?.teamId;
  const [params, setParams] = useSearchParams();
  const state = parseReportState(params);

  const defs = defsOf(state.metricIds);
  const shared: FilterType[] = defs.length > 0 ? sharedFilters(defs) : ["dateRange"];
  // WHO THE "CREATED BY" FILTER OFFERS — the people on the chosen metrics' own rows, each service answering for its own
  // (a-who-filter-lists-the-people-on-its-rows), never the system-wide user search. Asked only while the filter shows.
  const people = useAnalyticPeople(teamId, shared.includes("user") ? defs : NO_METRICS);
  const sort = state.sort ?? defaultSort(state.groupBy, state.metricIds);
  const { from, to } = windowOf(state.range);
  // A YEAR AT MOST (a-metric-reads-at-most-a-year) — the server refuses a longer range, so it is not sent, and the line
  // under the picker says why rather than showing a refusal.
  const span = spanDays(from, to);
  const tooLong = span > MAX_PERIOD_DAYS;
  const valid = from !== "" && to !== "" && from <= to && !tooLong;

  const filters = {
    from,
    to,
    shop: shared.includes("shop") ? state.shop || undefined : undefined,
    product: shared.includes("product") ? state.product || undefined : undefined,
    supplier: shared.includes("supplier") ? state.supplier || undefined : undefined,
    team: shared.includes("team") ? state.team || undefined : undefined,
    warehouse: shared.includes("warehouse") ? state.warehouse || undefined : undefined,
    user: shared.includes("user") ? state.user || undefined : undefined,
    accounts: shared.includes("account") && state.accounts.length > 0 ? state.accounts : undefined,
  };

  // THE REPORT — asked of every service that serves a chosen metric. `listQuery`: a page, a sort or a filter REFINES the
  // same table, so the previous rows stay on screen behind the overlay while the next ones load (HARD RULE 10).
  const query = useQuery({
    ...listQuery,
    // The URL is the state: one string covers every input, and `from`/`to` move with the clock on a relative range.
    queryKey: ["analytic", "report", String(teamId ?? 0n), params.toString(), from, to],
    enabled: valid && sort !== null && teamId !== undefined,
    queryFn: () =>
      loadReport(
        { groupBy: state.groupBy, metricIds: state.metricIds, filters, sort: sort!, page: state.page, pageSize: state.pageSize },
        teamId!,
      ),
  });
  const report = query.data ?? EMPTY_REPORT;

  // A column the service left unset is not the reader's to see — a warehouse reads no seller money
  // (a-warehouse-sees-no-seller-money) — so it goes, rather than reading 0.
  const shown = answeredFields(defs, report);
  const names = useKeyNames(state.groupBy, report.keys, teamId);

  const commit = (next: Partial<ReportState>, restart = true) =>
    setParams(formatReportState({ ...state, ...next, ...(restart ? { page: 1 } : {}) }), { replace: true });

  const metricLabel = (def: MetricDef) => t(`analytic.metric.${def.labelKey}`);
  const filterLabel = (f: FilterType) => t(`analytic.filter.${f}`);

  // A NEW GROUP REMOVES THE COLUMNS THAT CANNOT FOLLOW IT, AND SAYS SO (a-group-change-drops-the-columns-that-cannot-follow).
  // The rows ARE the group, so it is the metrics that give way, never the group.
  const setGroup = (groupBy: TableGroup) => {
    const kept = defs.filter((d) => d.supportedGroupBy.includes(groupBy));
    const dropped = defs.filter((d) => !d.supportedGroupBy.includes(groupBy));
    const sortKept =
      sort?.by === "field" ? kept.some((d) => d.metricId === sort.metricId) : sort?.by === "key" && isTimeGroup(groupBy);

    commit({ groupBy, metricIds: kept.map((d) => d.metricId), sort: sortKept ? state.sort : null });

    if (dropped.length > 0) {
      toaster.create({
        type: "info",
        title: t("analytic.toast.metricRemoved", { count: dropped.length, metrics: dropped.map(metricLabel).join(", ") }),
        description: t("analytic.toast.metricRemovedReason", { group: t(`analytic.groupPlural.${groupBy}`) }),
      });
    }
  };

  // A NEW METRIC REMOVES THE FILTERS IT CANNOT USE, AND SAYS SO (a-new-metric-removes-the-filters-it-cannot-use,
  // a-removed-filter-is-announced) — every number on screen keeps answering the same question.
  const toggleMetric = (metricId: string, on: boolean) => {
    if (!on) {
      const metricIds = state.metricIds.filter((id) => id !== metricId);
      commit({ metricIds, sort: state.sort?.by === "field" && state.sort.metricId === metricId ? null : state.sort });
      return;
    }

    const def = metricById(metricId);
    if (!def || state.metricIds.includes(metricId)) return;

    const next = sharedFilters([...defs, def]);
    const lost: FilterType[] = [
      ...ENTITY_FILTERS.filter((f) => state[f] !== "" && !next.includes(f)),
      ...(state.accounts.length > 0 && !next.includes("account") ? (["account"] as const) : []),
    ];

    commit({
      metricIds: [...state.metricIds, metricId],
      ...Object.fromEntries(lost.map((f) => (f === "account" ? ["accounts", []] : [f, ""]))),
    });

    if (lost.length > 0) {
      const names = lost.map(filterLabel).join(", ");
      toaster.create({
        type: "info",
        title: t("analytic.toast.filterRemoved", { count: lost.length, filters: names }),
        description: t("analytic.toast.filterRemovedReason", { metric: metricLabel(def), filters: names.toLowerCase() }),
      });
    }
  };

  const filtering = [
    !isDefaultRange(state),
    ...ENTITY_FILTERS.map((f) => shared.includes(f) && state[f] !== ""),
    shared.includes("account") && state.accounts.length > 0,
  ].filter(Boolean).length;

  const sortOptions = [
    ...(isTimeGroup(state.groupBy)
      ? (["desc", "asc"] as const).map((dir) => ({ value: `key:${dir}`, label: t("analytic.sortOption", { field: t("analytic.period"), dir: t(`analytic.dateDir.${dir}`) }) }))
      : []),
    ...shown.flatMap((def) =>
      def.fields
        .filter((f) => f.canSort)
        .flatMap((f) =>
          (["desc", "asc"] as const).map((dir) => ({
            value: `${def.metricId}:${f.name}:${dir}`,
            label: t("analytic.sortOption", { field: fieldLabel(t, def, f.name), dir: t(`analytic.dir.${dir}`) }),
          })),
        ),
    ),
  ];

  // A filter over the team's real entities — its shops, a seller, a warehouse, a person. Cleared, it reads every one.
  const asId = (raw: string) => (raw ? BigInt(raw) : 0n);
  const fromId = (id: bigint | undefined) => (id && id > 0n ? id.toString() : "");

  const realField = (kind: "shop" | "team" | "warehouse" | "user") =>
    shared.includes(kind) &&
    teamId !== undefined && (
      <FilterField key={kind} w="13rem" testId={`analytic-filter-${kind}`}>
        {kind === "shop" && (
          <ShopSelect teamId={teamId} value={asId(state.shop)} onChange={(id) => commit({ shop: fromId(id) })} placeholder={t("analytic.all.shop")} />
        )}
        {(kind === "team" || kind === "warehouse") && (
          <TeamSelect
            value={asId(state[kind])}
            onChange={(id) => commit({ [kind]: fromId(id) })}
            teamType={kind === "team" ? TeamType.SELLING : TeamType.WAREHOUSE}
            placeholder={t(`analytic.all.${kind}`)}
          />
        )}
        {kind === "user" && (
          <PersonFilterSelect
            people={people.people}
            error={people.error}
            value={asId(state.user) || undefined}
            onChange={(id) => commit({ user: fromId(id) })}
            placeholder={t("analytic.all.user")}
          />
        )}
      </FilterField>
    );

  // A PRODUCT OR A SUPPLIER — only Lost stock narrows by one today (metrics/inventory/lost, read by the warehouse that
  // held the stock and the seller that owns it). The team's real entities, searched as that team may search them
  // elsewhere (EntityFilter: a warehouse what it holds, a seller its own); a pick shows as a chip naming it.
  const entityField = (kind: EntityFilterKind) =>
    shared.includes(kind) &&
    teamId !== undefined && (
      <FilterField key={kind} w="13rem" testId={`analytic-filter-${kind}`}>
        <EntityFilter
          kind={kind}
          teamId={teamId}
          teamType={current?.teamType}
          value={state[kind]}
          onChange={(id) => commit({ [kind]: id })}
          placeholder={t(`analytic.all.${kind}`)}
          label={filterLabel(kind).toLowerCase()}
          portalled={!isMobile}
        />
      </FilterField>
    );

  const ranker = sort?.by === "field" ? metricById(sort.metricId) : undefined;

  return (
    <Stack gap="section" data-testid="analytic-page">
      <Stack gap="1">
        <HStack gap="2">
          <Heading size="md">{t("analytic.title")}</Heading>
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {t("analytic.subtitle")}
        </Text>
      </Stack>

      {/* THE TABLE'S SHAPE — what a row is, and what the columns are. The group is chosen once, for the whole table
          (the-table-picks-one-group); each metric on it is a chip that takes its columns away. */}
      <Flex gap="3" align="center" wrap="wrap" data-testid="analytic-shape">
        <HStack gap="2">
          <Text fontSize="sm" fontWeight="bold" color="fg.label" whiteSpace="nowrap">
            {t("analytic.groupBy")}
          </Text>
          <Box w="10rem">
            <PlainSelect
              items={tableGroups().map((g) => ({ value: g, label: t(`analytic.group.${g}`) }))}
              value={state.groupBy}
              onChange={(v) => setGroup(v as TableGroup)}
              ariaLabel={t("analytic.groupBy")}
              testId="analytic-group"
            />
          </Box>
        </HStack>
        {defs.map((def) => (
          <Tag.Root key={def.metricId} size="lg" variant="surface" data-testid={`analytic-chip-${metricSlug(def.metricId)}`}>
            <Tag.StartElement>
              <Icon as={CATEGORY_ICON[def.category]} />
            </Tag.StartElement>
            <Tag.Label>{metricLabel(def)}</Tag.Label>
            <Tag.EndElement>
              <Tag.CloseTrigger
                aria-label={t("analytic.removeMetric", { metric: metricLabel(def) })}
                onClick={() => toggleMetric(def.metricId, false)}
                data-testid={`analytic-chip-${metricSlug(def.metricId)}-remove`}
              />
            </Tag.EndElement>
          </Tag.Root>
        ))}
        <MetricPicker groupBy={state.groupBy} selected={state.metricIds} onToggle={toggleMetric} />
      </Flex>

      {/* THE FILTERS EVERY METRIC ON THE TABLE SHARES — the date range always; a shop, a product, a supplier only while every
          metric can be narrowed by it. On a phone they sit in the sheet with the sort, since there are no headings to tap. */}
      <FilterBar
        active={filtering > 0}
        count={filtering}
        testId="analytic-filters"
        onClear={() =>
          commit({ range: DEFAULT_RANGE, shop: "", product: "", supplier: "", team: "", warehouse: "", user: "", accounts: [] })
        }
      >
        <FilterField w="auto">
          <DateRangePicker value={state.range} onChange={(range) => commit({ range })} testId="analytic-range" />
        </FilterField>
        {/* THE TEAM'S OWN ACCOUNTS, one or several (finance-filters-by-account) — the Finance metrics' filter. */}
        {shared.includes("account") && teamId !== undefined && (
          <FilterField w="15rem" testId="analytic-filter-account">
            <AccountsFilter
              teamId={teamId}
              value={state.accounts}
              onChange={(accounts) => commit({ accounts })}
              testId="analytic-accounts"
            />
          </FilterField>
        )}
        {realField("shop")}
        {realField("team")}
        {realField("warehouse")}
        {realField("user")}
        {entityField("product")}
        {entityField("supplier")}
        {isMobile && sortOptions.length > 0 && (
          <FilterField w="13rem" testId="analytic-filter-sort">
            <PlainSelect
              items={sortOptions}
              value={sortValue(sort)}
              onChange={(v) => {
                const [a, b, c] = v.split(":");
                commit({ sort: a === "key" ? { by: "key", dir: b as "asc" | "desc" } : { by: "field", metricId: a!, field: b!, dir: c as "asc" | "desc" } });
              }}
              ariaLabel={t("analytic.sortBy")}
              testId="analytic-sort"
            />
          </FilterField>
        )}
      </FilterBar>

      {!valid && (
        <Text fontSize="sm" color="fg.error" data-testid="analytic-range-invalid">
          {tooLong
            ? t("analytic.rangeTooLong", { days: span, max: MAX_PERIOD_DAYS })
            : t("analytic.rangeInvalid")}
        </Text>
      )}

      {query.isError && (
        <Text fontSize="sm" color="fg.error" data-testid="analytic-error">
          {rpcError(query.error)}
        </Text>
      )}

      {defs.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" data-testid="analytic-empty">
          {t("analytic.empty.noMetric", { group: t(`analytic.groupPlural.${state.groupBy}`) })}
        </Text>
      ) : (
        <>
          <ReportHeadline defs={shown} summary={report.summary} sort={sort} />

          {/* ONE VIEW AT A TIME (the-table-and-the-graph-are-tabs) — the same rows drawn as a table or as graphs. Switching
              keeps the page, the sort and the filters; the rows line and the pager belong to both, since the graph draws
              the table's page. The graph mounts only on its tab, so it measures a box that is actually on screen. */}
          <Tabs.Root
            value={state.view}
            onValueChange={(e) => commit({ view: e.value as ReportView }, false)}
            variant="line"
            lazyMount
            unmountOnExit
          >
            <Tabs.List>
              <Tabs.Trigger value="table" data-testid="analytic-view-table">
                <Icon as={Table2} boxSize="4" />
                {t("analytic.view.table")}
              </Tabs.Trigger>
              <Tabs.Trigger value="graph" data-testid="analytic-view-graph">
                <Icon as={ChartLine} boxSize="4" />
                {t("analytic.view.graph")}
              </Tabs.Trigger>
            </Tabs.List>

            <RefreshOverlay busy={query.isFetching && !query.isPending}>
            <Stack gap="field" pt="card">
              {/* WHAT THE ROWS ARE, whenever a figure ranks them (the-rows-line-says-what-the-rows-are) — sorting by
                  Profit hands the rows to settlement, and without the line a shop leaving reads as a shop lost. */}
              {ranker && (
                <HStack gap="2" color="fg.muted" fontSize="sm" data-testid="analytic-rows-line">
                  <Icon as={Info} boxSize="4" />
                  <Text>
                    {t("analytic.rowsLine", {
                      group: t(`analytic.groupPlural.${state.groupBy}`),
                      metric: metricLabel(ranker).toLowerCase(),
                    })}
                  </Text>
                </HStack>
              )}
              <Tabs.Content value="table" p="0">
                <ReportTable
                  groupBy={state.groupBy}
                  keys={report.keys}
                  defs={shown}
                  cells={report.cells}
                  sort={sort}
                  onSortChange={(next) => commit({ sort: next })}
                  labelOf={(key) => keyLabel(state.groupBy, key, t, i18n.language, names)}
                />
              </Tabs.Content>
              {/* THE TABLE AS GRAPHS — one per kind of number, drawn from the same cells (the-graph-draws-the-table). */}
              <Tabs.Content value="graph" p="0">
                <ReportGraphs
                  groupBy={state.groupBy}
                  keys={report.keys}
                  defs={shown}
                  cells={report.cells}
                  labelOf={(key) => keyLabel(state.groupBy, key, t, i18n.language, names)}
                />
              </Tabs.Content>
              {/* AS OF WHEN the figures are (a-money-metric-says-as-of-when) — the oldest of the services read. */}
              {report.asOfUnix !== undefined && report.asOfUnix > 0n && (
                  <Text fontSize="xs" color="fg.muted" data-testid="analytic-as-of">
                    {t("common.asOf", { time: formatUnixDateTimeShort(report.asOfUnix) })}
                  </Text>
                )}
              {/* No total, only whether another page follows (a-page-says-whether-another-follows) — the growing pager. */}
              <GrowingPager
                page={state.page}
                onPageChange={(page) => commit({ page }, false)}
                hasNext={report.hasNext}
                resetKey={[
                  state.groupBy,
                  state.metricIds.join(","),
                  from,
                  to,
                  ...ENTITY_FILTERS.map((f) => state[f]),
                  state.accounts.join(","),
                  sortValue(sort),
                  state.pageSize,
                ].join("|")}
                pageSize={state.pageSize}
                pageSizeOptions={PAGE_SIZES}
                onPageSizeChange={(pageSize) => commit({ pageSize })}
                testId="analytic-pager"
              />
            </Stack>
            </RefreshOverlay>
          </Tabs.Root>
        </>
      )}
    </Stack>
  );
}
