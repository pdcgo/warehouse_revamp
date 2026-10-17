import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Stack, Table, Tabs, Text } from "@chakra-ui/react";

import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { PeriodGrainPicker } from "../../components/datetime/PeriodGrainPicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { useIsMobile } from "../../layouts/shell";
import type { PeriodGrain } from "../../lib/period";
import { windowOf } from "../settlement/window";
import { useTeam } from "../team/TeamContext";
import {
  type SupplierFigurePoint,
  type SupplierProductRow,
  useSupplierFigureSeries,
  useSupplierFiguresByProduct,
} from "./analytics";
import { FigureBlock, FigureCells, FigureHeaders, FiguresSummary, RestockTeamFilter } from "./FigureParts";
import { ProductListItem } from "../../components/products/ProductListItem";
import { unitsReceived } from "./figures";

const PAGE_SIZE = 10;

// A ROW LIGHTS UP under the pointer, every cell of it (owner, on the Statistik tab: *"kasih hoverable"* — the supplier
// list's `a-supplier-row-lights-up`), so a row of five figures can be read across. On the cells, not the row, so the
// whole width turns; Chakra's `_hover` honours `data-hover`, which is how a story drives it.
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

export const description =
  "A supplier's Statistics tab — on the manage detail and the discover detail alike. Two views of the same window: Over Time (the figures per day, month or year, newest first, quiet periods included) and By Product. Both read whose restocks (every team's, or one picked selling team's) over a period, under the window's six figures as a headline; only Over Time has a grain. Folded from the restock's accept, so a figure can lag an accept by the broker's delivery.";

export interface SupplierStatisticsProps {
  /** Any team's supplier — its figures count every team's restocks from it. */
  supplierId: bigint;
}

type StatisticsView = "time" | "product";

