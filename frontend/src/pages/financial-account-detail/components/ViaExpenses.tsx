import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box } from "@chakra-ui/react";

import {
  FinancialAccountChangeType,
  type FinancialAccountLog,
} from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { ActorName } from "../../../components/entity/ActorName";

/**
 * THE ACCOUNT HISTORY'S *WHICH WAY IN* for a capital row typed on Biaya (the-expense-types-prototype-is-accepted,
 * prive-and-deposit-on-pengeluaran-are-the-accounts-capital): still *Modal*, its way *dari Biaya #N · who typed it* — the
 * expense the row was posted from (`FinancialAccountLog.expense_id`). Every other row — a Setor / Tarik Modal made on
 * this page, an expense, money in — keeps today's words (`children`).
 */
export function ViaExpenses({
  log,
  actorName,
  testId,
  children,
}: {
  log: FinancialAccountLog;
  actorName: (id: bigint) => string;
  testId?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (log.changeType !== FinancialAccountChangeType.CAPITAL || log.expenseId === 0n) return <>{children}</>;

  return (
    <Box as="span" data-testid={testId ?? `account-log-via-expenses-${log.id}`}>
      <ActorName
        name={t("expenses.types.viaExpenses", { id: log.expenseId.toString(), name: actorName(log.actorId) })}
        isOverride={log.isOverride}
        size="xs"
      />
    </Box>
  );
}
