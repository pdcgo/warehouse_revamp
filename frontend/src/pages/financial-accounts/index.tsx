import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  HStack,
  Heading,
  Icon,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
  Wrap,
} from "@chakra-ui/react";
import { ChartColumn, Plus } from "lucide-react";

import { rpcError } from "../../api/clients";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { FinancialAccountStatus, FinancialAccountType } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { AccountActions } from "../../features/financialAccount/AccountActions";
import { AccountFormDialog } from "../../features/financialAccount/AccountFormDialog";
import { BalanceText, ProviderBadge } from "../../features/financialAccount/badges";
import { useAccountBalances, useFinancialAccounts, useTypeTotals } from "../../features/financialAccount/queries";
import { TYPE_KEY, isUnknown, withShopNames } from "../../features/financialAccount/vocab";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { formatUnixRelative } from "../../lib/datetime";
import { canMoveAccountMoney } from "../../lib/roles";
import { TypeTotals } from "./components/TypeTotals";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// FinancialAccountsPage — what the team holds, and where (docs/business/financial_account).
//
// Mounted at /financial-accounts, under **Accounts** for every member of a selling or warehouse team.
// Accepted at design_accept (the-prototype-and-its-contract-are-accepted).
//
// The rules this screen carries:
//  - every member SEES the accounts and their balances; only admin and up gets New Account and the row
//    menu (seeing-is-team-wide-moving-is-admin-and-up);
//  - a balance below zero is WARNED — on the row, in the totals, and in a banner — never refused
//    (below-zero-is-warned-never-refused);
//  - an `unknown` account is warned "bank not named", with Which account is this? one click away
//    (a-shop-with-no-account-gets-an-unknown-one, an-unknown-account-is-filled-in-or-moved-in);
//  - every account says when it was last checked against its bank — a balance nobody checks is a number
//    nobody should trust (Reconcile);
//  - archived accounts are hidden until asked for, because they are restored from here.
export function FinancialAccountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();

  const [q, setQ] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);

  const teamId = current?.teamId;
  const list = useFinancialAccounts({ teamId, q, includeArchived, page, pageSize });
  const accounts = list.data?.accounts ?? [];
  const balances = useAccountBalances(teamId, accounts.map((a) => a.id));
  const totals = useTypeTotals(teamId);
  const shops = useShopOptions({ teamId: teamId ?? 0n });

  if (!current || teamId === undefined) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("financialAccounts.title")}</Heading>
        <Text color="fg.muted">{t("financialAccounts.selectTeam")}</Text>
      </Stack>
    );
  }

  const canMove = canMoveAccountMoney(current.role);
  const nameOf = (id: bigint) => shops.data?.find((s) => s.id === id)?.name;
  const shopName = (id: bigint) => nameOf(id) ?? `#${id}`;

  // Counted by the server across EVERY account, not this page's — a warning that depended on which page
  // was open would disappear exactly when somebody paged past the problem.
  const belowZero = (totals.data ?? []).reduce((sum, x) => sum + x.belowZeroCount, 0);
  const unknownCount = (totals.data ?? []).find((x) => x.type === FinancialAccountType.UNKNOWN)?.accountCount ?? 0;

  const error = [list, balances, totals].find((query) => query.isError)?.error;

  return (
    <Stack gap="section" data-testid="financial-accounts-page">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("financialAccounts.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />
        <Button size="xs" variant="outline" data-testid="open-account-report" onClick={() => navigate("/financial-accounts/report")}>
          <Icon as={ChartColumn} boxSize="4" />
          {t("financialAccounts.report")}
        </Button>
        {canMove && (
          <Button size="xs" colorPalette="brand" data-testid="open-create-account" onClick={() => setCreating(true)}>
            <Icon as={Plus} boxSize="4" />
            {t("financialAccounts.newAccount")}
          </Button>
        )}
      </Flex>

      <Text fontSize="sm" color="fg.muted">
        {t("financialAccounts.subtitle")}
      </Text>

      <TypeTotals totals={totals.data} />

      {belowZero > 0 && (
        <Alert.Root status="warning" data-testid="below-zero-warning">
          <Alert.Indicator />
          <Alert.Title>{t("financialAccounts.belowZeroBanner", { count: belowZero })}</Alert.Title>
        </Alert.Root>
      )}

      {unknownCount > 0 && (
        <Alert.Root status="info" data-testid="unknown-warning">
          <Alert.Indicator />
          <Alert.Title>{t("financialAccounts.unknownBanner", { count: unknownCount })}</Alert.Title>
        </Alert.Root>
      )}

      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="sm"
          placeholder={t("financialAccounts.searchPlaceholder")}
          value={q}
          data-testid="account-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <Checkbox.Root
          checked={includeArchived}
          onCheckedChange={(e) => {
            setPage(1);
            setIncludeArchived(!!e.checked);
          }}
          data-testid="account-show-archived"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>{t("financialAccounts.showArchived")}</Checkbox.Label>
        </Checkbox.Root>
      </Flex>

      {error && (
        <Text color="fg.error" data-testid="financial-accounts-error">
          {rpcError(error)}
        </Text>
      )}

      {list.isPending ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={list.isFetching && !list.isPending}>
          <Table.ScrollArea>
            <Table.Root size="sm" interactive data-testid="financial-accounts-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("financialAccounts.col.account")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("financialAccounts.col.provider")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("financialAccounts.col.number")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("financialAccounts.col.balance")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("financialAccounts.col.lastChecked")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("financialAccounts.col.usedFor")}</Table.ColumnHeader>
                  {canMove && <Table.ColumnHeader textAlign="end">{t("financialAccounts.col.actions")}</Table.ColumnHeader>}
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {accounts.map((account) => {
                  const id = account.id.toString();
                  const b = balances.data?.get(id);
                  const archived = account.status === FinancialAccountStatus.ARCHIVED;
                  const unknown = isUnknown(account);
                  // An unknown account is named after its shop by id — shown by the shop's name.
                  const shown = { ...account, name: withShopNames(account.name, nameOf) };

                  return (
                    <Table.Row
                      key={id}
                      cursor="pointer"
                      data-testid={`account-row-${id}`}
                      onClick={() => navigate(`/financial-accounts/${id}`)}
                    >
                      <Table.Cell>
                        <Stack gap="0">
                          <HStack gap="2">
                            <Text fontWeight="medium" color={archived ? "fg.muted" : undefined}>
                              {shown.name}
                            </Text>
                            {archived && (
                              <Badge colorPalette="gray" data-testid={`account-archived-${id}`}>
                                {t("financialAccounts.archived")}
                              </Badge>
                            )}
                            {unknown && (
                              <Badge colorPalette="orange" data-testid={`account-unknown-${id}`}>
                                {t("financialAccounts.bankNotNamed")}
                              </Badge>
                            )}
                          </HStack>
                          <Text fontSize="xs" color="fg.muted">
                            {account.holderName || t(TYPE_KEY[account.type]!)}
                          </Text>
                        </Stack>
                      </Table.Cell>
                      <Table.Cell>
                        <ProviderBadge provider={account.provider} />
                      </Table.Cell>
                      <Table.Cell fontFamily="mono" fontSize="sm">
                        {account.accountNumber || "—"}
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        <BalanceText balance={b?.balance} testId={`account-balance-${id}`} />
                      </Table.Cell>
                      <Table.Cell>
                        <Text
                          fontSize="sm"
                          color={b?.reconciledAt ? undefined : "fg.muted"}
                          data-testid={`account-checked-${id}`}
                        >
                          {unknown
                            ? "—"
                            : b?.reconciledAt
                              ? formatUnixRelative(b.reconciledAt.seconds)
                              : t("financialAccounts.neverChecked")}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Wrap gap="1">
                          {account.operational && (
                            <Badge colorPalette="brand" variant="outline" data-testid={`account-operational-${id}`}>
                              {t("financialAccounts.operational")}
                            </Badge>
                          )}
                          {account.shopIds.map((shopId) => (
                            <Badge key={shopId.toString()} variant="surface" data-testid={`account-shop-${id}-${shopId}`}>
                              {shopName(shopId)}
                            </Badge>
                          ))}
                        </Wrap>
                      </Table.Cell>
                      {canMove && (
                        <Table.Cell textAlign="end">
                          <AccountActions
                            teamId={teamId}
                            account={shown}
                            balance={b?.balance}
                            shopNames={account.shopIds.map(shopName)}
                          />
                        </Table.Cell>
                      )}
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </RefreshOverlay>
      )}

      {!list.isPending && accounts.length === 0 && !error && (
        <Box data-testid="financial-accounts-empty">
          <Text color="fg.muted">{q ? t("financialAccounts.emptySearch") : t("financialAccounts.empty")}</Text>
        </Box>
      )}

      <Pagination
        count={list.data?.totalItems ?? 0}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

      {creating && <AccountFormDialog teamId={teamId} open onOpenChange={(o) => !o && setCreating(false)} />}
    </Stack>
  );
}
