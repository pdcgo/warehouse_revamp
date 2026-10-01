import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Alert, Badge, Box, Flex, HStack, Heading, Link, Spacer, Spinner, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { Pagination } from "../../components/chrome/Pagination";
import { DateRangePicker, type DateRange, ALL_DATES, resolveRange } from "../../components/datetime/DateRangePicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import {
  type FinancialAccountChangeType,
  FinancialAccountStatus,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { AccountActions } from "../../features/financialAccount/AccountActions";
import { BalanceText, ProviderBadge } from "../../features/financialAccount/badges";
import { useAccountBalances, useAccountLogs, useFinancialAccount } from "../../features/financialAccount/queries";
import { TYPE_KEY, isUnknown } from "../../features/financialAccount/vocab";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { formatUnixRelative, toDateInputValue } from "../../lib/datetime";
import { canMoveAccountMoney } from "../../lib/roles";
import { AccountLogTable } from "./components/AccountLogTable";
import { ChangeTypeFilter } from "./components/ChangeTypeFilter";
import { ShopLinks } from "./components/ShopLinks";

const PAGE_SIZE = 20;

// A DateRange → the inclusive `yyyy-mm-dd` pair the log filters on; "" is an open end. Formatted back
// in LOCAL time, as the settlement report does — `toISOString` would shift the boundary a day.
function windowOf(range: DateRange): { from: string; to: string } {
  const { fromUnix, toUnix } = resolveRange(range);

  return {
    from: fromUnix > 0n ? toDateInputValue(new Date(Number(fromUnix) * 1000)) : "",
    to: toUnix > 0n ? toDateInputValue(new Date(Number(toUnix) * 1000)) : "",
  };
}

