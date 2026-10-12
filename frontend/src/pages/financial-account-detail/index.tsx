import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Alert, Badge, Flex, HStack, Heading, Link, Spinner, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { DateRangePicker, type DateRange, ALL_DATES, isAllDates, resolveRange } from "../../components/datetime/DateRangePicker";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import {
  type FinancialAccountChangeType,
  FinancialAccountStatus,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { AccountActions } from "../../features/financialAccount/AccountActions";
import { ProviderBadge } from "../../features/financialAccount/badges";
import { useAccountBalances, useAccountLogs, useFinancialAccount } from "../../features/financialAccount/queries";
import { TYPE_KEY, accountName, isUnknown, withShopNames } from "../../features/financialAccount/vocab";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useActors } from "../../features/users/queries";
import { useIsMobile } from "../../layouts/shell";
import { toDateInputValue } from "../../lib/datetime";
import { canMoveAccountMoney, canTransferMoney } from "../../lib/roles";
import { AccountLogTable } from "./components/AccountLogTable";
import { AccountSummary } from "./components/AccountSummary";
import { ChangeTypeFilter } from "./components/ChangeTypeFilter";
import { ShopLinks } from "./components/ShopLinks";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

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
// Mounted at /financial-accounts/:accountId. Accepted at design_accept (the-prototype-and-its-contract-are-accepted).
//
// The balance is warned while below zero (below-zero-is-warned-never-refused), and says when it was last
// checked against the bank. The statement is every row, newest first, each saying why it moved — the
// balance moves only with a row (the-accounts-are-one-ledger), so this page is the whole explanation of
// the number at its top.
//
// FOLLOWS THE SCREEN RULES (owner, `the-account-page-follows-the-screen-rules`): the figures are the order list's cards,
// the statement's filters the shared FilterBar (a sheet on a phone), its pages grow as they are opened; on a phone the
// header is the name and its menu with every action inside it, and each statement row is a block.
export function FinancialAccountDetailPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const params = useParams();
  const isMobile = useIsMobile();
  const accountId = /^\d+$/.test(params.accountId ?? "") ? BigInt(params.accountId!) : 0n;

  // Several at once — the contract's `change_types` is a list (`the-statement-filters-several-types`).
  const [changeTypes, setChangeTypes] = useState<FinancialAccountChangeType[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_DATES);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const teamId = current?.teamId;
  const accountQuery = useFinancialAccount(teamId, accountId);
  const balances = useAccountBalances(teamId, accountId > 0n ? [accountId] : []);
  const { from, to } = windowOf(range);
  const logs = useAccountLogs({
    teamId,
    accountId,
    changeTypes,
    from,
    to,
    page,
    pageSize,
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
  const nameOf = (shopId: bigint) => shops.data?.find((s) => s.id === shopId)?.name;
  const shopName = (shopId: bigint) => nameOf(shopId) ?? `#${shopId}`;
  const shopOf = (shopId: bigint) => shops.data?.find((s) => s.id === shopId);
  // An unknown account is named after its shop by id — shown by the shop's name.
  const shown = { ...account, name: accountName(account, nameOf) };
  const actorName = (actorId: bigint) => actors.data?.get(actorId.toString())?.name ?? `#${actorId}`;
  // A picked type and a bounded window — each is a filter Clear puts back.
  const filtering = [changeTypes.length > 0, !isAllDates(range)].filter(Boolean).length;

  return (
    <Stack gap="section" data-testid="financial-account-page">
      <BackLink />

      {/* ON A PHONE THE HEADER IS THE NAME AND ITS MENU (`the-phone-header-is-one-row`) — every action folds into it, so
          the buttons no longer wrap onto a row of their own. A basis on the title block, so on a desktop the buttons
          wrap under it instead of squeezing it, as the accounts list's header learned. */}
      <Flex align="flex-start" gap="card" wrap={isMobile ? "nowrap" : "wrap"}>
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="2" wrap="wrap">
            <Heading size="md" data-testid="account-name-heading">
              {shown.name}
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
        {canMove && (
          <AccountActions
            teamId={teamId}
            account={shown}
            balance={b?.balance}
            shopNames={account.shopIds.map(shopName)}
            buttons={!isMobile}
            canTransfer={canTransferMoney(current.role)}
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

      {/* TOKO TERHUBUNG BESIDE THE CARDS (owner, `linked-shops-sit-beside-the-cards`) — two of the strip's columns, the
          row's free space put to use. Only where there are shops: a warehouse has none, so its accounts take no
          withdrawals. Decided by the team's SHOPS rather than its type, so a root team that runs shops keeps it. */}
      <AccountSummary
        balance={b?.balance}
        reconciledAt={b?.reconciledAt}
        unknown={unknown}
        beside={
          (shops.data?.length ?? 0) > 0 || account.shopIds.length > 0 ? (
            <ShopLinks
              teamId={teamId}
              account={shown}
              shopName={shopName}
              nameOf={nameOf}
              shopOf={shopOf}
              canSet={canMove && !archived && !unknown}
            />
          ) : undefined
        }
      />


      <Stack gap="field">
        <Heading size="sm">{t("financialAccounts.log.title")}</Heading>
        {/* THE SHARED FILTER STRIP (`a-phone-filters-from-a-sheet`, `clear-filters-is-red-and-bold`) — the type and the
            window, Clear while either is set, a bottom sheet on a phone. */}
        <FilterBar
          active={filtering > 0}
          count={filtering}
          testId="account-log-filters"
          onClear={() => {
            setChangeTypes([]);
            setRange(ALL_DATES);
            setPage(1);
          }}
        >
          {/* The date's height to start; four picks and "+N", wrapping rather than cut (`the-statement-filters-several-types`). */}
          <FilterField w="16rem">
            <ChangeTypeFilter
              value={changeTypes}
              onChange={(next) => {
                setChangeTypes(next);
                setPage(1);
              }}
            />
          </FilterField>
          <FilterField w="auto">
            <DateRangePicker
              value={range}
              onChange={(next) => {
                setRange(next);
                setPage(1);
              }}
              testId="account-log-range"
            />
          </FilterField>
        </FilterBar>

        {logs.isError && (
          <Text fontSize="sm" color="fg.error">
            {rpcError(logs.error)}
          </Text>
        )}

        {logs.isPending ? (
          <Spinner colorPalette="brand" />
        ) : (
          <RefreshOverlay busy={logs.isFetching && !logs.isPending}>
            <AccountLogTable logs={logs.data?.logs ?? []} actorName={actorName} describe={(text) => withShopNames(text, nameOf)} />
          </RefreshOverlay>
        )}

        {/* THE PAGES GROW AS THEY ARE OPENED, as on the accounts list (`the-accounts-pager-grows-with-the-pages-opened`). */}
        <GrowingPager
          page={page}
          onPageChange={setPage}
          hasNext={logs.isPlaceholderData ? undefined : page * pageSize < (logs.data?.totalItems ?? 0)}
          resetKey={[changeTypes.join(","), from, to, pageSize].join("|")}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          testId="account-log-pager"
        />
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
