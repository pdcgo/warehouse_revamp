import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  HStack,
  Heading,
  Icon,
  Spinner,
  Stack,
  Table,
  Text,
  Wrap,
} from "@chakra-ui/react";
import { ChartColumn, Plus } from "lucide-react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { SortableHeader, type SortState } from "../../components/chrome/SortableHeader";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { FinancialAccountStatus, type FinancialAccountType } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { AccountActions } from "../../features/financialAccount/AccountActions";
import { AccountFormDialog } from "../../features/financialAccount/AccountFormDialog";
import { BalanceText, ProviderBadge } from "../../features/financialAccount/badges";
import { useAccountBalances, useFinancialAccounts, useTypeTotals } from "../../features/financialAccount/queries";
import { TYPE_KEY, isUnknown, withShopNames } from "../../features/financialAccount/vocab";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixRelative } from "../../lib/datetime";
import { canMoveAccountMoney } from "../../lib/roles";
import { type AccountSortKey, AccountSortSelect } from "./components/AccountSortSelect";
import { AccountTypeTabs } from "./components/AccountTypeTabs";
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
//  - a balance below zero is WARNED — on the row and in the totals — never refused
//    (below-zero-is-warned-never-refused);
//  - an `unknown` account is warned "bank not named" — its own card, a badge on its row, and its type
//    tab finds them (a-shop-with-no-account-gets-an-unknown-one, an-unknown-account-is-filled-in-or-moved-in);
//  - NO BANNERS (owner, `the-accounts-page-has-no-banners`): each said again what a card and a row
//    already say, and took a row of the screen each to do it;
//  - every account says when it was last checked against its bank — a balance nobody checks is a number
//    nobody should trust (Reconcile);
//  - archived accounts are hidden until asked for, because they are restored from here;
//  - EVERY FILTER THE CONTRACT HAS, in the shared FilterBar (owner, `the-accounts-list-has-every-filter-the-contract-has`),
//    and the sort from the NAME and PROVIDER headings, A to Z first (`the-accounts-table-sorts-from-its-headings`).
export function FinancialAccountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();

  const [q, setQ] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [type, setType] = useState<FinancialAccountType | undefined>(undefined);
  const [shopId, setShopId] = useState(0n);
  const [operationalOnly, setOperationalOnly] = useState(false);
  const [sort, setSort] = useState<SortState<AccountSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);

  const teamId = current?.teamId;
  const list = useFinancialAccounts({
    teamId,
    q,
    includeArchived,
    types: type === undefined ? [] : [type],
    shopId,
    operationalOnly,
    sort,
    page,
    pageSize,
  });
  const accounts = list.data?.accounts ?? [];
  const balances = useAccountBalances(teamId, accounts.map((a) => a.id));
  const totals = useTypeTotals(teamId);
  const shops = useShopOptions({ teamId: teamId ?? 0n });
  // A phone has no headings to tap — the sort moves into the filter sheet. A JS breakpoint, never CSS.
  const isMobile = useIsMobile();

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

  const error = [list, balances, totals].find((query) => query.isError)?.error;

  // Every filter changes the question, so each goes back to page 1.
  const refilter = (apply: () => void) => {
    setPage(1);
    apply();
  };
  // The type is a TAB, not a filter (`the-accounts-type-is-a-tab-row`) — Clear leaves it where it is.
  const filtering = [q.trim() !== "", shopId > 0n, operationalOnly, includeArchived].filter(Boolean).length;
  const sortBy = (next: SortState<AccountSortKey> | null) => refilter(() => setSort(next));

  return (
    <Stack gap="section" data-testid="financial-accounts-page">
      {/* THE SUBTITLE SITS UNDER THE TITLE (owner, `the-accounts-subtitle-sits-under-the-title`) — one block,
          the actions beside it, instead of a section's gap between a title and the line that explains it. */}
      <Flex align="flex-start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1" minW="0">
          <HStack gap="2" wrap="wrap">
            <Heading size="md">{t("financialAccounts.title")}</Heading>
            <Badge colorPalette="brand">{current.teamName}</Badge>
          </HStack>
          <Text fontSize="sm" color="fg.muted" data-testid="financial-accounts-subtitle">
            {t("financialAccounts.subtitle")}
          </Text>
        </Stack>
        <HStack gap="2">
          {/* ⚠ `openReport`, NOT `report`: `financialAccounts.report` is the report page's whole namespace, an
              object — i18next renders "returned an object instead of string" where the word should be. */}
          <Button size="xs" variant="outline" data-testid="open-account-report" onClick={() => navigate("/financial-accounts/report")}>
            <Icon as={ChartColumn} boxSize="4" />
            {t("financialAccounts.openReport")}
          </Button>
          {canMove && (
            <Button size="xs" colorPalette="brand" data-testid="open-create-account" onClick={() => setCreating(true)}>
              <Icon as={Plus} boxSize="4" />
              {t("financialAccounts.newAccount")}
            </Button>
          )}
        </HStack>
      </Flex>

      <TypeTotals totals={totals.data} highlight={type} />

      {/* EVERY FILTER THE CONTRACT HAS (owner, `the-accounts-list-has-every-filter-the-contract-has`), in the
          shared FilterBar — the search in the row, the rest in a sheet on a phone. */}
      <FilterBar
        active={filtering > 0}
        count={filtering}
        testId="account-filters"
        onClear={() =>
          refilter(() => {
            setQ("");
            setShopId(0n);
            setOperationalOnly(false);
            setIncludeArchived(false);
          })
        }
      >
        <FilterSearch
          value={q}
          onChange={(next) => refilter(() => setQ(next))}
          placeholder={t("financialAccounts.searchPlaceholder")}
          testId="account-search"
        />

        {/* The account THIS SHOP withdraws into — a shop names one (a-shop-has-one-account), so it answers
            with at most one row. Only where the team runs shops: a warehouse has none. */}
        {(shops.data?.length ?? 0) > 0 && (
          <FilterField testId="account-shop-filter">
            <ShopSelect
              teamId={teamId}
              value={shopId > 0n ? shopId : undefined}
              placeholder={t("financialAccounts.allShops")}
              onChange={(next) => refilter(() => setShopId(next))}
            />
          </FilterField>
        )}

        <FilterField w="auto">
          <Checkbox.Root
            checked={operationalOnly}
            onCheckedChange={(e) => refilter(() => setOperationalOnly(!!e.checked))}
            data-testid="account-operational-only"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>{t("financialAccounts.operationalOnly")}</Checkbox.Label>
          </Checkbox.Root>
        </FilterField>

        <FilterField w="auto">
          <Checkbox.Root
            checked={includeArchived}
            onCheckedChange={(e) => refilter(() => setIncludeArchived(!!e.checked))}
            data-testid="account-show-archived"
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control />
            <Checkbox.Label>{t("financialAccounts.showArchived")}</Checkbox.Label>
          </Checkbox.Root>
        </FilterField>

        {isMobile && (
          <FilterField testId="account-sort-field">
            <AccountSortSelect value={sort} onChange={sortBy} />
          </FilterField>
        )}
      </FilterBar>

      {/* THE TYPE IS A TAB ROW (owner, `the-accounts-type-is-a-tab-row`) — right over the table it narrows, the
          picked type's card lighting up in the strip above. */}
      <AccountTypeTabs value={type} onChange={(next) => refilter(() => setType(next))} totals={totals.data} />

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
                  {/* THE SORT IS IN THE HEADINGS (owner, `the-accounts-table-sorts-from-its-headings`) — the two the
                      contract can order by, A to Z first. Balance and last checked come from another RPC, so the
                      server cannot sort a page by them; the rest would mean nothing in order. */}
                  <SortableHeader
                    column="name"
                    label={t("financialAccounts.col.account")}
                    sort={sort}
                    onSortChange={sortBy}
                    firstDir="asc"
                    testId="account-sort-name"
                  />
                  <SortableHeader
                    column="provider"
                    label={t("financialAccounts.col.provider")}
                    sort={sort}
                    onSortChange={sortBy}
                    firstDir="asc"
                    testId="account-sort-provider"
                  />
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
                        {/* WHAT THE BANNER USED TO SAY, under the figure it is about (owner,
                            `a-balance-below-zero-says-to-check-the-bank`) — the ⚠ on that line, not beside the number. */}
                        <BalanceText balance={b?.balance} testId={`account-balance-${id}`} hint={t("financialAccounts.belowZeroHint")} />
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
