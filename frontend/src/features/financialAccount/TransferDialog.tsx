import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Text, Textarea } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { DatePicker } from "../../components/datetime/DatePicker";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import type { FinancialAccount } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { toDateInputValue } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { FormDialog } from "./FormDialog";
import { useTransfer } from "./queries";

// Transfer — money from one of the team's accounts to another: two rows, one act, a `transfer` out of
// this account and a `transfer` into the other (opening-transfer-and-team-payment-join-the-types).
//
// The day is the day the money MOVED (the-log-keeps-the-day-the-money-moved) — never in the future.
//
// ⚠ GOING BELOW ZERO IS ALLOWED, and the dialog says so before it happens rather than refusing
// (below-zero-is-warned-never-refused): the books follow the bank, and a top-up recorded late is real.
export function TransferDialog({
  teamId,
  from,
  balance,
  open,
  onOpenChange,
}: {
  teamId: bigint;
  from: FinancialAccount;
  /** The from-account's balance now — for the "after" line. Undefined while it loads. */
  balance: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const today = toDateInputValue(new Date());
  const transfer = useTransfer();

  const [error, setError] = useState("");
  const [to, setTo] = useState(0n);
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");

  const value = amount === "" ? 0 : Number(amount);
  const after = balance === undefined ? undefined : balance - value;
  const canSave = to > 0n && value > 0 && occurredOn !== "";

  function submit() {
    setError("");
    transfer.mutate(
      { teamId, fromAccountId: from.id, toAccountId: to, amount: value, occurredOn, note },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t("financialAccounts.toast.transferred", { amount: formatRupiahNumber(value), from: from.name }),
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
      title={t("financialAccounts.transfer.title", { name: from.name })}
      error={error}
      busy={transfer.isPending}
      canSave={canSave}
      saveLabel={t("financialAccounts.transfer.save")}
      testId="transfer"
      onSubmit={submit}
    >
      <Field.Root required>
        <Field.Label>{t("financialAccounts.transfer.to")}</Field.Label>
        <FinancialAccountSelect teamId={teamId} value={to} onChange={setTo} excludeIds={[from.id]} testId="transfer-to" />
      </Field.Root>

      <Field.Root required>
        <Field.Label>{t("financialAccounts.amount")}</Field.Label>
        <CurrencyInput value={amount} data-testid="transfer-amount" onChange={setAmount} />
        {after !== undefined && (
          <Field.HelperText data-testid="transfer-after">
            {t("financialAccounts.transfer.after", { name: from.name, amount: formatRupiahNumber(after) })}
          </Field.HelperText>
        )}
      </Field.Root>

      {after !== undefined && after < 0 && value > 0 && (
        <Text fontSize="sm" color="fg.warning" data-testid="transfer-below-zero">
          {t("financialAccounts.transfer.belowZero", { name: from.name })}
        </Text>
      )}

      <Field.Root required>
        <Field.Label>{t("financialAccounts.movedOn")}</Field.Label>
        <DatePicker value={occurredOn} onChange={setOccurredOn} max={today} testId="transfer-on" />
      </Field.Root>

      <Field.Root>
        <Field.Label>{t("financialAccounts.note")}</Field.Label>
        <Textarea
          value={note}
          rows={3}
          resize="vertical"
          placeholder={t("financialAccounts.transfer.notePlaceholder")}
          data-testid="transfer-note"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field.Root>
    </FormDialog>
  );
}
