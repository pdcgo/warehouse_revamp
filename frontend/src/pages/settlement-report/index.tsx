import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Flex, Group, Heading, Spacer, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { Pagination } from "../../components/chrome/Pagination";
import { DateRangePicker, LAST_MONTH } from "../../components/datetime/DateRangePicker";
import type { DateRange } from "../../components/datetime/DateRangePicker";
import { PeriodGrainPicker } from "../../components/datetime/PeriodGrainPicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import {
  useSettlementGroups,
  useSettlementSeries,
  useSettlementSummary,
  type SettlementGroupBy,
} from "../../features/settlement/analytics";
import { windowOf } from "../../features/settlement/window";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import type { PeriodGrain } from "../../lib/period";
import { dateRangeCodec, oneOfCodec, useUrlState } from "../../lib/urlState";
import { GroupTable } from "./components/GroupTable";
import { ReportSummary } from "./components/ReportSummary";
import { SeriesTable } from "./components/SeriesTable";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";

const PAGE_SIZE = 20;

const GRAIN_CODEC = oneOfCodec<PeriodGrain>(["day", "month", "year"]);
const GROUP_CODEC = oneOfCodec<SettlementGroupBy>(["shop", "user"]);

// SettlementReportPage — what the marketplace actually paid, against what buyers paid, over time
// (docs/business/settlement/analytic_context.md).
//
// THREE QUESTIONS, top to bottom:
//
//   the summary   how much of this window's sales never reached us, and what is the shortfall now
//   over time     which period moved it
//   the ranking   which shop or which person carries it
//
// ⚠ THE WORD "BALANCE" IS NOT ON THIS SCREEN, and neither is "outstanding". The position is Σ change,
// withdrawals included (#withdrawal-counts-in-the-position) — the shortfall PLUS what went to the bank —
// so it is labelled "position to date", and Withdrawn stands beside Received
// (#the-report-headline-is-position-to-date).
//
// ⚠ EVERY FIGURE IS FOLDED, not live. The reports are built from the ledger through the broker, so a
// post made a moment ago can take a moment to appear here — the order page's ledger tab is the live view.
export function SettlementReportPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  // THE WINDOW, THE GRAIN AND THE RANKING LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh opens the same
  // report. The pages do not.
  const [grain, setGrain] = useUrlState<PeriodGrain>("grain", "day", GRAIN_CODEC);
  const [range, setRange] = useUrlState<DateRange>("range", LAST_MONTH, dateRangeCodec);
  const [groupBy, setGroupBy] = useUrlState<SettlementGroupBy>("group", "shop", GROUP_CODEC);
  const [shownGroupBy, setShownGroupBy] = useState<SettlementGroupBy>(groupBy);
  const [seriesPage, setSeriesPage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);

  // A new window or grain is a new question — back to its first page.
  const pickGrain = (next: PeriodGrain) => {
    setGrain(next);
    setSeriesPage(1);
  };

  const pickRange = (next: DateRange) => {
    setRange(next);
    setSeriesPage(1);
    setGroupPage(1);
  };

  const pickGroupBy = (next: SettlementGroupBy) => {
    setGroupBy(next);
    setGroupPage(1);
  };

  const teamId = current?.teamId;
  const { from, to } = windowOf(range);
  const valid = from !== "" && to !== "" && from <= to;

  const summary = useSettlementSummary({ teamId, from, to, valid });
  const series = useSettlementSeries({
    teamId,
    from,
    to,
    valid,
    grain,
    page: seriesPage,
    pageSize: PAGE_SIZE,
  });
  const groups = useSettlementGroups({
    teamId,
    from,
    to,
    valid,
    groupBy,
    page: groupPage,
    pageSize: PAGE_SIZE,
  });

  // The NAMES behind the ranking. Settlement holds ids only — shops live in selling_service and people
  // in user_service — so the screen resolves them where it already can.
  const shops = useShopOptions({ teamId: teamId ?? 0n });
  const rankedUsers = groupBy === "user" ? (groups.data?.rows ?? []).map((row) => row.id) : [];
  const actors = useActors(rankedUsers);

  const nameOf = (id: bigint): string => {
    if (groupBy === "shop") {
      return shops.data?.find((shop) => shop.id === id)?.name ?? `#${id}`;
    }

    // 0 is "not recorded" — an order opened with no creator — and it is a row of its own, so user
    // totals still add up to the team's.
    if (id === 0n) return t("settlementReport.unattributed");

    return actors.data?.get(id.toString())?.name ?? `#${id}`;
  };

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("settlementReport.title")}</Heading>
        <Text color="fg.muted">{t("settlementReport.selectTeam")}</Text>
      </Stack>
    );
  }

  const error = [summary, series, groups].find((query) => query.isError)?.error;

  // The grouping the rows ON SCREEN are in — what the table's fade is keyed on.
  if (!groups.isPending && !groups.isPlaceholderData && shownGroupBy !== groupBy) {
    setShownGroupBy(groupBy);
  }

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="settlement-report-page">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("settlementReport.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
        <PeriodGrainPicker value={grain} onChange={pickGrain} testId="report-grain" />
        <DateRangePicker value={range} onChange={pickRange} testId="report-range" />
      </Flex>

      <Text fontSize="sm" color="fg.muted">
        {t("settlementReport.subtitle")}
      </Text>

      {!valid && (
        <Text fontSize="sm" color="fg.error" data-testid="report-range-invalid">
          {t("settlementReport.rangeInvalid")}
        </Text>
      )}

      {error && (
        <Text fontSize="sm" color="fg.error" data-testid="report-error">
          {rpcError(error)}
        </Text>
      )}

      <RefreshOverlay busy={summary.isFetching && !summary.isPending}>
        <ReportSummary measure={summary.data} />
      </RefreshOverlay>

      <Stack gap="field">
        <Heading size="sm">{t("settlementReport.overTime")}</Heading>

        {/* The table's shape on the first load, never the empty hint before anything was asked (motion-is-small-quick-and-shared). */}
        {series.isPending && valid ? (
          <ListSkeleton testId="report-series-loading" />
        ) : (
          <RefreshOverlay busy={series.isFetching && !series.isPending}>
            <SeriesTable grain={grain} points={series.data?.points ?? []} />
          </RefreshOverlay>
        )}

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
        <Flex align="center" gap="card" wrap="wrap">
          <Heading size="sm">{t("settlementReport.ranking")}</Heading>
          <Spacer />
          <Group attached>
            <Button
              variant={groupBy === "shop" ? "solid" : "outline"}
              onClick={() => pickGroupBy("shop")}
              data-testid="report-group-shop"
            >
              {t("settlementReport.byShop")}
            </Button>
            <Button
              variant={groupBy === "user" ? "solid" : "outline"}
              onClick={() => pickGroupBy("user")}
              data-testid="report-group-user"
            >
              {t("settlementReport.byUser")}
            </Button>
          </Group>
        </Flex>

        {/* Per Toko ⇄ Per Pengguna swaps the table in place: it fades in when the regrouped rows LAND — keyed on the
            grouping on screen, not the click, since the old rows stay up while the new ones load (HARD RULE 10). */}
        {groups.isPending && valid ? (
          <ListSkeleton testId="report-groups-loading" />
        ) : (
          <RefreshOverlay busy={groups.isFetching && !groups.isPending}>
            <Box key={shownGroupBy} animationStyle="swap">
              <GroupTable groupBy={groupBy} rows={groups.data?.rows ?? []} nameOf={nameOf} />
            </Box>
          </RefreshOverlay>
        )}

        <Box>
          <Pagination
            page={groupPage}
            pageSize={PAGE_SIZE}
            count={groups.data?.totalItems ?? 0}
            onPageChange={setGroupPage}
          />
        </Box>
      </Stack>
    </Stack>
  );
}
