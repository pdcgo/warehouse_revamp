import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Heading,
  Link,
  Select,
  Spacer,
  Stack,
  Text,
  createListCollection,
} from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { Pagination } from "../../components/chrome/Pagination";
import { DateRangePicker, type DateRange, resolveRange } from "../../components/datetime/DateRangePicker";
import { PeriodGrainPicker } from "../../components/datetime/PeriodGrainPicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import type { FinancialAccount } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import {
  type AccountGroupBy,
  useAccountReportGroups,
  useAccountReportSeries,
  useAccountReportSummary,
} from "../../features/financialAccount/analytics";
import { useFinancialAccounts } from "../../features/financialAccount/queries";
import { accountName } from "../../features/financialAccount/vocab";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { toDateInputValue } from "../../lib/datetime";
import type { PeriodGrain } from "../../lib/period";
import { GroupTable } from "./components/GroupTable";
import { ReportSummary } from "./components/ReportSummary";
import { SeriesTable } from "./components/SeriesTable";

const PAGE_SIZE = 20;
const GROUPINGS: AccountGroupBy[] = ["account", "provider", "changeType"];

function windowOf(range: DateRange): { from: string; to: string } {
  const { fromUnix, toUnix } = resolveRange(range);

  return {
    from: fromUnix > 0n ? toDateInputValue(new Date(Number(fromUnix) * 1000)) : "",
    to: toUnix > 0n ? toDateInputValue(new Date(Number(toUnix) * 1000)) : "",
  };
}