// SupplierStatistics is a supplier's STATISTICS tab (the-figures-are-a-statistics-tab-and-a-supplier-report): what was
// restocked from it, and how much of that was lost or broken on the way, over a period.
//
// TWO VIEWS, each its own page within the tab (owner: *"dari waktu dan per produk bedakan halamannya"*,
// `the-statistics-tab-is-two-views`) — they were two tables stacked, the second under a pager of the first:
//
//   Dari Waktu ke Waktu | Per Produk                                  ← which view — a tab row, over the filters
//   [Semua tim ⌄] [30 hari terakhir ⌄] [Harian|Bulanan|Tahunan]     ← the grain right of the window, Over Time only
//   Total · Direstok · Hilang · Rusak                                 ← the headline: the whole window, both views
//   the view's table, and its pager
//
// The team and the window are the tab's, so switching view keeps them: the same question, read by period or by item.
//
// ⚠ EVERY TEAM'S RESTOCKS by default (every-selling-team-sees-every-teams-figures) — a broken rate is worth most to
// the team that has NOT bought there yet — narrowed to one selling team by a picker (the-team-filter-picks-any-selling-team).
//
// ⚠ FOLDED, NOT LIVE: the figures are supplier_service's fold of *Restock Accepted* (the-report-is-processed-like-settlement),
// so an accept a moment ago can take a moment to appear.
export function SupplierStatistics({ supplierId }: SupplierStatisticsProps) {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [view, setView] = useState<StatisticsView>("time");
  const [grain, setGrain] = useState<PeriodGrain>("day");
  const [range, setRange] = useState<DateRange>({ kind: "relative", days: 30 });
  // Whose restocks — 0n is every team's.
  const [restockTeamId, setRestockTeamId] = useState(0n);
  const [seriesPage, setSeriesPage] = useState(1);
  const [productPage, setProductPage] = useState(1);

  // A new window, grain or team filter is a new question — back to the first page of whatever it changes.
  const pickGrain = (next: PeriodGrain) => {
    setGrain(next);
    setSeriesPage(1);
  };

  const pickRange = (next: DateRange) => {
    setRange(next);
    setSeriesPage(1);
    setProductPage(1);
  };

  const pickTeam = (next: bigint) => {
    setRestockTeamId(next);
    setSeriesPage(1);
    setProductPage(1);
  };

  const { from, to } = windowOf(range);
  const valid = from !== "" && to !== "" && from <= to;

  const teamId = current?.teamId;

  // The series is read on BOTH views — its `total` is the headline.
  const series = useSupplierFigureSeries({
    teamId,
    supplierId,
    from,
    to,
    valid,
    restockTeamId,
    grain,
    page: seriesPage,
    pageSize: PAGE_SIZE,
  });
  // By product only once that view is open — nobody waits on a table they are not looking at.
  const products = useSupplierFiguresByProduct({
    teamId,
    supplierId,
    from,
    to,
    valid: valid && view === "product",
    restockTeamId,
    page: productPage,
    pageSize: PAGE_SIZE,
  });

  // Nothing at all in the window — said once, instead of a headline of zeroes over a table of zeroes.
  const quiet = series.data !== undefined && unitsReceived(series.data.total) === 0;

  const empty = (
    <Text color="fg.muted" data-testid="statistics-empty">
      {restockTeamId !== 0n ? t("supplierStats.emptyTeam") : t("supplierStats.empty")}
    </Text>
  );

  return (
    <Tabs.Root
      value={view}
      onValueChange={(e) => setView(e.value as StatisticsView)}
      // Only the open view is mounted — its table, its pager, and one empty line, never two.
      lazyMount
      unmountOnExit
      data-testid="supplier-statistics"
    >
      <Stack gap="section">
        {/* WHICH VIEW — first, over the filters (owner: *"tipe dari waktu ke waktu dan per produk di atas filter"*): the
            view decides which filters there are, so it is picked before them. The line tabs in the main tone
            (a-selected-tab-is-in-the-main-tone). */}
        <Tabs.List data-testid="statistics-views">
          <Tabs.Trigger value="time" data-testid="statistics-view-time">
            {t("supplierStats.overTime")}
          </Tabs.Trigger>
          <Tabs.Trigger value="product" data-testid="statistics-view-product">
            {t("supplierStats.byProduct")}
          </Tabs.Trigger>
        </Tabs.List>

        <FilterBar
          testId="statistics-filter"
          active={restockTeamId !== 0n}
          count={restockTeamId !== 0n ? 1 : 0}
          onClear={() => pickTeam(0n)}
        >
          <FilterField w="15rem" testId="statistics-team">
            <RestockTeamFilter value={restockTeamId} onChange={pickTeam} />
          </FilterField>
          <FilterField w="auto">
            <DateRangePicker value={range} onChange={pickRange} testId="statistics-range" />
          </FilterField>
          {/* The grain RIGHT OF THE WINDOW it cuts (owner: *"harian bulanan di kanan tanggal"*). A grain is a property of
              a SERIES — by product, the window is one figure per item, so it is Over Time's only. */}
          {view === "time" && (
            <FilterField w="auto">
              <PeriodGrainPicker value={grain} onChange={pickGrain} testId="statistics-grain" />
            </FilterField>
          )}
        </FilterBar>

        {!valid && (
          <Text fontSize="sm" color="error.fg" data-testid="statistics-range-invalid">
            {t("supplierFigures.rangeInvalid")}
          </Text>
        )}

        <RefreshOverlay busy={series.isFetching && !series.isPending}>
          <FiguresSummary figures={series.data?.total} testId="statistics-summary" />
        </RefreshOverlay>

        <Stack gap="field">
          <Tabs.Content value="time" p="0">
            {quiet ? (
              empty
            ) : (
              <Stack gap="field">
                <RefreshOverlay busy={series.isFetching && !series.isPending}>
                  <SeriesTable points={series.data?.points ?? []} />
                </RefreshOverlay>

                {/* every-list-pages-with-the-growing-pager — the pages opened so far, one click back to any of them. */}
                <GrowingPager
                  page={seriesPage}
                  onPageChange={setSeriesPage}
                  hasNext={series.isPlaceholderData ? undefined : seriesPage * PAGE_SIZE < (series.data?.totalItems ?? 0)}
                  resetKey={[grain, from, to, restockTeamId].join("|")}
                  pageSize={PAGE_SIZE}
                  testId="statistics-series-pager"
                />
              </Stack>
            )}
          </Tabs.Content>

          <Tabs.Content value="product" p="0">
            {quiet ? (
              empty
            ) : (
              <Stack gap="field">
                <RefreshOverlay busy={products.isFetching && !products.isPending}>
                  {products.data && <ProductTable rows={products.data.rows} showTeam={restockTeamId === 0n} />}
                </RefreshOverlay>

                <GrowingPager
                  page={productPage}
                  onPageChange={setProductPage}
                  hasNext={products.isPlaceholderData ? undefined : productPage * PAGE_SIZE < (products.data?.totalItems ?? 0)}
                  resetKey={[from, to, restockTeamId].join("|")}
                  pageSize={PAGE_SIZE}
                  testId="statistics-products-pager"
                />
              </Stack>
            )}
          </Tabs.Content>
        </Stack>
      </Stack>
    </Tabs.Root>
  );
}

