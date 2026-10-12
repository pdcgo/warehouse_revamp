import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Heading, Stack, Table, Text } from "@chakra-ui/react";

import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
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
import { unitsReceived } from "./figures";

const PAGE_SIZE = 10;

export const description =
  "A supplier's Statistics tab — on the manage detail and the discover detail alike. A period and a grain, whose restocks (every team's, or one picked selling team's), the window's six figures as a headline, the same figures over time (newest first, quiet periods included), and by product. Folded from the restock's accept, so a figure can lag an accept by the broker's delivery.";

export interface SupplierStatisticsProps {
  /** Any team's supplier — its figures count every team's restocks from it. */
  supplierId: bigint;
}

// SupplierStatistics is a supplier's STATISTICS tab (the-figures-are-a-statistics-tab-and-a-supplier-report): what was
// restocked from it, and how much of that was lost or broken on the way, over a period.
//
// Three questions, top to bottom — the same order as the settlement report:
//
//   the headline   how much came from this supplier in the window, and how much of it arrived broken or short
//   over time      which day, month or year it happened in
//   by product     which item it happens to
//
// ⚠ EVERY TEAM'S RESTOCKS by default (every-selling-team-sees-every-teams-figures) — a broken rate is worth most to
// the team that has NOT bought there yet — narrowed to one selling team by a picker (the-team-filter-picks-any-selling-team).
//
// ⚠ FOLDED, NOT LIVE: the figures are supplier_service's fold of *Restock Accepted* (the-report-is-processed-like-settlement),
// so an accept a moment ago can take a moment to appear.
export function SupplierStatistics({ supplierId }: SupplierStatisticsProps) {
  const { current } = useTeam();
  const { t } = useTranslation();

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
  const products = useSupplierFiguresByProduct({
    teamId,
    supplierId,
    from,
    to,
    valid,
    restockTeamId,
    page: productPage,
    pageSize: PAGE_SIZE,
  });

  // Nothing at all in the window — said once, instead of a headline of zeroes over a table of zeroes.
  const quiet = series.data !== undefined && unitsReceived(series.data.total) === 0;

  return (
    <Stack gap="section" data-testid="supplier-statistics">
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
          <PeriodGrainPicker value={grain} onChange={pickGrain} testId="statistics-grain" />
        </FilterField>
        <FilterField w="auto">
          <DateRangePicker value={range} onChange={pickRange} testId="statistics-range" />
        </FilterField>
      </FilterBar>

      {!valid && (
        <Text fontSize="sm" color="error.fg" data-testid="statistics-range-invalid">
          {t("supplierFigures.rangeInvalid")}
        </Text>
      )}

      <RefreshOverlay busy={series.isFetching && !series.isPending}>
        <FiguresSummary figures={series.data?.total} testId="statistics-summary" />
      </RefreshOverlay>

      {quiet ? (
        <Text color="fg.muted" data-testid="statistics-empty">
          {restockTeamId !== 0n ? t("supplierStats.emptyTeam") : t("supplierStats.empty")}
        </Text>
      ) : (
        <>
          <Stack gap="field">
            <Heading size="sm">{t("supplierStats.overTime")}</Heading>

            <RefreshOverlay busy={series.isFetching && !series.isPending}>
              <SeriesTable points={series.data?.points ?? []} />
            </RefreshOverlay>

            <Box>
              <Pagination
                page={seriesPage}
                pageSize={PAGE_SIZE}
                count={series.data?.totalItems ?? 0}
                onPageChange={setSeriesPage}
              />
            </Box>
          </Stack>

          <Stack gap="field">
            <Heading size="sm">{t("supplierStats.byProduct")}</Heading>

            <RefreshOverlay busy={products.isFetching && !products.isPending}>
              {products.data && <ProductTable rows={products.data.rows} showTeam={restockTeamId === 0n} />}
            </RefreshOverlay>

            <Box>
              <Pagination
                page={productPage}
                pageSize={PAGE_SIZE}
                count={products.data?.totalItems ?? 0}
                onPageChange={setProductPage}
              />
            </Box>
          </Stack>
        </>
      )}
    </Stack>
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
        {points.map((point) => (
          <FigureBlock
            key={point.at}
            title={point.at}
            figures={point.figures}
            testId={`statistics-series-row-${point.at}`}
          />
        ))}
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
            <Table.Row key={point.at} data-testid={`statistics-series-row-${point.at}`}>
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
            sub={showTeam ? `${row.sku} · ${teamLabel(row)}` : row.sku}
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
            <Table.Row key={row.key} data-testid={`statistics-product-row-${row.key}`}>
              <Table.Cell>
                <Text fontSize="sm">{productLabel(row)}</Text>
                <Text fontSize="xs" color="fg.muted">
                  {row.sku}
                </Text>
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