// FinancialAccountDetailPage — one account: its balance, where its money comes from, and its statement
// (docs/business/financial_account).
//
// ⚠ PROTOTYPE for design_accept — not routed until accepted.
//
// The balance is warned while below zero (below-zero-is-warned-never-refused), and says when it was last
// checked against the bank. The statement is every row, newest first, each saying why it moved — the
// balance moves only with a row (the-accounts-are-one-ledger), so this page is the whole explanation of
// the number at its top.
export function FinancialAccountDetailPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const params = useParams();
  const accountId = /^\d+$/.test(params.accountId ?? "") ? BigInt(params.accountId!) : 0n;

  const [changeType, setChangeType] = useState<FinancialAccountChangeType | undefined>(undefined);
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  const [page, setPage] = useState(1);

  const teamId = current?.teamId;
  const accountQuery = useFinancialAccount(teamId, accountId);
  const balances = useAccountBalances(teamId, accountId > 0n ? [accountId] : []);
  const { from, to } = windowOf(range);
  const logs = useAccountLogs({
    teamId,
    accountId,
    changeTypes: changeType === undefined ? [] : [changeType],
    from,
    to,
    page,
    pageSize: PAGE_SIZE,
  });
  const shops = useShopOptions({ teamId: teamId ?? 0n });
  const actors = useActors([...new Set((logs.data?.logs ?? []).map((l) => l.actorId).filter((id) => id > 0n))]);

  if (!current || teamId === undefined) {
    return <Text color="fg.muted">{t("financialAccounts.selectTeam")}</Text>;
  }

  if (accountQuery.isPending) return <Spinner colorPalette="brand" />;

  const account = accountQuery.data;
  if (!account) {
    return (
      <Stack gap="section">
        <BackLink />
        <Text color="fg.muted" data-testid="account-not-found">
          {accountQuery.isError ? rpcError(accountQuery.error) : t("financialAccounts.notFound")}
        </Text>
      </Stack>
    );
  }

  const id = account.id.toString();
  const b = balances.data?.get(id);
  const archived = account.status === FinancialAccountStatus.ARCHIVED;
  const unknown = isUnknown(account);
  const canMove = canMoveAccountMoney(current.role);
  const shopName = (shopId: bigint) => shops.data?.find((s) => s.id === shopId)?.name ?? `#${shopId}`;
  const actorName = (actorId: bigint) => actors.data?.get(actorId.toString())?.name ?? `#${actorId}`;

  return (
    <Stack gap="section" data-testid="financial-account-page">
      <BackLink />

      <Flex align="flex-start" gap="card" wrap="wrap">
        <Stack gap="1">
          <HStack gap="2" wrap="wrap">
            <Heading size="md" data-testid="account-name-heading">
              {account.name}
            </Heading>
            <ProviderBadge provider={account.provider} />
            {archived && <Badge colorPalette="gray">{t("financialAccounts.archived")}</Badge>}
            {account.operational && (
              <Badge colorPalette="brand" variant="outline">
                {t("financialAccounts.operational")}
              </Badge>
            )}
          </HStack>
          <Text fontSize="sm" color="fg.muted" data-testid="account-identity">
            {[t(TYPE_KEY[account.type]!), account.accountNumber, account.holderName].filter(Boolean).join(" · ")}
          </Text>
          {account.description && (
            <Text fontSize="sm" data-testid="account-description-text">
              {account.description}
            </Text>
          )}
        </Stack>
        <Spacer />
        {canMove && (
          <AccountActions
            teamId={teamId}
            account={account}
            balance={b?.balance}
            shopNames={account.shopIds.map(shopName)}
            buttons
          />
        )}
      </Flex>

      {unknown && (
        <Alert.Root status="info" data-testid="account-unknown-explained">
          <Alert.Indicator />
          <Alert.Title>
            {t("financialAccounts.unknownExplained", { shops: account.shopIds.map(shopName).join(", ") || "—" })}
          </Alert.Title>
        </Alert.Root>
      )}

      <Flex gap="card" wrap="wrap" borderWidth="1px" borderRadius="md" p="card">
        <Box minW="12rem" flex="1">
          <Text fontSize="xs" color="fg.muted">
            {t("financialAccounts.col.balance")}
          </Text>
          <BalanceText balance={b?.balance} size="2xl" testId="account-detail-balance" />
          {b !== undefined && b.balance < 0 && (
            <Text fontSize="xs" color="fg.error" data-testid="account-detail-below-zero">
              {t("financialAccounts.belowZeroExplained")}
            </Text>
          )}
        </Box>
        <Box minW="12rem" flex="1">
          <Text fontSize="xs" color="fg.muted">
            {t("financialAccounts.col.lastChecked")}
          </Text>
          <Text fontSize="lg" fontWeight="semibold" data-testid="account-detail-checked">
            {unknown
              ? t("financialAccounts.noStatement")
              : b?.reconciledAt
                ? formatUnixRelative(b.reconciledAt.seconds)
                : t("financialAccounts.neverChecked")}
          </Text>
        </Box>
      </Flex>

      {/* Only a selling team has shops — a warehouse's accounts take no withdrawals. */}
      {current.teamType === TeamType.SELLING && (
        <ShopLinks teamId={teamId} account={account} shopName={shopName} canSet={canMove && !archived && !unknown} />
      )}

      <Stack gap="field">
        <Flex align="center" gap="card" wrap="wrap">
          <Heading size="sm">{t("financialAccounts.log.title")}</Heading>
          <Spacer />
          <ChangeTypeFilter
            value={changeType}
            onChange={(next) => {
              setChangeType(next);
              setPage(1);
            }}
          />
          <DateRangePicker
            value={range}
            onChange={(next) => {
              setRange(next);
              setPage(1);
            }}
            testId="account-log-range"
          />
        </Flex>

        {logs.isError && (
          <Text fontSize="sm" color="fg.error">
            {rpcError(logs.error)}
          </Text>
        )}

        {logs.isPending ? (
          <Spinner colorPalette="brand" />
        ) : (
          <RefreshOverlay busy={logs.isFetching && !logs.isPending}>
            <AccountLogTable logs={logs.data?.logs ?? []} actorName={actorName} />
          </RefreshOverlay>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} count={logs.data?.totalItems ?? 0} onPageChange={setPage} />
      </Stack>
    </Stack>
  );
}

function BackLink() {
  const { t } = useTranslation();

  return (
    <Link asChild fontSize="sm" color="fg.muted" data-testid="back-to-accounts">
      <RouterLink to="/financial-accounts">← {t("financialAccounts.title")}</RouterLink>
    </Link>
  );
}
