import { useTranslation } from "react-i18next";
import { Table, Text } from "@chakra-ui/react";

import type { Metric } from "../../../features/financialAccount/analytics";
import { CHANGE_TYPES, CHANGE_TYPE_KEY } from "../../../features/financialAccount/vocab";
import { FinancialAccountChangeType as T } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahBare, formatRupiahNumber } from "../../../lib/money";

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

// `bare` drops the "Rp" — for a table that says the currency once (`the-rincian-says-rp-once`).
export function signed(amount: number, bare = false): string {
  const format = bare ? formatRupiahBare : formatRupiahNumber;
  if (amount === 0) return format(0);

  return `${amount > 0 ? "+" : "−"}${format(Math.abs(amount))}`;
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
