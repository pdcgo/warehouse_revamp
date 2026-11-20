import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { financialAccountClient } from "../../api/clients";
import { ExpenseKind, type ExpenseRecord, ExpenseRecordSchema } from "../../gen/warehouse/expense/v1/expense_pb";
import { CapitalDirection } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { expenseKindLabel } from "../../components/pickers/ExpenseKindSelect";
import { monthRange } from "../../lib/period";

// ⚠ STORYBOOK-ONLY PROTOTYPE — backlog #99, decisions `expense-types-sit-under-groups` and
// `prive-and-deposit-on-pengeluaran-are-the-accounts-capital` (docs/business/financial_account/context_decision.md), the
// owner's checklist docs/acceptances/financial_account/expense.md givens 6–22 and 28. Nothing here is live: no route, no
// backend, no proto. `useExpenseTypes()` answers null unless a story mounts <ExpenseTypesPrototype>, and every part in
// ./ExpenseTypesParts.tsx draws nothing (or exactly today's text) without it — the `Live · …` stories pin that the live
// screens are unchanged. On the owner's design accept the build replaces this file with the API below.
//
// THE RULE, as decided: an expense has a TYPE, and every type sits under one GROUP — today's four kinds, Iklan · Gaji ·
// Operasional · Lainnya (Stok hilang/rusak stays the automatic one). The record dialog's picker lists the types under
// their group; the month's totals show each group with its types under it; the filter takes a group or one type. An
// expense recorded before the types keeps its group and NO type (no guessed backfill). Prive and Setoran modal are the
// account's CAPITAL row — one record, two doors (Pengeluaran and the account page's Setor / Tarik Modal) — and never an
// expense in the profit.
//
// THE AMOUNT STAYS POSITIVE; THE TYPE SAYS THE DIRECTION (expense.proto: "on an EXPENSE always positive"). Six types are
// money the other way or the owner's own: Piutang luar diterima, Setoran modal and Uang masuk lain bring money IN (the
// account increases, the type's and the month's total decrease — givens 19, 21, 22); Prive takes capital out (given 18).
//
// THE ASSUMED API (the build's proposal — also in the accept README):
//
//   expense.proto   enum ExpenseType { UNSPECIFIED = 0; … 18 values, APPEND ONLY } — EXPENSE_TYPES below, numbered as
//                   here. Each type's group, direction and capital flag are a fixed table in expense_service (and this
//                   catalogue on the screen), never a column a person sets.
//                   ExpenseRecord.type = 14 (0 = recorded before the types: its kind only); `kind` stays and is the
//                   group, written from the type. ExpenseCreateRequest.type required (kind derived); `amount` > 0 as
//                   today. ExpenseListFilter.type (0 = any) beside `kind` (the group). ExpenseListResponse.totals gains
//                   by_type (map<int32,double>, signed: money in negative), spending, money_in, capital — and `total`
//                   becomes the checklist's month total: spending − money_in + capital. by_kind is each group's net.
//   the event       the expense event carries the type; financial_account's listener posts ADS-group rows as
//                   `ads_expense`, Prive / Setoran modal as `capital` (signed: out −, in +), the rest as `expense` —
//                   one row each, as today. The money-in types raise the account: as a change type of their own
//                   (accept question 1, recommended) or as a positive `expense` row.
//   the account     a SELLING team's Setor / Tarik Modal on the account page calls ExpenseCreate (Setoran modal /
//                   Prive, origin ACCOUNT_PAGE) instead of FinancialAccountCapital — the same one record; a warehouse
//                   team's stays FinancialAccountCapital, as today. FinancialAccountLog.expense_id names the expense a
//                   row was posted from (the history's "from Expenses · <who>").
//   the metric      ExpensesMetric keeps ads · payroll · operational · other (each group's SPENDING) and `total` (their
//                   sum — never capital, never money in); appends money_in = 6, capital_out = 7, capital_in = 8. No
//                   per-type field: per-type totals live on Pengeluaran (ExpenseList.totals.by_type).

// ── The catalogue — the assumed `ExpenseType` enum ────────────────────────────────────────────────────────────────────

export type ExpenseDirection = "out" | "in";

