import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Box, Flex, HStack, Heading, Icon, Stack, Tabs, Tag, Text } from "@chakra-ui/react";
import { ChartLine, Info, Table2 } from "lucide-react";

import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker } from "../../components/datetime/DateRangePicker";
import { toaster } from "../../components/feedback/Toaster";
import {
  type FilterType,
  type MetricDef,
  TABLE_GROUPS,
  type TableGroup,
  isTimeGroup,
  metricById,
  metricSlug,
  sharedFilters,
} from "../../features/analytic/catalogue";
import { type ReportResult, type ReportSort, loadReport } from "../../features/analytic/provider";
import { SAMPLE_PRODUCTS, SAMPLE_SHOPS, SAMPLE_SUPPLIERS, type SampleEntity } from "../../features/analytic/sample";
import {
  DEFAULT_RANGE,
  PAGE_SIZES,
  type ReportState,
  type ReportView,
  defaultSort,
  formatReportState,
  parseReportState,
} from "../../features/analytic/url";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { windowOf } from "../../features/settlement/window";
import { useIsMobile } from "../../layouts/shell";
import { CATEGORY_ICON, MetricPicker } from "./components/MetricPicker";
import { PlainSelect } from "./components/PlainSelect";
import { ReportGraphs } from "./components/ReportGraphs";
import { ReportHeadline } from "./components/ReportHeadline";
import { ReportTable } from "./components/ReportTable";
import { keyLabel } from "./format";
import { ANALYTIC_PENDING } from "./pending";

const EMPTY: ReportResult = { keys: [], hasNext: false, cells: {}, summary: {} };

type EntityFilter = "shop" | "product" | "supplier";

