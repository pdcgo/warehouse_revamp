import { useTranslation } from "react-i18next";
import { Table, Text } from "@chakra-ui/react";

import type { Metric } from "../../../features/financialAccount/analytics";
import { CHANGE_TYPES, CHANGE_TYPE_KEY } from "../../../features/financialAccount/vocab";
import { FinancialAccountChangeType as T } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../../lib/money";

// The nine change-type columns of `financial_account_daily_reports`, in the vocabulary's order — shared by
// the series and the ranking so the two tables read identically.
export const FIELD_OF: Record<number, keyof Metric> = {
  [T.WITHDRAWAL]: "withdrawal",
  [T.CAPITAL]: "capital",
  [T.RESTOCK]: "restock",
  [T.EXPENSE]: "expense",
  [T.ADS_EXPENSE]: "adsExpense",
  [T.TEAM_PAYMENT]: "teamPayment",
  [T.TRANSFER]: "transfer",
  [T.ADJUSTMENT]: "adjustment",
  [T.OPENING_BALANCE]: "openingBalance",
};

export function signed(amount: number): string {
  if (amount === 0) return formatRupiahNumber(0);

  return `${amount > 0 ? "+" : "−"}${formatRupiahNumber(Math.abs(amount))}`;
}

export function TypeHeaders() {
  const { t } = useTranslation();

  return (
    <>
      {CHANGE_TYPES.map((c) => (
        <Table.ColumnHeader key={c} textAlign="end" whiteSpace="nowrap">
          {t(CHANGE_TYPE_KEY[c]!)}
        </Table.ColumnHeader>
      ))}
    </>
  );
}

export function TypeCells({ metric }: { metric: Metric }) {
  return (
    <>
      {CHANGE_TYPES.map((c) => {
        const v = metric[FIELD_OF[c]!];

        return (
          <Table.Cell key={c} textAlign="end" whiteSpace="nowrap">
            <Text fontSize="sm" color={v === 0 ? "fg.muted" : undefined}>
              {v === 0 ? "—" : signed(v)}
            </Text>
          </Table.Cell>
        );
      })}
    </>
  );
}