export interface ExpenseTypeDef {
  /** The assumed `ExpenseType` enum number (expense.proto, appended). */
  id: number;
  /** Its words: `expenses.types.type.<key>`. */
  key: string;
  /** The group it sits under — today's ExpenseKind (expense-types-sit-under-groups). */
  group: ExpenseKind;
  /** Which way the money goes; the amount itself stays positive. */
  direction: ExpenseDirection;
  /** Prive / Setoran modal — the account's capital row (prive-and-deposit-on-pengeluaran-are-the-accounts-capital). */
  capital?: boolean;
  /** The one type that names its shop (an-expense-names-a-shop-only-for-ads). */
  namesShop?: boolean;
}

/** The groups, in the picker's and the card's order. */
export const TYPE_GROUPS: readonly ExpenseKind[] = [
  ExpenseKind.ADS,
  ExpenseKind.PAYROLL,
  ExpenseKind.OPERATIONAL,
  ExpenseKind.OTHER,
];

/** Every type, under its group, in the picker's order (checklist givens 3, 6–22). */
export const EXPENSE_TYPES: readonly ExpenseTypeDef[] = [
  { id: 1, key: "adsMarketplace", group: ExpenseKind.ADS, direction: "out", namesShop: true },
  { id: 2, key: "contentEndorse", group: ExpenseKind.ADS, direction: "out" },
  { id: 3, key: "basicSalary", group: ExpenseKind.PAYROLL, direction: "out" },
  { id: 4, key: "bonus", group: ExpenseKind.PAYROLL, direction: "out" },
  { id: 5, key: "contributions", group: ExpenseKind.PAYROLL, direction: "out" },
  { id: 6, key: "electricity", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 7, key: "internet", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 8, key: "kitchen", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 9, key: "tools", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 10, key: "equipment", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 11, key: "bankFee", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 12, key: "discrepancy", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: 13, key: "outsideDebtPaid", group: ExpenseKind.OTHER, direction: "out" },
  { id: 14, key: "outsideReceivableReceived", group: ExpenseKind.OTHER, direction: "in" },
  { id: 15, key: "prive", group: ExpenseKind.OTHER, direction: "out", capital: true },
  { id: 16, key: "capitalDeposit", group: ExpenseKind.OTHER, direction: "in", capital: true },
  { id: 17, key: "otherOut", group: ExpenseKind.OTHER, direction: "out" },
  { id: 18, key: "otherIn", group: ExpenseKind.OTHER, direction: "in" },
];

export const typeDef = (id: number): ExpenseTypeDef | undefined => EXPENSE_TYPES.find((d) => d.id === id);
export const typeByKey = (key: string): ExpenseTypeDef => EXPENSE_TYPES.find((d) => d.key === key)!;

/** The type's own words — "Listrik". */
export const typeLabel = (t: TFunction, def: ExpenseTypeDef): string => t(`expenses.types.type.${def.key}`);

/** Group › type — "Operasional › Listrik"; a row recorded before the types reads its group alone. */
export function fullTypeLabel(t: TFunction, group: ExpenseKind, def: ExpenseTypeDef | undefined): string {
  return def ? `${expenseKindLabel(t, group)} › ${typeLabel(t, def)}` : expenseKindLabel(t, group);
}

/** +1 for money out, −1 for money in — what a row adds to its type's, its group's and the month's total. */
export const directionSign = (def: ExpenseTypeDef | undefined): number => (def?.direction === "in" ? -1 : 1);

// ── The month's figures — what ExpenseList.totals would carry ─────────────────────────────────────────────────────────

export interface TypeLine {
  /** 0 = recorded before the types. */
  typeId: number;
  /** Signed: money in is negative. */
  total: number;
}

export interface GroupTotal {
  kind: ExpenseKind;
  /** The group's net — its types' lines summed (a money-in type lowers it, as the checklist's thens move it). */
  total: number;
  lines: TypeLine[];
}

export interface TypeTotals {
  groups: GroupTotal[];
  /** Every money-out row but Prive — what the month SPENT. */
  spending: number;
  /** Every money-in row but Setoran modal, as a positive figure. */
  moneyIn: number;
  /** Prive − Setoran modal — the owner's capital taken out, net. Never an expense in the profit. */
  capital: number;
  /** The checklist's month total: spending − money in + capital (givens 17–22). */
  total: number;
}

