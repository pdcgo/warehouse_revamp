import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Input, SegmentGroup } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { DatePicker } from "../../components/datetime/DatePicker";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { CapitalDirection, type FinancialAccount } from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { toDateInputValue } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { FormDialog } from "./FormDialog";
import { useCapital } from "./queries";

// Capital — the business owner's own money, put in or taken out (capital-joins-the-types).
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
      <SegmentGroup.Root
        value={String(direction)}
        onValueChange={(e) => setDirection(e.value ? (Number(e.value) as CapitalDirection) : direction)}
        aria-label={t("financialAccounts.capital.direction")}
        data-testid="capital-direction"
      >
        <SegmentGroup.Indicator />
        <SegmentGroup.Item value={String(CapitalDirection.IN)} data-testid="capital-in">
          <SegmentGroup.ItemText>{t("financialAccounts.capital.in")}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
        <SegmentGroup.Item value={String(CapitalDirection.OUT)} data-testid="capital-out">
          <SegmentGroup.ItemText>{t("financialAccounts.capital.out")}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      </SegmentGroup.Root>

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
        <Input value={note} data-testid="capital-note" onChange={(e) => setNote(e.target.value)} />
      </Field.Root>
    </FormDialog>
  );
}
