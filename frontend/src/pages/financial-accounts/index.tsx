import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Archive, ArrowLeft, ChartColumn, Plus, TriangleAlert } from "lucide-react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterField, FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { SortableHeader, type SortState } from "../../components/chrome/SortableHeader";
import { ShopSelect } from "../../components/pickers/ShopSelect";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { FinancialAccountStatus, type FinancialAccountType } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { AccountActions } from "../../features/financialAccount/AccountActions";
import { AccountLinks } from "../../features/financialAccount/AccountLinks";
import { AccountFormDialog } from "../../features/financialAccount/AccountFormDialog";
import { FINANCIAL_ACCOUNT_PENDING } from "../../features/financialAccount/pending";
import type { TypeTotal } from "../../features/financialAccount/adapt";
import { BalanceText, ProviderBadge } from "../../features/financialAccount/badges";
import { useAccountBalances, useFinancialAccounts, useTypeTotals } from "../../features/financialAccount/queries";
import { TYPE_KEY, accountName, isUnknown } from "../../features/financialAccount/vocab";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useShopOptions } from "../../features/shops/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixRelative } from "../../lib/datetime";
import { canMoveAccountMoney, canTransferMoney } from "../../lib/roles";
import { AccountBlock } from "./components/AccountBlock";
import { AccountOptionsFilter } from "./components/AccountOptionsFilter";
import { type AccountSortKey, AccountSortSelect } from "./components/AccountSortSelect";
import { AccountTypeTabs } from "./components/AccountTypeTabs";
import { TypeTotals } from "./components/TypeTotals";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
/** How many accounts the archive view asks for, to keep the archived among them — see `pending.ts`. */
const ARCHIVE_WINDOW = 200;

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
//  - THE ARCHIVE IS ITS OWN VIEW (owner, `the-archive-is-its-own-view`): the Archive button beside New Account
//    turns this same screen into the archived list — no totals, the search, the shop and the type tabs — and
//    back. The contract cannot list archived accounts alone, so the view says so (`pending.ts`);
//  - EVERY FILTER THE CONTRACT HAS, in the shared FilterBar (owner, `the-accounts-list-has-every-filter-the-contract-has`),
//    and the sort from the NAME and PROVIDER headings, A to Z first (`the-accounts-table-sorts-from-its-headings`).
export function FinancialAccountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { current } = useTeam();

  // `?view=archived` — the same route, so the back button returns to the active list.
  const [params, setParams] = useSearchParams();
  const archivedView = params.get("view") === "archived";

  const [q, setQ] = useState("");
  const [type, setType] = useState<FinancialAccountType | undefined>(undefined);
  const [shopId, setShopId] = useState(0n);
  const [operationalOnly, setOperationalOnly] = useState(false);
  const [sort, setSort] = useState<SortState<AccountSortKey> | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [creating, setCreating] = useState(false);

  const teamId = current?.teamId;
  // ⚠ THE ARCHIVE VIEW ASKS FOR THE ACTIVE TOO, and keeps the archived on screen: the contract can only ADD the
  // archived (`include_archived`), never leave the active out. So it takes one window of ARCHIVE_WINDOW, and the
  // type, the count and the page are worked out here — marked as such (`FINANCIAL_ACCOUNT_PENDING`).
  const list = useFinancialAccounts({
    teamId,
    q,
    includeArchived: archivedView,
    types: archivedView || type === undefined ? [] : [type],
    shopId,
    operationalOnly: archivedView ? false : operationalOnly,
    sort,
    page: archivedView ? 1 : page,
    pageSize: archivedView ? ARCHIVE_WINDOW : pageSize,
  });
  const archivedAll = archivedView
    ? (list.data?.accounts ?? []).filter((a) => a.status === FinancialAccountStatus.ARCHIVED)
    : [];
  const archivedOfType = type === undefined ? archivedAll : archivedAll.filter((a) => a.type === type);
  const accounts = archivedView
    ? archivedOfType.slice((page - 1) * pageSize, page * pageSize)
    : (list.data?.accounts ?? []);
  const totalItems = archivedView ? archivedOfType.length : (list.data?.totalItems ?? 0);
  // The tabs' counts, of the archived — the server's totals count the active only.
  const archivedTotals: TypeTotal[] = [...new Set(archivedAll.map((a) => a.type))].map((t) => ({
    type: t,
    balance: 0,
    accountCount: archivedAll.filter((a) => a.type === t).length,
    belowZeroCount: 0,
  }));
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
  const shopOf = (id: bigint) => shops.data?.find((s) => s.id === id);
  const nameOf = (id: bigint) => shopOf(id)?.name;
  const shopName = (id: bigint) => nameOf(id) ?? `#${id}`;

  const error = [list, balances, totals].find((query) => query.isError)?.error;

  // Every filter changes the question, so each goes back to page 1.
  const refilter = (apply: () => void) => {
    setPage(1);
    apply();
  };
  // The type is a TAB, not a filter (`the-accounts-type-is-a-tab-row`) — Clear leaves it where it is.
  const filtering = [q.trim() !== "", shopId > 0n, !archivedView && operationalOnly].filter(Boolean).length;
  const sortBy = (next: SortState<AccountSortKey> | null) => refilter(() => setSort(next));
  // Into the archive and back: the same screen, a new question — page 1, every type.
  const showArchived = (next: boolean) => {
    setParams(next ? { view: "archived" } : {});
    setPage(1);
    setType(undefined);
  };

  return (
    <Stack gap="section" data-testid="financial-accounts-page">
      {/* THE SUBTITLE SITS UNDER THE TITLE (owner, `the-accounts-subtitle-sits-under-the-title`) — one block,
          the actions beside it, instead of a section's gap between a title and the line that explains it.

          ⚠ A BASIS, NOT `flex="1"`. With a zero basis the title block never asked for room, so on a phone it shrank to
          40px — the subtitle one word a line, 399px tall — while the actions stayed on its row, Laporan over the title.
          At 16rem it wraps the actions onto a row of their own under it, and on a desktop still takes the free space. */}
      <Flex align="flex-start" gap="card" wrap="wrap">
        <Stack gap="1" flex="1 1 16rem" minW="0">
          <HStack gap="2" wrap="wrap">
            <Heading size="md" data-testid="financial-accounts-heading">
              {t(archivedView ? "financialAccounts.archivedView.title" : "financialAccounts.title")}
            </Heading>
            <Badge colorPalette="brand">{current.teamName}</Badge>
            {archivedView && <NotImplemented list={FINANCIAL_ACCOUNT_PENDING} id="archivedOnly" />}
          </HStack>
          <Text fontSize="sm" color="fg.muted" data-testid="financial-accounts-subtitle">
            {t(archivedView ? "financialAccounts.archivedView.subtitle" : "financialAccounts.subtitle")}
          </Text>
        </Stack>
        <HStack gap="2" wrap="wrap">
          {archivedView ? (
            <Button size="xs" variant="outline" data-testid="back-to-active-accounts" onClick={() => showArchived(false)}>
              <Icon as={ArrowLeft} boxSize="4" />
              {t("financialAccounts.archivedView.back")}
            </Button>
          ) : (
            <>
              {/* ⚠ `openReport`, NOT `report`: `financialAccounts.report` is the report page's whole namespace, an
                  object — i18next renders "returned an object instead of string" where the word should be. */}
              <Button size="xs" variant="outline" data-testid="open-account-report" onClick={() => navigate("/financial-accounts/report")}>
                <Icon as={ChartColumn} boxSize="4" />
                {t("financialAccounts.openReport")}
              </Button>
              {/* The archive, one row with New Account (owner) — the same screen, archived only. */}
              <Button size="xs" variant="outline" data-testid="open-archived-accounts" onClick={() => showArchived(true)}>
                <Icon as={Archive} boxSize="4" />
                {t("financialAccounts.archivedView.open")}
              </Button>
              {canMove && (
                <Button size="xs" colorPalette="brand" data-testid="open-create-account" onClick={() => setCreating(true)}>
                  <Icon as={Plus} boxSize="4" />
                  {t("financialAccounts.newAccount")}
                </Button>
              )}
            </>
          )}
        </HStack>
      </Flex>

      {/* What the account screens cannot do yet — the archive list, and provider Lainnya in New Account. */}
      <NotImplementedSummary list={FINANCIAL_ACCOUNT_PENDING} />

      {/* No totals in the archive — every archived account holds zero. */}
      {!archivedView && <TypeTotals totals={totals.data} highlight={type} />}

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

        {/* The Filter panel — Operational only, the active list's (`operational-and-archived-share-one-filter-panel`). */}
        {!archivedView && (
          <FilterField w="auto">
            <AccountOptionsFilter
              operationalOnly={operationalOnly}
              onOperationalOnlyChange={(next) => refilter(() => setOperationalOnly(next))}
            />
          </FilterField>
        )}

        {isMobile && (
          <FilterField testId="account-sort-field">
            <AccountSortSelect value={sort} onChange={sortBy} />
          </FilterField>
        )}
      </FilterBar>

      {/* THE TYPE IS A TAB ROW (owner, `the-accounts-type-is-a-tab-row`) — right over the table it narrows, the
          picked type's card lighting up in the strip above. */}
      <AccountTypeTabs
        value={type}
        onChange={(next) => refilter(() => setType(next))}
        totals={archivedView ? (list.data ? archivedTotals : undefined) : totals.data}
      />

      {error && (
        <Text color="fg.error" data-testid="financial-accounts-error">
          {rpcError(error)}
        </Text>
      )}

      {list.isPending ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={list.isFetching && !list.isPending}>
          {/* A PHONE READS EACH ACCOUNT AS A BLOCK (`a-phone-reads-each-line-as-a-block`) — the table was 929px in a
              318px screen, the balance and the actions off to the right, its headings over nothing. The sort is the
              Filter sheet's select there. */}
          {isMobile ? (
            <Stack gap="0" data-testid="financial-accounts-table">
              {accounts.map((account) => {
                const b = balances.data?.get(account.id.toString());

                return (
                  <AccountBlock
                    key={account.id.toString()}
                    account={{ ...account, name: accountName(account, nameOf) }}
                    balance={b?.balance}
                    reconciledAt={b?.reconciledAt}
                    teamId={teamId}
                    canMove={canMove}
                    canTransfer={canTransferMoney(current.role)}
                    shopNames={account.shopIds.map(shopName)}
                    shopOf={shopOf}
                    onOpen={() => navigate(`/financial-accounts/${account.id}`)}
                  />
                );
              })}
            </Stack>
          ) : (
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
                    <Table.ColumnHeader textAlign="end">{t("financialAccounts.col.balance")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("financialAccounts.col.lastChecked")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("financialAccounts.col.linkedTo")}</Table.ColumnHeader>
                    {canMove && <Table.ColumnHeader textAlign="end">{t("financialAccounts.col.actions")}</Table.ColumnHeader>}
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {accounts.map((account) => {
                    const id = account.id.toString();
                    const b = balances.data?.get(id);
                    const archived = account.status === FinancialAccountStatus.ARCHIVED;
                    const unknown = isUnknown(account);
                    // An unknown account is shown by its shop's name (`the-unknown-account-reads-lainnya`).
                    const shown = { ...account, name: accountName(account, nameOf) };

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
                            </HStack>
                            {/* AN UNKNOWN ACCOUNT SAYS WHAT IS LEFT TO DO, where the holder would be (owner,
                                `the-unknown-row-warns-and-sets-from-the-menu`) — the type there only repeated the
                                provider badge. Not mandatory, but every later withdrawal lands here until it is set,
                                and reconciling the real bank first counts the money twice. */}
                            {/* Only where a shop's withdrawals land — a Lainnya account a person opened holds none. */}
                            {unknown && account.shopIds.length > 0 ? (
                              <HStack gap="1" color="fg.warning" data-testid={`account-not-set-${id}`}>
                                <Icon as={TriangleAlert} boxSize="3" />
                                <Text fontSize="xs">{t("financialAccounts.accountNotSet")}</Text>
                              </HStack>
                            ) : (
                              <Text fontSize="xs" color="fg.muted">
                                {account.holderName || t(TYPE_KEY[account.type]!)}
                              </Text>
                            )}
                          </Stack>
                        </Table.Cell>
                        {/* THE PROVIDER AND ITS NUMBER, ONE CELL (owner, `the-provider-cell-carries-the-number`) — the
                            badge first, because the column sorts by it; the number quiet under it. A cash box or an
                            unknown account has no number, and the cell is the badge alone. */}
                        <Table.Cell>
                          <Stack gap="0.5" align="flex-start">
                            <ProviderBadge provider={account.provider} />
                            {account.accountNumber && (
                              <Text fontFamily="mono" fontSize="xs" color="fg.muted" data-testid={`account-number-${id}`}>
                                {account.accountNumber}
                              </Text>
                            )}
                          </Stack>
                        </Table.Cell>
                        <Table.Cell textAlign="end">
                          {/* WHAT THE BANNER USED TO SAY, under the figure it is about (owner,
                              `a-balance-below-zero-says-to-check-the-bank`) — the ⚠ on that line, not beside the number. */}
                          <BalanceText balance={b?.balance} testId={`account-balance-${id}`} hint={t("financialAccounts.belowZeroHint")} bold />
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
                          <AccountLinks account={shown} shopOf={shopOf} />
                        </Table.Cell>
                        {canMove && (
                          <Table.Cell textAlign="end">
                            <AccountActions
                              teamId={teamId}
                              account={shown}
                              balance={b?.balance}
                              shopNames={account.shopIds.map(shopName)}
                              canTransfer={canTransferMoney(current.role)}
                              buttons
                            />
                          </Table.Cell>
                        )}
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>
          )}
        </RefreshOverlay>
      )}

      {!list.isPending && accounts.length === 0 && !error && (
        <Box data-testid="financial-accounts-empty">
          <Text color="fg.muted">{q ? t("financialAccounts.emptySearch") : t("financialAccounts.empty")}</Text>
        </Box>
      )}

      {/* THE PAGES GROW AS THEY ARE OPENED (owner, `the-accounts-pager-grows-with-the-pages-opened`) — every page
          opened keeps its number until the screen is left; a new filter, tab, sort or page size starts over. This
          contract has a total, so "is there a next" is exact; while the next page loads it is not known yet. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={archivedView ? page * pageSize < totalItems : list.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[archivedView, q, shopId, operationalOnly, type, sort?.by, sort?.dir, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="account-pager"
      />

      {creating && <AccountFormDialog teamId={teamId} open onOpenChange={(o) => !o && setCreating(false)} />}
    </Stack>
  );
}
