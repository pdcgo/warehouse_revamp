import type { TFunction } from "i18next";

import { ExpenseKind, ExpenseType } from "../../gen/warehouse/expense/v1/expense_pb";
import { expenseKindLabel } from "../../components/pickers/ExpenseKindSelect";

// THE EXPENSE TYPES ON THE SCREEN — backlog #99, accepted as drawn (the-expense-types-prototype-is-accepted,
// expense-types-sit-under-groups, prive-and-deposit-on-pengeluaran-are-the-accounts-capital,
// money-in-on-biaya-is-its-own-change-type; docs/business/financial_account/context_decision.md). The server's fixed
// table is expense_service's `expense_v1/expense_types.go`; this is the same table, for the picker, the marks and the
// account field — the figures themselves always come from the server (ExpenseList.totals), never summed here.
//
// THE AMOUNT STAYS POSITIVE; THE TYPE SAYS THE DIRECTION. Piutang luar diterima, Setoran modal and Uang masuk lain bring
// money IN (the account increases, the type's, the group's and the month's total decrease); Prive and Setoran modal are
// the account's CAPITAL row, never an expense in the profit.

export type ExpenseDirection = "out" | "in";

export interface ExpenseTypeDef {
  /** The `ExpenseType` enum value (expense.proto). */
  id: ExpenseType;
  /** Its words: `expenses.types.type.<key>`; also its test ids. */
  key: string;
  /** The group it sits under — the ExpenseKind (expense-types-sit-under-groups). */
  group: ExpenseKind;
  /** Which way the money goes; the amount itself stays positive. */
  direction: ExpenseDirection;
  /** Prive / Setoran modal — the account's capital row. */
  capital?: boolean;
  /** The one type that names its shop, and must (an-expense-names-a-shop-only-for-ads, read per type). */
  namesShop?: boolean;
}

/** The groups, in the picker's and the card's order. */
export const TYPE_GROUPS: readonly ExpenseKind[] = [
  ExpenseKind.ADS,
  ExpenseKind.PAYROLL,
  ExpenseKind.OPERATIONAL,
  ExpenseKind.OTHER,
];

/** Every type, under its group, in the picker's order — the accepted table. */
export const EXPENSE_TYPES: readonly ExpenseTypeDef[] = [
  { id: ExpenseType.ADS_MARKETPLACE, key: "adsMarketplace", group: ExpenseKind.ADS, direction: "out", namesShop: true },
  { id: ExpenseType.CONTENT_ENDORSE, key: "contentEndorse", group: ExpenseKind.ADS, direction: "out" },
  { id: ExpenseType.BASIC_SALARY, key: "basicSalary", group: ExpenseKind.PAYROLL, direction: "out" },
  { id: ExpenseType.BONUS, key: "bonus", group: ExpenseKind.PAYROLL, direction: "out" },
  { id: ExpenseType.CONTRIBUTIONS, key: "contributions", group: ExpenseKind.PAYROLL, direction: "out" },
  { id: ExpenseType.ELECTRICITY, key: "electricity", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.INTERNET, key: "internet", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.KITCHEN, key: "kitchen", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.TOOLS, key: "tools", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.EQUIPMENT, key: "equipment", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.BANK_FEE, key: "bankFee", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.DISCREPANCY, key: "discrepancy", group: ExpenseKind.OPERATIONAL, direction: "out" },
  { id: ExpenseType.OUTSIDE_DEBT_PAID, key: "outsideDebtPaid", group: ExpenseKind.OTHER, direction: "out" },
  { id: ExpenseType.OUTSIDE_RECEIVABLE_RECEIVED, key: "outsideReceivableReceived", group: ExpenseKind.OTHER, direction: "in" },
  { id: ExpenseType.PRIVE, key: "prive", group: ExpenseKind.OTHER, direction: "out", capital: true },
  { id: ExpenseType.CAPITAL_DEPOSIT, key: "capitalDeposit", group: ExpenseKind.OTHER, direction: "in", capital: true },
  { id: ExpenseType.OTHER_OUT, key: "otherOut", group: ExpenseKind.OTHER, direction: "out" },
  { id: ExpenseType.OTHER_IN, key: "otherIn", group: ExpenseKind.OTHER, direction: "in" },
];

/** A type's facts; undefined on UNSPECIFIED — a row recorded before the types (its group only), or a stock loss. */
export const typeDef = (id: ExpenseType | number | undefined): ExpenseTypeDef | undefined =>
  EXPENSE_TYPES.find((d) => d.id === id);

/** A type by its key — the URL's `?type=` and the test ids. */
export const typeByKey = (key: string): ExpenseTypeDef | undefined => EXPENSE_TYPES.find((d) => d.key === key);

/** The type's own words — "Listrik". */
export const typeLabel = (t: TFunction, def: ExpenseTypeDef): string => t(`expenses.types.type.${def.key}`);

/** Group › type — "Operasional › Listrik"; a row recorded before the types reads its group alone. */
export function fullTypeLabel(t: TFunction, group: ExpenseKind, def: ExpenseTypeDef | undefined): string {
  return def ? `${expenseKindLabel(t, group)} › ${typeLabel(t, def)}` : expenseKindLabel(t, group);
}

/** The account field's label for a type — *Dibayar dari* (today's), *Diambil dari* on Prive, *Masuk ke* on money in. */
export function accountLabelKey(id: ExpenseType): string {
  const def = typeDef(id);
  if (def?.direction === "in") return "expenses.types.receivedInto";
  if (def?.capital) return "expenses.types.takenFrom";

  return "expenses.paidFrom";
}

/** The account field's helper — capital may come from any of the team's accounts, as Setor / Tarik Modal does. */
export function accountHelpKey(id: ExpenseType): string {
  const def = typeDef(id);
  if (def?.capital) return "expenses.types.capitalAccountHelp";
  if (def?.direction === "in") return "expenses.types.receivedIntoHelp";

  return "expenses.paidFromHelp";
}

/** Prive / Setoran pick among ALL the team's active accounts; every other type among the operational ones. */
export const operationalOnlyFor = (id: ExpenseType): boolean => !typeDef(id)?.capital;