/** The figures for these rows — an adjustment counts in its expense's type, signed by that type's direction. */
export function typeTotals(rows: ExpenseRecord[], typeOf: (cost: ExpenseRecord) => ExpenseTypeDef | undefined): TypeTotals {
  const byGroup = new Map<ExpenseKind, Map<number, number>>();
  let spending = 0;
  let moneyIn = 0;
  let capital = 0;

  for (const cost of rows) {
    const def = typeOf(cost);
    const signed = cost.amount * directionSign(def);
    const lines = byGroup.get(cost.kind) ?? new Map<number, number>();
    lines.set(def?.id ?? 0, (lines.get(def?.id ?? 0) ?? 0) + signed);
    byGroup.set(cost.kind, lines);

    if (def?.capital) capital += signed;
    else if (def?.direction === "in") moneyIn -= signed;
    else spending += signed;
  }

  // The four groups always (an empty one reads Rp 0, as today's kinds did); the automatic stock loss only when it has rows.
  const kinds = [...TYPE_GROUPS, ...(byGroup.has(ExpenseKind.STOCK_LOSS) ? [ExpenseKind.STOCK_LOSS] : [])];
  const groups = kinds.map((kind) => {
    const lines = byGroup.get(kind) ?? new Map<number, number>();
    // The rows with no type first (they are the group's oldest), then the types in the picker's order. A line that nets
    // to nothing (an expense cancelled) is left out — the group still counts it as 0.
    const ordered = [0, ...EXPENSE_TYPES.filter((d) => d.group === kind).map((d) => d.id)]
      .filter((id) => (lines.get(id) ?? 0) !== 0)
      .map((id) => ({ typeId: id, total: lines.get(id)! }));

    return { kind, total: [...lines.values()].reduce((a, b) => a + b, 0), lines: ordered };
  });

  return { groups, spending, moneyIn, capital, total: spending - moneyIn + capital };
}

// ── The prototype's server, in memory ─────────────────────────────────────────────────────────────────────────────────

/** One row the prototype's server holds — an ExpenseRecord's fields, its type, and which door it came through. */
export interface ExpenseTypeRow {
  id: bigint;
  teamId: bigint;
  shopId: bigint;
  kind: ExpenseKind;
  /** On an expense positive; on an adjustment signed, never 0 — as today. */
  amount: number;
  occurredAt: string;
  note: string;
  createdBy: bigint;
  createdAtUnix: bigint;
  adjustsExpenseId: bigint;
  financeAccountId: bigint;
  isOverride?: boolean;
  /** 0 = recorded before the types: its group only. An adjustment reads its expense's. */
  typeId: number;
  /** Made with Setor / Tarik Modal on the account page — the same record through its other door. */
  fromAccountPage?: boolean;
}

/** What a story opens with. */
export interface ExpenseTypesSeed {
  rows: ExpenseTypeRow[];
  /** Account log rows posted from an expense (the assumed FinancialAccountLog.expense_id): log id → expense id. */
  capitalLogs?: Record<string, bigint>;
  /** The signed-in person a new row is recorded under. */
  selfId: bigint;
  nextId?: bigint;
}

export interface RecordTypeVars {
  teamId: bigint;
  typeId: number;
  amount: number;
  occurredAt: string;
  shopId: bigint;
  note: string;
  financeAccountId: bigint;
}

export interface AdjustTypeVars {
  teamId: bigint;
  expenseId: bigint;
  amount: number;
  note: string;
}

