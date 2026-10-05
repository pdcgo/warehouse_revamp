import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { financialAccountClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import type { SortState } from "../../components/chrome/SortableHeader";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";
import {
  type CapitalDirection,
  type FinancialAccountChangeType,
  FinancialAccountByIdsDataType,
  type FinancialAccountIdentity,
  FinancialAccountListDataType,
  FinancialAccountLogListDataType,
  FinancialAccountMetricDataType,
  type FinancialAccountProvider,
  FinancialAccountRowSort,
  type FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import {
  accountsFromByIds,
  accountsFromList,
  balancesFromOverview,
  logsFromList,
  typeTotalsFromOverview,
} from "./adapt";

// The team's financial accounts — docs/business/financial_account/context_decision.md.
//
// Every member SEES, admin and up MOVES (seeing-is-team-wide-moving-is-admin-and-up). The balances come
// from their own RPC, never the list, so the two policies can part later without a screen noticing.
//
// ⚠ ONE KEY PREFIX for the accounts, their balances, their logs and their reports: every write moves a
// balance, and a balance shows in all four — so each write drops the whole prefix.

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────

/** The accounts page — archived on request, searched, paged. */
export function useFinancialAccounts(args: {
  teamId: bigint | undefined;
  q: string;
  includeArchived: boolean;
  /** Empty = every type. */
  types?: FinancialAccountType[];
  /** The account this shop withdraws into — at most one. 0n = every shop. */
  shopId?: bigint;
  operationalOnly?: boolean;
  /** A heading's sort; `null` = the list's own order — active before archived, then by name. */
  sort?: SortState<"name" | "provider"> | null;
  page: number;
  pageSize: number;
}) {
  const { teamId, q, includeArchived, types = [], shopId = 0n, operationalOnly = false, sort = null, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, {
      list: true,
      q,
      includeArchived,
      types: types.join(","),
      shopId: shopId.toString(),
      operationalOnly,
      sort: sort ? `${sort.by}:${sort.dir}` : "",
      page,
      pageSize,
    }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountList({
        teamId: teamId!,
        filter: { q, includeArchived, types, shopId, operationalOnly },
        sort: sort
          ? {
              sortType: sort.dir === "desc" ? CommonSortType.DESC : CommonSortType.ASC,
              s: {
                case: "account",
                value: sort.by === "name" ? FinancialAccountRowSort.NAME : FinancialAccountRowSort.PROVIDER,
              },
            }
          : undefined,
        dataRequest: [FinancialAccountListDataType.ACCOUNT],
        page: { page, limit: pageSize },
      });

      return {
        accounts: accountsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

/**
 * The PICKER feed — active accounts only, one large page. A picker names an account to record a FACT
 * (which one paid), so it reads as reference data; any write drops it with the rest of the prefix.
 */
export function useFinancialAccountOptions(args: { teamId: bigint; operationalOnly?: boolean }) {
  const { teamId, operationalOnly = false } = args;

  return useQuery({
    ...referenceQuery,
    queryKey: key.financialAccounts(teamId, { options: true, operationalOnly }),
    enabled: teamId > 0n,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountList({
        teamId,
        filter: { operationalOnly },
        dataRequest: [FinancialAccountListDataType.ACCOUNT],
        page: { page: 1, limit: 200 },
      });

      return accountsFromList(res.items, res.ids);
    },
  });
}

/**
 * The account a shop withdraws into now — at most one (a-shop-has-one-account). `null` when it names
 * none, and its next withdrawal will make an `unknown` one (a-shop-with-no-account-gets-an-unknown-one).
 */
export function useAccountOfShop(teamId: bigint, shopId: bigint) {
  return useQuery({
    queryKey: key.financialAccounts(teamId, { ofShop: shopId.toString() }),
    enabled: teamId > 0n && shopId > 0n,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountList({
        teamId,
        filter: { shopId, includeArchived: true },
        dataRequest: [FinancialAccountListDataType.ACCOUNT],
        page: { page: 1, limit: 1 },
      });

      return accountsFromList(res.items, res.ids)[0] ?? null;
    },
  });
}

/** Name lookup for ids a screen already holds — a transfer's other account. Archived ones resolve. */
export function useFinancialAccountsByIds(teamId: bigint | undefined, accountIds: bigint[]) {
  const ids = [...new Set(accountIds.filter((id) => id > 0n))].sort();

  return useQuery({
    ...referenceQuery,
    queryKey: key.financialAccounts(teamId, { byIds: ids.map(String).join(",") }),
    enabled: teamId !== undefined && ids.length > 0,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountByIds({
        teamId: teamId!,
        filter: { ids },
        dataRequest: [FinancialAccountByIdsDataType.ACCOUNT],
      });

      return accountsFromByIds(res);
    },
  });
}

/** One account — the detail page's subject. Plain default: a different id is a different subject. */
export function useFinancialAccount(teamId: bigint | undefined, accountId: bigint) {
  return useQuery({
    queryKey: key.financialAccounts(teamId, { account: accountId.toString() }),
    enabled: teamId !== undefined && accountId > 0n,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountByIds({
        teamId: teamId!,
        filter: { ids: [accountId] },
        dataRequest: [FinancialAccountByIdsDataType.ACCOUNT],
      });

      return accountsFromByIds(res).get(accountId.toString()) ?? null;
    },
  });
}

/** The balances of the accounts a screen shows, and when each was last checked. */
export function useAccountBalances(teamId: bigint | undefined, accountIds: bigint[]) {
  const ids = [...accountIds].sort();

  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, { balances: ids.map(String).join(",") }),
    enabled: teamId !== undefined && ids.length > 0,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountOverview({
        teamId: teamId!,
        filter: { accountIds: ids },
        metricRequest: [FinancialAccountMetricDataType.BALANCE],
      });

      return balancesFromOverview(res);
    },
  });
}

