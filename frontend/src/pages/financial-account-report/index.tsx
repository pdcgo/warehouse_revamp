import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Badge, Button, Flex, HStack, Heading, Icon, Link, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import type { SortState } from "../../components/chrome/SortableHeader";
import { DateRangePicker, type DateRange, resolveRange } from "../../components/datetime/DateRangePicker";
import { PeriodGrainPicker } from "../../components/datetime/PeriodGrainPicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import {
  type AccountReportGroupRow,
  useAccountReportGroups,
  useAccountReportSeries,
  useAccountReportSummary,
} from "../../features/financialAccount/analytics";
import { useFinancialAccounts } from "../../features/financialAccount/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { PROVIDER_KEY, accountName } from "../../features/financialAccount/vocab";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { FinancialAccountStatus } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { toDateInputValue } from "../../lib/datetime";
import type { PeriodGrain } from "../../lib/period";
import { AccountFilter } from "./components/AccountFilter";
import { SeriesTable } from "./components/SeriesTable";
import { ChangeDetailDialog } from "./components/ChangeDetailDialog";
import { type Mover, MoversDialog } from "./components/MoversDialog";
import { ReportSummary } from "./components/ReportSummary";
import { REPORT_PENDING } from "./pending";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_RANGE: DateRange = { kind: "relative", days: 30 };

function windowOf(range: DateRange): { from: string; to: string } {
  const { fromUnix, toUnix } = resolveRange(range);

  return {
    from: fromUnix > 0n ? toDateInputValue(new Date(Number(fromUnix) * 1000)) : "",
    to: toUnix > 0n ? toDateInputValue(new Date(Number(toUnix) * 1000)) : "",
  };
}

const isDefaultRange = (range: DateRange) => range.kind === "relative" && range.days === DEFAULT_RANGE.days;

