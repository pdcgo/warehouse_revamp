import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Field, Input, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { DatePicker } from "../../components/datetime/DatePicker";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { type FinancialAccount, FinancialAccountType } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { toDateInputValue } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { FormDialog } from "./FormDialog";
import { useReconcile } from "./queries";

// Reconcile — the manager types what the bank app SHOWS (or what the cash box COUNTS), and the
// difference posts as an `adjustment` (adjustment-is-for-reconciling-only). Nobody types an adjustment's
// amount or its sign: the screen works it out, live, as the figure is typed.
//
// A non-zero difference needs a note — it is the one row that can hide missing cash (my spec). A zero
// difference posts nothing and still marks the account checked.
export function ReconcileDialog({
  teamId,
  account,
  balance,
  open,
  onOpenChange,
}: {
  teamId: bigint;
  account: FinancialAccount;
  /** The books' balance now. Undefined while it loads — Save waits for it. */
  balance: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const today = toDateInputValue(new Date());
  const reconcile = useReconcile();

  const isCash = account.type === FinancialAccountType.CASH;

  const [error, setError] = useState("");
  const [actual, setActual] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [note, setNote] = useState("");

  const typed = actual !== "";
  const difference = typed && balance !== undefined ? Number(actual) - balance : 0;
  const needsNote = typed && difference !== 0;
  const canSave = typed && balance !== undefined && asOf !== "" && (!needsNote || note.trim() !== "");

  function submit() {
    setError("");
    reconcile.mutate(
      { teamId, accountId: account.id, actualBalance: Number(actual), asOf, note },
      {
        onSuccess: (res) => {
          toaster.create({
            type: "success",
            title:
              res.difference === 0
                ? t("financialAccounts.toast.reconciledAgree", { name: account.name })
                : t("financialAccounts.toast.reconciledAdjusted", {
                    name: account.name,
                    amount: formatRupiahNumber(res.difference),
                  }),
          });
          onOpenChange(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("financialAccounts.reconcile.title", { name: account.name })}
      error={error}
      busy={reconcile.isPending}
      canSave={canSave}
      saveLabel={t("financialAccounts.reconcile.save")}
      testId="reconcile"
      onSubmit={submit}
    >
      <Box>
        <Text fontSize="xs" color="fg.muted">
          {t("financialAccounts.reconcile.books")}
        </Text>
        <Text fontWeight="semibold" data-testid="reconcile-books">
          {balance === undefined ? "—" : formatRupiahNumber(balance)}
        </Text>
      </Box>

      <Field.Root required>
        <Field.Label>{isCash ? t("financialAccounts.reconcile.counted") : t("financialAccounts.reconcile.shows")}</Field.Label>
        <CurrencyInput value={actual} data-testid="reconcile-actual" onChange={setActual} />
      </Field.Root>

      {typed && balance !== undefined && (
        <Text
          fontSize="sm"
          color={difference === 0 ? "fg.success" : "fg.warning"}
          data-testid="reconcile-difference"
        >
          {difference === 0
            ? t("financialAccounts.reconcile.agree")
            : t("financialAccounts.reconcile.differs", {
                amount: `${difference > 0 ? "+" : "−"}${formatRupiahNumber(Math.abs(difference))}`,
              })}
        </Text>
      )}

      <Field.Root required>
        <Field.Label>{t("financialAccounts.reconcile.asOf")}</Field.Label>
        <DatePicker value={asOf} onChange={setAsOf} max={today} testId="reconcile-as-of" />
      </Field.Root>

      <Field.Root required={needsNote}>
        <Field.Label>{t("financialAccounts.reconcile.why")}</Field.Label>
        <Input
          value={note}
          placeholder={t("financialAccounts.reconcile.whyPlaceholder")}
          data-testid="reconcile-note"
          onChange={(e) => setNote(e.target.value)}
        />
        <Field.HelperText>{t("financialAccounts.reconcile.whyHelp")}</Field.HelperText>
      </Field.Root>
    </FormDialog>
  );
}