export interface ExpenseTypesApi {
  /** ExpenseList, played: the month's rows narrowed by the group and the type, newest first, paged — and the whole
   * narrowed month, for the totals (the server sums the period, never the page). */
  list(args: { teamId: bigint | undefined; month: string; kind: ExpenseKind; page: number; pageSize: number }): {
    expenses: ExpenseRecord[];
    month: ExpenseRecord[];
    totalItems: number;
  };
  /** A row's type — an adjustment's is its expense's; undefined on a row recorded before the types. */
  typeOf(cost: { id: bigint; adjustsExpenseId: bigint }): ExpenseTypeDef | undefined;
  /** Made with Setor / Tarik Modal on the account page. */
  fromAccountPage(cost: { id: bigint; adjustsExpenseId: bigint }): boolean;
  /** The filter's one type (0 = the group alone, or everything). The build keeps it in the URL, `?type=`. */
  filterType: number;
  setFilterType(id: number): void;
  record(vars: RecordTypeVars): Promise<ExpenseRecord>;
  adjust(vars: AdjustTypeVars): Promise<void>;
  /** The expense an account log row was posted from (Prive / Setoran modal typed on Pengeluaran). */
  expenseOfLog(logId: bigint): bigint | undefined;
  /**
   * A SELLING team's Setor / Tarik Modal on the account page — the same one record, through its other door: it shows on
   * Pengeluaran as Setoran modal / Prive. The build makes the dialog call ExpenseCreate; here the account's Capital call
   * already ran (the Storybook stub), and its row is remembered as the expense's.
   */
  capitalMade(vars: { teamId: bigint; accountId: bigint; inward: boolean; amount: number; occurredOn: string; note: string }): void;
}

const ExpenseTypesContext = createContext<ExpenseTypesApi | null>(null);

/** The prototype — null live, so every caller draws today's screen. */
export function useExpenseTypes(): ExpenseTypesApi | null {
  return useContext(ExpenseTypesContext);
}

const nowUnix = () => BigInt(Math.floor(Date.now() / 1000));
const invalid = (msg: string) => new ConnectError(msg, Code.InvalidArgument);

/**
 * The prototype's server, in memory: the team's expenses with their types (ExpenseList / ExpenseCreate / ExpenseAdjust
 * played), and which account rows came from Pengeluaran. Mounted by the stories only.
 */