// FinancialAccountReportPage — the team's money over a window, as five cards and one table of periods (owner,
// `the-report-is-five-cards-and-one-table`). The owner's six metrics (context.md lines 126–131) are all on it: daily,
// monthly and yearly as the table's grain; by change type behind the net change card, by account and by provider in
// their own cards. Delivered the settlement way (analytics-are-delivered-the-settlement-way), read from one row per
// account per day (the-daily-row-is-one-account-one-day).
//
// Mounted at /financial-accounts/report, reached from the accounts page.
//
// Unlike settlement's report, nothing here lags: the daily row is written in the log row's own transaction
// (the-daily-row-is-written-with-the-log-row), so this page and the accounts page always agree. A row counts on the
// day the money MOVED, in Jakarta time (a-row-counts-on-the-day-the-money-moved) — a transfer typed today for
// yesterday lands in yesterday's row.
export function FinancialAccountReportPage() {
  const { t } = useTranslation();
  const { current } = useTeam();

  const [grain, setGrain] = useState<PeriodGrain>("day");
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);
  const [accountId, setAccountId] = useState(0n);
  const [seriesSort, setSeriesSort] = useState<SortState<"period">>({ by: "period", dir: "desc" });
  const [seriesPage, setSeriesPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailOpen, setDetailOpen] = useState(false);
  const [moversOpen, setMoversOpen] = useState<"account" | "provider" | null>(null);

  const teamId = current?.teamId;
  const { from, to } = windowOf(range);
  const valid = from !== "" && to !== "" && from <= to;

  // Every account the report can name — archived and Lainnya included, their past still happened.
  const accounts = useFinancialAccounts({ teamId, q: "", includeArchived: true, page: 1, pageSize: 200 });
  const shops = useShopOptions({ teamId: teamId ?? 0n });
  const nameOf = (shopId: bigint) => shops.data?.find((s) => s.id === shopId)?.name;
  // An unknown account is shown by its shop's name (the-unknown-account-reads-lainnya).
  const shownAccounts = (accounts.data?.accounts ?? []).map((a) => ({ ...a, name: accountName(a, nameOf) }));

  const summary = useAccountReportSummary({ teamId, from, to, valid, accountId });
  const series = useAccountReportSeries({
    teamId,
    from,
    to,
    valid,
    grain,
    accountId,
    page: seriesPage,
    pageSize,
    dir: seriesSort.dir,
  });

  // WHAT MOVED IT — the whole ranking in one page (an account list is small; there are six providers), asked only while
  // no account is picked: the contract's ranking is always the team's, and one account has nothing to rank.
  const ranking = { teamId, from, to, valid: valid && accountId === 0n, page: 1, pageSize: 200, sort: { by: "change", dir: "desc" } } as const;
  const byAccount = useAccountReportGroups({ ...ranking, groupBy: "account" });
  const byProvider = useAccountReportGroups({ ...ranking, groupBy: "provider" });

  const accountOf = (id: bigint) => shownAccounts.find((a) => a.id === id);
  const toMover = (row: AccountReportGroupRow): Mover => {
    const base = { id: `${row.key.case}-${String(row.key.value)}`, change: row.metric.change, close: row.metric.closeBalance };
    if (row.key.case === "accountId") {
      const account = accountOf(row.key.value);

      return {
        ...base,
        name: account?.name ?? `#${row.key.value}`,
        provider: account?.provider,
        archived: account?.status === FinancialAccountStatus.ARCHIVED,
        to: `/financial-accounts/${row.key.value}`,
      };
    }
    if (row.key.case === "provider") return { ...base, name: t(PROVIDER_KEY[row.key.value] ?? ""), provider: row.key.value };

    return { ...base, name: "" };
  };
  const movers =
    accountId > 0n ? undefined : { account: byAccount.data?.rows.map(toMover), provider: byProvider.data?.rows.map(toMover) };

  if (!current) {
    return <Text color="fg.muted">{t("financialAccounts.selectTeam")}</Text>;
  }

  const error = [summary, series, byAccount, byProvider].find((query) => query.isError)?.error;

  // A narrowed account, a moved window, a coarser grain — each is a filter Clear puts back.
  const filtering = [accountId > 0n, !isDefaultRange(range), grain !== "day"].filter(Boolean).length;
  const restart = () => setSeriesPage(1);

  return (
    <Stack gap="section" data-testid="account-report-page">
      <Link asChild fontSize="sm" color="fg.muted">
        <RouterLink to="/financial-accounts">← {t("financialAccounts.title")}</RouterLink>
      </Link>

      {/* THE SUBTITLE SITS UNDER THE TITLE — one block (`the-accounts-subtitle-sits-under-the-title`); the page's action
          on the title's row, as on the orders list. */}
      <Flex gap="3" align="start" justify="space-between" wrap="wrap">
        <Stack gap="1">
          <HStack gap="2" wrap="wrap">
            <Heading size="md">{t("financialAccounts.report.title")}</Heading>
            <Badge colorPalette="brand">{current.teamName}</Badge>
          </HStack>
          <Text fontSize="sm" color="fg.muted" data-testid="account-report-subtitle">
            {t("financialAccounts.report.subtitle")}
          </Text>
        </Stack>
        {/* EXPORT, NOT BUILT (owner: *"sama action export, kasih warning unimplemented"*) — a grey outline, as the orders
            list's: it takes nothing out of the screen yet, and the ⚠ number points at why. */}
        <Button variant="outline" colorPalette="gray" data-testid="account-report-export">
          <Icon as={Download} boxSize="4" />
          {t("financialAccounts.report.export")}
          <NotImplemented list={REPORT_PENDING} id="export" />
        </Button>
      </Flex>

      <NotImplementedSummary list={REPORT_PENDING} />

      {/* THE SHARED FILTER STRIP — Clear while anything is narrowed, a bottom sheet on a phone (a-phone-filters-from-a-sheet). */}
      <FilterBar
        active={filtering > 0}
        count={filtering}
        testId="account-report-filters"
        onClear={() => {
          setAccountId(0n);
          setRange(DEFAULT_RANGE);
          setGrain("day");
          restart();
        }}
      >
        <FilterField w="16rem" testId="account-report-account-field">
          <AccountFilter
            accounts={shownAccounts}
            loaded={accounts.isSuccess}
            value={accountId}
            onChange={(next) => {
              setAccountId(next);
              restart();
            }}
          />
        </FilterField>
        <FilterField w="auto">
          <DateRangePicker
            value={range}
            onChange={(next) => {
              setRange(next);
              restart();
            }}
            testId="account-report-range"
          />
        </FilterField>
        <FilterField w="auto">
          <PeriodGrainPicker
            value={grain}
            onChange={(next) => {
              setGrain(next);
              restart();
            }}
            testId="account-report-grain"
          />
        </FilterField>
      </FilterBar>

      {!valid && (
        <Text fontSize="sm" color="fg.error" data-testid="account-report-range-invalid">
          {t("financialAccounts.report.rangeInvalid")}
        </Text>
      )}

      {error && (
        <Text fontSize="sm" color="fg.error" data-testid="account-report-error">
          {rpcError(error)}
        </Text>
      )}

      <RefreshOverlay busy={summary.isFetching && !summary.isPending}>
        <ReportSummary
          metric={summary.data}
          from={from}
          to={to}
          onDetail={() => setDetailOpen(true)}
          movers={movers}
          onMovers={setMoversOpen}
        />
      </RefreshOverlay>

      {movers && (
        <MoversDialog
          open={moversOpen !== null}
          onOpenChange={(open) => {
            if (!open) setMoversOpen(null);
          }}
          kind={moversOpen ?? "account"}
          rows={(moversOpen === "provider" ? movers.provider : movers.account) ?? []}
          from={from}
          to={to}
        />
      )}

      <ChangeDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        metric={summary.data}
        from={from}
        to={to}
        scope={accountId > 0n ? (shownAccounts.find((a) => a.id === accountId)?.name ?? "") : t("financialAccounts.report.wholeTeam")}
      />

      {/* ONE TABLE OF PERIODS — the quiet ones included, newest first, every type a column, Saldo akhir held on the right. */}
      <Stack gap="field">
        <RefreshOverlay busy={series.isFetching && !series.isPending}>
          <SeriesTable
            grain={grain}
            points={series.data?.points ?? []}
            sort={seriesSort}
            onSortChange={(next) => {
              setSeriesSort(next);
              restart();
            }}
            stickyEdges
          />
        </RefreshOverlay>
        {/* THE PAGES GROW AS THEY ARE OPENED, as on the accounts list (`the-accounts-pager-grows-with-the-pages-opened`).
            The contract has a total, so "is there a next" is exact; while the next page loads it is not known yet. */}
        <GrowingPager
          page={seriesPage}
          onPageChange={setSeriesPage}
          hasNext={series.isPlaceholderData ? undefined : seriesPage * pageSize < (series.data?.totalItems ?? 0)}
          resetKey={[from, to, grain, accountId, seriesSort.dir, pageSize].join("|")}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            restart();
          }}
          testId="account-report-pager"
        />
      </Stack>
    </Stack>
  );
}
