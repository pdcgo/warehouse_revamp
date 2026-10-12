import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Textarea } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { DatePicker } from "../../components/datetime/DatePicker";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { RadioPills } from "../../components/inputs/RadioPills";
import { CapitalDirection, type FinancialAccount } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { toDateInputValue } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { FormDialog } from "./FormDialog";
import { useCapital } from "./queries";

// Setor / Tarik Modal — the business owner's own money, put in or taken out (capital-joins-the-types; the
// action's name, `capital-reads-setor-tarik-modal`).
//
// The person picks a DIRECTION and types a positive amount; the sign is the server's to apply. Nobody
// types a minus into a money field here.
export function CapitalDialog({
  teamId,
  account,
  open,
  onOpenChange,
}: {
  teamId: bigint;
  account: FinancialAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const today = toDateInputValue(new Date());
  const capital = useCapital();

  const [error, setError] = useState("");
  const [direction, setDirection] = useState(CapitalDirection.IN);
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");

  const value = amount === "" ? 0 : Number(amount);
  const canSave = value > 0 && occurredOn !== "";

  function submit() {
    setError("");
    capital.mutate(
      { teamId, accountId: account.id, direction, amount: value, occurredOn, note },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: t(direction === CapitalDirection.IN ? "financialAccounts.toast.capitalIn" : "financialAccounts.toast.capitalOut", {
              amount: formatRupiahNumber(value),
              name: account.name,
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
      title={t("financialAccounts.capital.title", { name: account.name })}
      error={error}
      busy={capital.isPending}
      canSave={canSave}
      testId="capital"
      onSubmit={submit}
    >
      <RadioPills
        value={String(direction)}
        onChange={(v) => setDirection(Number(v) as CapitalDirection)}
        ariaLabel={t("financialAccounts.capital.direction")}
        testId="capital-direction"
        options={[
          { value: String(CapitalDirection.IN), label: t("financialAccounts.capital.in"), testId: "capital-in" },
          { value: String(CapitalDirection.OUT), label: t("financialAccounts.capital.out"), testId: "capital-out" },
        ]}
      />

      <Field.Root required>
        <Field.Label>{t("financialAccounts.amount")}</Field.Label>
        <CurrencyInput value={amount} data-testid="capital-amount" onChange={setAmount} />
        <Field.HelperText>{t("financialAccounts.capital.help")}</Field.HelperText>
      </Field.Root>

      <Field.Root required>
        <Field.Label>{t("financialAccounts.movedOn")}</Field.Label>
        <DatePicker value={occurredOn} onChange={setOccurredOn} max={today} testId="capital-on" />
      </Field.Root>

      <Field.Root>
        <Field.Label>{t("financialAccounts.note")}</Field.Label>
        <Textarea
          value={note}
          rows={3}
          resize="vertical"
          placeholder={t("financialAccounts.capital.notePlaceholder")}
          data-testid="capital-note"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field.Root>
    </FormDialog>
  );
}
