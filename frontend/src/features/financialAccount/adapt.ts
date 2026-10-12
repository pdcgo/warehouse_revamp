import type { Timestamp } from "@bufbuild/protobuf/wkt";

import {
  type FinancialAccount,
  type FinancialAccountByIdsResponse,
  type FinancialAccountListResponseItem,
  type FinancialAccountLog,
  type FinancialAccountLogListResponseItem,
  type FinancialAccountOverviewResponse,
  type FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";

// The guideline's columnar envelopes, unwrapped at the query boundary so no screen reads one.

export function accountsFromList(items: FinancialAccountListResponseItem[], ids: bigint[]): FinancialAccount[] {
  let m: { [key: string]: FinancialAccount } = {};
  for (const it of items) {
    if (it.d.case === "account") m = it.d.value.mapData;
  }

  return ids.map((id) => m[id.toString()]).filter((a): a is FinancialAccount => !!a);
}

// Keyed per id. An ARCHIVED account is present — an old row still names it. Another team's is absent.
export function accountsFromByIds(res: FinancialAccountByIdsResponse): Map<string, FinancialAccount> {
  const out = new Map<string, FinancialAccount>();

  for (const [id, list] of Object.entries(res.items)) {
    for (const item of list.items) {
      if (item.d.case !== "account") continue;

      const account = item.d.value.mapData[id];
      if (account) out.set(id, account);
    }
  }

  return out;
}

export interface AccountBalance {
  balance: number;
  /** Unset = never reconciled — the screen says so rather than showing a blank. */
  reconciledAt?: Timestamp;
}

export interface TypeTotal {
  type: FinancialAccountType;
  balance: number;
  accountCount: number;
  belowZeroCount: number;
}

export function balancesFromOverview(res: FinancialAccountOverviewResponse): Map<string, AccountBalance> {
  const out = new Map<string, AccountBalance>();

  for (const item of res.items) {
    if (item.d.case !== "balance") continue;

    for (const [id, b] of Object.entries(item.d.value.mapData)) {
      out.set(id, { balance: b.balance, reconciledAt: b.reconciledAt });
    }
  }

  return out;
}

export function typeTotalsFromOverview(res: FinancialAccountOverviewResponse): TypeTotal[] {
  for (const item of res.items) {
    if (item.d.case !== "typeTotal") continue;

    return item.d.value.items.map((t) => ({
      type: t.type,
      balance: t.balance,
      accountCount: Number(t.accountCount),
      belowZeroCount: Number(t.belowZeroCount),
    }));
  }

  return [];
}

export function logsFromList(items: FinancialAccountLogListResponseItem[], ids: bigint[]): FinancialAccountLog[] {
  let m: { [key: string]: FinancialAccountLog } = {};
  for (const it of items) {
    if (it.d.case === "log") m = it.d.value.mapData;
  }

  return ids.map((id) => m[id.toString()]).filter((l): l is FinancialAccountLog => !!l);
}