export function ExpenseTypesPrototype({ initial, children }: { initial: ExpenseTypesSeed; children: ReactNode }) {
  const [rows, setRows] = useState<ExpenseTypeRow[]>(() => structuredClone(initial.rows));
  const [capitalLogs, setCapitalLogs] = useState<Record<string, bigint>>(() => ({ ...(initial.capitalLogs ?? {}) }));
  const [filterType, setFilterType] = useState(0);
  const [nextId, setNextId] = useState(initial.nextId ?? 700n);

  const netOf = useCallback(
    (r: ExpenseTypeRow, all: ExpenseTypeRow[]) =>
      r.adjustsExpenseId !== 0n ? 0 : all.filter((a) => a.adjustsExpenseId === r.id).reduce((s, a) => s + a.amount, r.amount),
    [],
  );

  const wire = useCallback(
    (r: ExpenseTypeRow, all: ExpenseTypeRow[]): ExpenseRecord =>
      create(ExpenseRecordSchema, {
        id: r.id,
        teamId: r.teamId,
        shopId: r.shopId,
        kind: r.kind,
        amount: r.amount,
        occurredAt: r.occurredAt,
        note: r.note,
        createdBy: r.createdBy,
        createdAtUnix: r.createdAtUnix,
        adjustsExpenseId: r.adjustsExpenseId,
        netAmount: netOf(r, all),
        financeAccountId: r.financeAccountId,
        isOverride: r.isOverride ?? false,
      }),
    [netOf],
  );

  const api = useMemo<ExpenseTypesApi>(() => {
    const rowOf = (id: bigint) => rows.find((r) => r.id === id);
    const ownRow = (cost: { id: bigint; adjustsExpenseId: bigint }) =>
      rowOf(cost.adjustsExpenseId !== 0n ? cost.adjustsExpenseId : cost.id);
    const typeOf = (cost: { id: bigint; adjustsExpenseId: bigint }) => typeDef(ownRow(cost)?.typeId ?? 0);

    return {
      list: ({ teamId, month, kind, page, pageSize }) => {
        if (teamId === undefined) return { expenses: [], month: [], totalItems: 0 };
        const { from, to } = monthRange(month);
        const matched = rows
          .filter((r) => r.teamId === teamId && r.occurredAt >= from && r.occurredAt <= to)
          .filter((r) => kind === ExpenseKind.UNSPECIFIED || r.kind === kind)
          .filter((r) => filterType === 0 || typeOf(r)?.id === filterType)
          // occurred_at DESC, id DESC — an adjustment just above the expense it corrects, as the server orders.
          .sort((a, b) => (a.occurredAt === b.occurredAt ? (a.id > b.id ? -1 : 1) : a.occurredAt > b.occurredAt ? -1 : 1))
          .map((r) => wire(r, rows));

        return {
          expenses: matched.slice((page - 1) * pageSize, page * pageSize),
          month: matched,
          totalItems: matched.length,
        };
      },
      typeOf,
      fromAccountPage: (cost) => ownRow(cost)?.fromAccountPage === true,
      filterType,
      setFilterType,
      record: async (vars) => {
        const def = typeDef(vars.typeId);
        // The request validation the build adds (expense.proto): a type, an amount above 0, the account that paid or
        // received; the shop on the one type that names it, and on no other.
        if (!def) throw invalid("type: value must not be in list [0]");
        if (!(vars.amount > 0)) throw invalid("amount: value must be greater than 0");
        if (vars.financeAccountId === 0n) throw invalid("finance_account_id: value must be greater than 0");
        if (def.namesShop && vars.shopId === 0n) throw invalid("an ads expense names its shop");
        if (!def.namesShop && vars.shopId !== 0n) throw invalid("only an ads expense names a shop");

        const row: ExpenseTypeRow = {
          id: nextId,
          teamId: vars.teamId,
          shopId: vars.shopId,
          kind: def.group,
          amount: vars.amount,
          occurredAt: vars.occurredAt,
          note: vars.note,
          createdBy: initial.selfId,
          createdAtUnix: nowUnix(),
          adjustsExpenseId: 0n,
          financeAccountId: vars.financeAccountId,
          typeId: def.id,
        };
        setNextId(nextId + 1n);
        setRows((prev) => [...prev, row]);

        // PRIVE / SETORAN MODAL ARE THE ACCOUNT'S CAPITAL ROW — the build's listener posts it from the expense event; here
        // the account's own Capital call stands in for it (the Storybook stub plays it), and the row is remembered as
        // this expense's, so the account history says where it came from.
        if (def.capital) {
          const res = await financialAccountClient.financialAccountCapital({
            teamId: vars.teamId,
            accountId: vars.financeAccountId,
            direction: def.direction === "in" ? CapitalDirection.IN : CapitalDirection.OUT,
            amount: vars.amount,
            occurredOn: vars.occurredAt,
            note: vars.note,
          });
          if (res.log) setCapitalLogs((prev) => ({ ...prev, [res.log!.id.toString()]: row.id }));
        }

        return wire(row, [...rows, row]);
      },
      adjust: async (vars) => {
        if (vars.amount === 0) throw invalid("a correction of 0 corrects nothing");
        const expense = rows.find((r) => r.id === vars.expenseId && r.teamId === vars.teamId);
        if (!expense) throw new ConnectError("cost not found", Code.NotFound);
        if (expense.adjustsExpenseId !== 0n) {
          throw new ConnectError("an adjustment corrects an expense, never another adjustment", Code.FailedPrecondition);
        }
        if (netOf(expense, rows) + vars.amount < 0) {
          throw new ConnectError("the correction would take the expense below 0", Code.FailedPrecondition);
        }

        setNextId(nextId + 1n);
        setRows((prev) => [
          ...prev,
          {
            ...expense,
            id: nextId,
            amount: vars.amount,
            note: vars.note,
            createdBy: initial.selfId,
            createdAtUnix: nowUnix(),
            adjustsExpenseId: expense.id,
            fromAccountPage: false,
          },
        ]);
      },
      expenseOfLog: (logId) => capitalLogs[logId.toString()],
      capitalMade: (vars) => {
        const def = typeByKey(vars.inward ? "capitalDeposit" : "prive");
        const row: ExpenseTypeRow = {
          id: nextId,
          teamId: vars.teamId,
          shopId: 0n,
          kind: def.group,
          amount: vars.amount,
          occurredAt: vars.occurredOn,
          note: vars.note,
          createdBy: initial.selfId,
          createdAtUnix: nowUnix(),
          adjustsExpenseId: 0n,
          financeAccountId: vars.accountId,
          typeId: def.id,
          fromAccountPage: true,
        };
        setNextId(nextId + 1n);
        setRows((prev) => [...prev, row]);
      },
    };
  }, [rows, capitalLogs, filterType, nextId, wire, netOf, initial.selfId]);

  return <ExpenseTypesContext.Provider value={api}>{children}</ExpenseTypesContext.Provider>;
}