// One row per period, NEWEST first — every period in the window, the quiet ones included: a missing row reads as a
// period that did not load. The bucket is its own label: `2026-10-07`, `2026-10`, `2026`.
function SeriesTable({ points }: { points: SupplierFigurePoint[] }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Stack gap="2" data-testid="statistics-series">
        {points.map((point) =>
          // A QUIET PERIOD IS ONE THIN LINE, not a block of zeroes (owner, on the phone: *"oke"*,
          // `a-quiet-period-is-one-line-on-a-phone`) — still there, so a missing day never reads as one that did not
          // load; thirty days were thirty full blocks, most of them "Direstok 0 · Rp 0".
          unitsReceived(point.figures) === 0 ? (
            <Text
              key={point.at}
              fontSize="sm"
              color="fg.muted"
              px="3"
              py="1.5"
              borderWidth="1px"
              borderStyle="dashed"
              borderRadius="md"
              data-testid={`statistics-series-row-${point.at}`}
              data-quiet="true"
            >
              {point.at} · {t("supplierStats.quietPeriod")}
            </Text>
          ) : (
            <FigureBlock
              key={point.at}
              title={point.at}
              figures={point.figures}
              testId={`statistics-series-row-${point.at}`}
            />
          ),
        )}
      </Stack>
    );
  }

  return (
    <Box overflowX="auto">
      <Table.Root size="sm" data-testid="statistics-series">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("supplierFigures.col.period")}</Table.ColumnHeader>
            <FigureHeaders />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {points.map((point) => (
            <Table.Row key={point.at} data-testid={`statistics-series-row-${point.at}`} css={LIGHTS_UP}>
              <Table.Cell>
                <Text fontSize="sm">{point.at}</Text>
              </Table.Cell>
              <FigureCells figures={point.figures} />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

// Product Grouped — the restocking team's product, so two teams buying one item are two rows, each naming its team
// (every-accepted-line-links-its-own-product). The Team column goes when one team is picked: it would say the same
// name on every row.
function ProductTable({ rows, showTeam }: { rows: SupplierProductRow[]; showTeam: boolean }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  // An unresolved name reads as TeamItem reads it: "Team #<id>" — and a product as "Product #<id>".
  const teamLabel = (row: SupplierProductRow) =>
    row.team.name || t("supplierFigures.teamNumber", { id: row.team.teamId.toString() });
  const productLabel = (row: SupplierProductRow) =>
    row.name || t("supplierFigures.productNumber", { id: row.productId.toString() });
  // THE PRODUCT AS THE APP DRAWS A PRODUCT — its picture, its name, its SKU under it (owner: *"statistik per produk ada
  // gambar"*, `a-figures-product-shows-its-picture`), as the Produk tab draws it. No picture → the placeholder.
  const productOf = (row: SupplierProductRow) => ({
    id: row.productId,
    name: productLabel(row),
    sku: row.sku,
    defaultImageThumbnailUrl: row.thumbnailUrl,
  });

  if (rows.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="statistics-products-empty">
        {t("supplierStats.noProducts")}
      </Text>
    );
  }

  if (isMobile) {
    return (
      <Stack gap="2" data-testid="statistics-products">
        {rows.map((row) => (
          <FigureBlock
            key={row.key}
            title={productLabel(row)}
            // The team as a badge beside the SKU — the Produk tab's phone block.
            header={<ProductListItem product={productOf(row)} teamName={showTeam ? teamLabel(row) : undefined} />}
            figures={row.figures}
            testId={`statistics-product-row-${row.key}`}
          />
        ))}
      </Stack>
    );
  }

  return (
    <Box overflowX="auto">
      <Table.Root size="sm" data-testid="statistics-products">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("supplierFigures.col.product")}</Table.ColumnHeader>
            {showTeam && <Table.ColumnHeader>{t("supplierFigures.col.team")}</Table.ColumnHeader>}
            <FigureHeaders />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row.key} data-testid={`statistics-product-row-${row.key}`} css={LIGHTS_UP}>
              <Table.Cell>
                <Box minW="14rem">
                  <ProductListItem product={productOf(row)} />
                </Box>
              </Table.Cell>
              {showTeam && (
                <Table.Cell>
                  <Text fontSize="sm" data-testid="statistics-product-team">
                    {teamLabel(row)}
                  </Text>
                </Table.Cell>
              )}
              <FigureCells figures={row.figures} />
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
