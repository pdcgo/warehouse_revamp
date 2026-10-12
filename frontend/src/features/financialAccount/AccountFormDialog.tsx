import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Input, Text, Textarea } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { DatePicker } from "../../components/datetime/DatePicker";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import {
  type FinancialAccount,
  FinancialAccountProvider,
  FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { toDateInputValue } from "../../lib/datetime";
import { FormDialog } from "./FormDialog";
import { ProviderPicker, TypeSegment } from "./fields";
import { useCreateAccount, useUpdateAccount } from "./queries";
import { PROVIDER_KEY, TYPE_KEY } from "./vocab";

// New Account, or Edit — docs/business/financial_account/context_decision.md.
//
//  - create — type and provider picked APART (type-and-provider-are-picked-apart), the number, the holder
//    (an-account-has-a-name-and-a-holder), and an opening balance posted as the first row, even at 0
//    (an-account-opens-with-a-log-row). A number already recorded in ANY team is refused by the server
//    (a-real-account-is-recorded-once) — the dialog shows its answer as-is.
//  - edit — name, holder and description. Provider and number are SHOWN, never sent: another number is
//    another account.
export function AccountFormDialog({
  teamId,
  account,
  open,
  onOpenChange,
}: {
  teamId: bigint;
  account?: FinancialAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const editing = account !== undefined;
  const today = toDateInputValue(new Date());

  const create = useCreateAccount();
  const update = useUpdateAccount();

  const [error, setError] = useState("");
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState(account?.type ?? FinancialAccountType.BANK_ACCOUNT);
  const [provider, setProvider] = useState(account?.provider ?? FinancialAccountProvider.UNSPECIFIED);
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber ?? "");
  const [holderName, setHolderName] = useState(account?.holderName ?? "");
  const [description, setDescription] = useState(account?.description ?? "");
  const [opening, setOpening] = useState("0");
  const [openingOn, setOpeningOn] = useState(today);

  // A cash box has no number — every other account does.
  const needsNumber = type !== FinancialAccountType.CASH;
  const canSave = editing
    ? name.trim() !== ""
    : name.trim() !== "" &&
      provider !== FinancialAccountProvider.UNSPECIFIED &&
      (!needsNumber || accountNumber.trim() !== "") &&
      opening !== "" &&
      openingOn !== "";

  function close() {
    setError("");
    onOpenChange(false);
  }

  function submit() {
    setError("");
    const onError = (err: unknown) => setError(rpcError(err));

    if (account) {
      update.mutate(
        { teamId, accountId: account.id, name, holderName, description },
        {
          onSuccess: () => {
            toaster.create({ type: "success", title: t("financialAccounts.toast.updated", { name }) });
            close();
          },
          onError,
        },
      );
      return;
    }

    create.mutate(
      {
        teamId,
        type,
        provider,
        name,
        holderName,
        accountNumber: needsNumber ? accountNumber : "",
        description,
        openingBalance: Number(opening),
        openingOn,
      },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("financialAccounts.toast.created", { name }) });
          close();
        },
        onError,
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title={editing ? t("financialAccounts.form.editTitle", { name: account.name }) : t("financialAccounts.form.newTitle")}
      error={error}
      busy={create.isPending || update.isPending}
      canSave={canSave}
      testId="account-form"
      onSubmit={submit}
    >
      <Field.Root required>
        <Field.Label>{t("financialAccounts.form.name")}</Field.Label>
        <Input value={name} placeholder="BCA Operasional" data-testid="account-name" onChange={(e) => setName(e.target.value)} />
        <Field.HelperText>{t("financialAccounts.form.nameHelp")}</Field.HelperText>
      </Field.Root>

      {editing ? (
        // Fixed on an existing account — shown so the person editing knows WHICH account they are in.
        <Text fontSize="sm" color="fg.muted" data-testid="account-fixed-identity">
          {t(TYPE_KEY[account.type]!)} · {t(PROVIDER_KEY[account.provider]!)}
          {account.accountNumber ? ` · ${account.accountNumber}` : ""} — {t("financialAccounts.form.fixedHelp")}
        </Text>
      ) : (
        <>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.type")}</Field.Label>
            <TypeSegment value={type} onChange={setType} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.provider")}</Field.Label>
            <ProviderPicker value={provider} onChange={setProvider} />
          </Field.Root>

          {needsNumber && (
            <Field.Root required>
              <Field.Label>{t("financialAccounts.form.number")}</Field.Label>
              <Input
                value={accountNumber}
                inputMode="numeric"
                data-testid="account-number"
                onChange={(e) => setAccountNumber(e.target.value.replace(/\s/g, ""))}
              />
              <Field.HelperText>{t("financialAccounts.form.numberHelp")}</Field.HelperText>
            </Field.Root>
          )}
        </>
      )}

      <Field.Root>
        <Field.Label>{t("financialAccounts.form.holder")}</Field.Label>
        <Input value={holderName} data-testid="account-holder" onChange={(e) => setHolderName(e.target.value)} />
        <Field.HelperText>{t("financialAccounts.form.holderHelp")}</Field.HelperText>
      </Field.Root>

      <Field.Root>
        <Field.Label>{t("financialAccounts.form.description")}</Field.Label>
        <Textarea value={description} data-testid="account-description" onChange={(e) => setDescription(e.target.value)} />
      </Field.Root>

      {!editing && (
        <>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.opening")}</Field.Label>
            <CurrencyInput value={opening} data-testid="account-opening" onChange={setOpening} />
            <Field.HelperText>{t("financialAccounts.form.openingHelp")}</Field.HelperText>
          </Field.Root>

          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.openingOn")}</Field.Label>
            <DatePicker value={openingOn} onChange={setOpeningOn} max={today} testId="account-opening-on" />
          </Field.Root>
        </>
      )}
    </FormDialog>
  );
}