/** The team's money by type — the strip above the list. */
export function useTypeTotals(teamId: bigint | undefined) {
  return useQuery({
    queryKey: key.financialAccounts(teamId, { typeTotals: true }),
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountOverview({
        teamId: teamId!,
        metricRequest: [FinancialAccountMetricDataType.TYPE_TOTAL],
      });

      return typeTotalsFromOverview(res);
    },
  });
}

/** One account's rows, newest first — the statement on its page. */
export function useAccountLogs(args: {
  teamId: bigint | undefined;
  accountId: bigint;
  changeTypes: FinancialAccountChangeType[];
  from: string;
  to: string;
  page: number;
  pageSize: number;
}) {
  const { teamId, accountId, changeTypes, from, to, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, {
      logs: accountId.toString(),
      changeTypes: changeTypes.join(","),
      from,
      to,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && accountId > 0n,
    queryFn: async () => {
      const res = await financialAccountClient.financialAccountLogList({
        teamId: teamId!,
        filter: { accountId, changeTypes, occurredFrom: from, occurredTo: to },
        dataRequest: [FinancialAccountLogListDataType.LOG],
        page: { page, limit: pageSize },
      });

      return {
        logs: logsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────
//
// Each drops the whole prefix (see the top). The hook owns the cache; the component owns the toast and
// the dialog. Every one is admin and up — the screen hides them from anyone else, the server refuses.

function useInvalidateAccounts() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["financialAccounts"] });
}

export function useCreateAccount() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: {
      teamId: bigint;
      type: FinancialAccountType;
      provider: FinancialAccountProvider;
      name: string;
      holderName: string;
      accountNumber: string;
      description: string;
      openingBalance: number;
      openingOn: string;
    }) => financialAccountClient.financialAccountCreate(vars),
    onSuccess: () => invalidate(),
  });
}

// Name, holder and description — provider and number are fixed.
export function useUpdateAccount() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; accountId: bigint; name: string; holderName: string; description: string }) =>
      financialAccountClient.financialAccountUpdate(vars),
    onSuccess: () => invalidate(),
  });
}

export type IdentifyTarget =
  | { case: "fillIn"; value: Omit<FinancialAccountIdentity, "$typeName"> }
  | { case: "moveIntoAccountId"; value: bigint };

export function useIdentifyAccount() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; accountId: bigint; target: IdentifyTarget }) =>
      financialAccountClient.financialAccountIdentify(vars),
    onSuccess: () => invalidate(),
  });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; accountId: bigint }) => financialAccountClient.financialAccountArchive(vars),
    onSuccess: () => invalidate(),
  });
}

export function useRestoreAccount() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; accountId: bigint }) => financialAccountClient.financialAccountRestore(vars),
    onSuccess: () => invalidate(),
  });
}

export function useTransfer() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: {
      teamId: bigint;
      fromAccountId: bigint;
      toAccountId: bigint;
      amount: number;
      occurredOn: string;
      note: string;
    }) => financialAccountClient.financialAccountTransfer(vars),
    onSuccess: () => invalidate(),
  });
}

export function useCapital() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: {
      teamId: bigint;
      accountId: bigint;
      direction: CapitalDirection;
      amount: number;
      occurredOn: string;
      note: string;
    }) => financialAccountClient.financialAccountCapital(vars),
    onSuccess: () => invalidate(),
  });
}

export function useReconcile() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; accountId: bigint; actualBalance: number; asOf: string; note: string }) =>
      financialAccountClient.financialAccountReconcile(vars),
    onSuccess: () => invalidate(),
  });
}

export function useShopSet() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; shopId: bigint; accountId: bigint }) =>
      financialAccountClient.financialAccountShopSet(vars),
    onSuccess: () => invalidate(),
  });
}

export function useOperationalSet() {
  const invalidate = useInvalidateAccounts();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; accountId: bigint; operational: boolean }) =>
      financialAccountClient.financialAccountOperationalSet(vars),
    onSuccess: () => invalidate(),
  });
}