// FinancialAccountReportPage — the owner's six metrics (context.md lines 126–131): daily, monthly and
// yearly, grouped by provider, by change type and by account. Delivered the settlement way
// (analytics-are-delivered-the-settlement-way), read from one row per account per day
// (the-daily-row-is-one-account-one-day).
//
// Mounted at /financial-accounts/report, reached from the accounts page. Accepted at design_accept
// (the-prototype-and-its-contract-are-accepted).
//
// Unlike settlement's report, nothing here lags: the daily row is written in the log row's own transaction
// (the-daily-row-is-written-with-the-log-row), so this page and the accounts page always agree. A row
// counts on the day the money MOVED, in Jakarta time (a-row-counts-on-the-day-the-money-moved) — a transfer
// typed today for yesterday lands in yesterday's row.
export function FinancialAccountReportPage() {
  const { t } = useTranslation();
  const { current } = useTeam();

  const [grain, setGrain] = useState<PeriodGrain>("day");
  const [range, setRange] = useState<DateRange>({ kind: "relative", days: 30 });
  const [accountId, setAccountId] = useState(0n);
  const [groupBy, setGroupBy] = useState<AccountGroupBy>("account");
  const [seriesPage, setSeriesPage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);

  const teamId = current?.teamId;
  const { from, to } = windowOf(range);
  const valid = from !== "" && to !== "" && from <= to;

  // Every account the report can name — archived and unknown included, their past still happened.
  const accounts = useFinancialAccounts({ teamId, q: "", includeArchived: true, page: 1, pageSize: 200 });
  const shops = useShopOptions({ teamId: teamId ?? 0n });
  const nameOf = (shopId: bigint) => shops.data?.find((s) => s.id === shopId)?.name;
  // An unknown account is named after its shop by id — shown by the shop's name.
  const shownAccounts = (accounts.data?.accounts ?? []).map((a) => ({ ...a, name: accountName(a, nameOf) }));
  const accountOf = (id: bigint) => shownAccounts.find((a) => a.id === id);

  const summary = useAccountReportSummary({ teamId, from, to, valid, accountId });
  const series = useAccountReportSeries({ teamId, from, to, valid, grain, accountId, page: seriesPage, pageSize: PAGE_SIZE });
  const groups = useAccountReportGroups({ teamId, from, to, valid, groupBy, page: groupPage, pageSize: PAGE_SIZE });

  if (!current) {
    return <Text color="fg.muted">{t("financialAccounts.selectTeam")}</Text>;
  }

  const error = [summary, series, groups].find((query) => query.isError)?.error;

  return (
    <Stack gap="section" data-testid="account-report-page">
      <Link asChild fontSize="sm" color="fg.muted">
        <RouterLink to="/financial-accounts">← {t("financialAccounts.title")}</RouterLink>
      </Link>

      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("financialAccounts.report.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
        <AccountFilter
          accounts={shownAccounts}
          value={accountId}
          onChange={(next) => {
            setAccountId(next);
            setSeriesPage(1);
          }}
        />
        <PeriodGrainPicker
          value={grain}
          onChange={(next) => {
            setGrain(next);
            setSeriesPage(1);
          }}
          testId="account-report-grain"
        />
        <DateRangePicker
          value={range}
          onChange={(next) => {
            setRange(next);
            setSeriesPage(1);
            setGroupPage(1);
          }}
          testId="account-report-range"
        />
      </Flex>

      <Text fontSize="sm" color="fg.muted">
        {t("financialAccounts.report.subtitle")}
      </Text>

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
        <ReportSummary metric={summary.data} />
      </RefreshOverlay>

      <Stack gap="field">
        <Heading size="sm">{t("financialAccounts.report.overTime")}</Heading>
        <RefreshOverlay busy={series.isFetching && !series.isPending}>
          <SeriesTable grain={grain} points={series.data?.points ?? []} />
        </RefreshOverlay>
        <Box>
          <Pagination page={seriesPage} pageSize={PAGE_SIZE} count={series.data?.totalItems ?? 0} onPageChange={setSeriesPage} />
        </Box>
      </Stack>

      <Stack gap="field">
        <Flex align="center" gap="card" wrap="wrap">
          <Heading size="sm">{t("financialAccounts.report.ranking")}</Heading>
          <Spacer />
          <Group attached>
            {GROUPINGS.map((g) => (
              <Button
                key={g}
                variant={groupBy === g ? "solid" : "outline"}
                data-testid={`account-report-group-by-${g}`}
                onClick={() => {
                  setGroupBy(g);
                  setGroupPage(1);
                }}
              >
                {t(`financialAccounts.report.by.${g}`)}
              </Button>
            ))}
          </Group>
        </Flex>
        <RefreshOverlay busy={groups.isFetching && !groups.isPending}>
          <GroupTable groupBy={groupBy} rows={groups.data?.rows ?? []} accountOf={accountOf} />
        </RefreshOverlay>
        <Box>
          <Pagination page={groupPage} pageSize={PAGE_SIZE} count={groups.data?.totalItems ?? 0} onPageChange={setGroupPage} />
        </Box>
      </Stack>
    </Stack>
  );
}

const WHOLE_TEAM = "0";

// The whole team, or one account — every account, archived and unknown included, unlike a picker that
// records a fact: a report reads the past, and those accounts have one.
function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: FinancialAccount[];
  value: bigint;
  onChange: (accountId: bigint) => void;
}) {
  const { t } = useTranslation();

  const collection = useMemo(
    () =>
      createListCollection({
        items: [
          { label: t("financialAccounts.report.wholeTeam"), value: WHOLE_TEAM },
          ...accounts.map((a) => ({ label: a.name, value: a.id.toString() })),
        ],
      }),
    [accounts, t],
  );

  return (
    <Select.Root
      collection={collection}
      width="14rem"
      value={[value.toString()]}
      onValueChange={(e) => onChange(BigInt(e.value[0] ?? WHOLE_TEAM))}
    >
      <Select.HiddenSelect />
      <Select.Control>
        <Select.Trigger data-testid="account-report-account">
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content>
          {collection.items.map((item) => (
            <Select.Item item={item} key={item.value} data-testid={`account-report-account-option-${item.value}`}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  );
}