const ENTITIES: Record<EntityFilter, SampleEntity[]> = { shop: SAMPLE_SHOPS, product: SAMPLE_PRODUCTS, supplier: SAMPLE_SUPPLIERS };

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
// ⚠ BUILT AHEAD OF ITS BACKEND (HARD RULE 6). The figures are invented (features/analytic/sample.ts), the metric list is a
// mirror of the decided proto options, and the menu entry waits until a real metric is wired — the pending strip says so.
//
// The whole state lives in the URL (the-report-lives-in-the-url), so a second tab is the compare view
// (compare-in-another-tab-for-now).
export function AnalyticPage() {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const state = parseReportState(params);

  const defs = defsOf(state.metricIds);
  const shared: FilterType[] = defs.length > 0 ? sharedFilters(defs) : ["dateRange"];
  const sort = state.sort ?? defaultSort(state.groupBy, state.metricIds);
  const { from, to } = windowOf(state.range);
  const valid = from !== "" && to !== "" && from <= to;

  const filters = {
    from,
    to,
    shop: shared.includes("shop") ? state.shop || undefined : undefined,
    product: shared.includes("product") ? state.product || undefined : undefined,
    supplier: shared.includes("supplier") ? state.supplier || undefined : undefined,
  };

  const report = useMemo(
    () =>
      valid && sort
        ? loadReport({
            groupBy: state.groupBy,
            metricIds: state.metricIds,
            filters,
            sort,
            page: state.page,
            pageSize: state.pageSize,
          })
        : EMPTY,
    // The URL is the state: one string covers every input, and `from`/`to` move with the clock on a relative range.
    [params.toString(), from, to],
  );

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
    const lost = (["shop", "product", "supplier"] as const).filter((f) => state[f] !== "" && !next.includes(f));

    commit({
      metricIds: [...state.metricIds, metricId],
      ...Object.fromEntries(lost.map((f) => [f, ""])),
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

  const filtering = [!isDefaultRange(state), ...(["shop", "product", "supplier"] as const).map((f) => shared.includes(f) && state[f] !== "")].filter(
    Boolean,
  ).length;

  const sortOptions = [
    ...(isTimeGroup(state.groupBy)
      ? (["desc", "asc"] as const).map((dir) => ({ value: `key:${dir}`, label: t("analytic.sortOption", { field: t("analytic.period"), dir: t(`analytic.dateDir.${dir}`) }) }))
      : []),
    ...defs.flatMap((def) =>
      def.fields
        .filter((f) => f.canSort)
        .flatMap((f) =>
          (["desc", "asc"] as const).map((dir) => ({
            value: `${def.metricId}:${f.name}:${dir}`,
            label: t("analytic.sortOption", { field: t(`analytic.field.${f.name}`), dir: t(`analytic.dir.${dir}`) }),
          })),
        ),
    ),
  ];

  const entityField = (kind: EntityFilter) =>
    shared.includes(kind) && (
      <FilterField key={kind} w="13rem" testId={`analytic-filter-${kind}`}>
        <HStack gap="2">
          <Box flex="1" minW="0">
            <PlainSelect
              items={[
                { value: "all", label: t(`analytic.all.${kind}`) },
                ...ENTITIES[kind].map((e) => ({ value: e.id, label: e.name })),
              ]}
              value={state[kind] || "all"}
              onChange={(v) => commit({ [kind]: v === "all" ? "" : v })}
              ariaLabel={filterLabel(kind)}
              testId={`analytic-${kind}`}
            />
          </Box>
          <NotImplemented list={ANALYTIC_PENDING} id="pickers" />
        </HStack>
      </FilterField>
    );

  const ranker = sort?.by === "field" ? metricById(sort.metricId) : undefined;

  return (
    <Stack gap="section" data-testid="analytic-page">
      <Stack gap="1">
        <HStack gap="2">
          <Heading size="md">{t("analytic.title")}</Heading>
          <NotImplemented list={ANALYTIC_PENDING} id="figures" />
        </HStack>
        <Text fontSize="sm" color="fg.muted">
          {t("analytic.subtitle")}
        </Text>
      </Stack>

      <NotImplementedSummary list={ANALYTIC_PENDING} />

      {/* THE TABLE'S SHAPE — what a row is, and what the columns are. The group is chosen once, for the whole table
          (the-table-picks-one-group); each metric on it is a chip that takes its columns away. */}
      <Flex gap="3" align="center" wrap="wrap" data-testid="analytic-shape">
        <HStack gap="2">
          <Text fontSize="sm" fontWeight="bold" color="fg.label" whiteSpace="nowrap">
            {t("analytic.groupBy")}
          </Text>
          <Box w="10rem">
            <PlainSelect
              items={TABLE_GROUPS.map((g) => ({ value: g, label: t(`analytic.group.${g}`) }))}
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
        onClear={() => commit({ range: DEFAULT_RANGE, shop: "", product: "", supplier: "" })}
      >
        <FilterField w="auto">
          <DateRangePicker value={state.range} onChange={(range) => commit({ range })} testId="analytic-range" />
        </FilterField>
        {entityField("shop")}
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
          {t("analytic.rangeInvalid")}
        </Text>
      )}

      {defs.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" data-testid="analytic-empty">
          {t("analytic.empty.noMetric", { group: t(`analytic.groupPlural.${state.groupBy}`) })}
        </Text>
      ) : (
        <>
          <ReportHeadline defs={defs} summary={report.summary} sort={sort} />

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
                  defs={defs}
                  cells={report.cells}
                  sort={sort}
                  onSortChange={(next) => commit({ sort: next })}
                  labelOf={(key) => keyLabel(state.groupBy, key, t, i18n.language)}
                />
              </Tabs.Content>
              {/* THE TABLE AS GRAPHS — one per kind of number, drawn from the same cells (the-graph-draws-the-table). */}
              <Tabs.Content value="graph" p="0">
                <ReportGraphs
                  groupBy={state.groupBy}
                  keys={report.keys}
                  defs={defs}
                  cells={report.cells}
                  labelOf={(key) => keyLabel(state.groupBy, key, t, i18n.language)}
                />
              </Tabs.Content>
              {/* No total, only whether another page follows (a-page-says-whether-another-follows) — the growing pager. */}
              <GrowingPager
                page={state.page}
                onPageChange={(page) => commit({ page }, false)}
                hasNext={report.hasNext}
                resetKey={[state.groupBy, state.metricIds.join(","), from, to, state.shop, state.product, state.supplier, sortValue(sort), state.pageSize].join("|")}
                pageSize={state.pageSize}
                pageSizeOptions={PAGE_SIZES}
                onPageSizeChange={(pageSize) => commit({ pageSize })}
                testId="analytic-pager"
              />
            </Stack>
          </Tabs.Root>
        </>
      )}
    </Stack>
  );
}
