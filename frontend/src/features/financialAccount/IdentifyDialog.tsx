import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Input, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { RadioPills } from "../../components/inputs/RadioPills";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import {
  type FinancialAccount,
  FinancialAccountProvider,
  FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { FormDialog } from "./FormDialog";
import { ProviderPicker, TypeSegment } from "./fields";
import { IDENTIFIABLE_TYPES, PROVIDERS_BY_TYPE, fixedProvider, providerFor } from "./vocab";
import { useIdentifyAccount } from "./queries";

type Mode = "fill" | "move";

// Which account is this? — the one way an `unknown` account becomes the real one
// (an-unknown-account-is-filled-in-or-moved-in).
//
//  - FILL IN — the real bank is not recorded yet: this account BECOMES it, same rows, each withdrawal still
//    on its own day. Type and provider are picked apart, as on New Account
//    (type-and-provider-are-picked-apart supersedes that decision's "type derived from the provider").
//  - MOVE IN — the real bank is recorded already: its balance transfers in, the shops re-point to it, and
//    this account is archived at zero — one act.
//
// Filling in a number that is already recorded is refused, and the refusal points at MOVE IN.
export function IdentifyDialog({
  teamId,
  account,
  balance,
  shopNames,
  open,
  onOpenChange,
}: {
  teamId: bigint;
  account: FinancialAccount;
  balance: number | undefined;
  /** The shops that withdraw into it — named in the move-in summary. */
  shopNames: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const identify = useIdentifyAccount();

  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("fill");
  const [type, setType] = useState(FinancialAccountType.BANK_ACCOUNT);
  const [provider, setProvider] = useState(FinancialAccountProvider.UNSPECIFIED);
  const [accountNumber, setAccountNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [name, setName] = useState("");
  const [into, setInto] = useState(0n);

  const needsNumber = type !== FinancialAccountType.CASH;
  const pickType = (next: FinancialAccountType) => {
    setType(next);
    setProvider(providerFor(next, provider));
  };
  const canSave =
    mode === "fill"
      ? name.trim() !== "" && provider !== FinancialAccountProvider.UNSPECIFIED && (!needsNumber || accountNumber.trim() !== "")
      : into > 0n;

  function submit() {
    setError("");
    identify.mutate(
      {
        teamId,
        accountId: account.id,
        target:
          mode === "fill"
            ? { case: "fillIn", value: { type, provider, accountNumber: needsNumber ? accountNumber : "", holderName, name } }
            : { case: "moveIntoAccountId", value: into },
      },
      {
        onSuccess: (res) => {
          toaster.create({
            type: "success",
            title: t(mode === "fill" ? "financialAccounts.toast.filledIn" : "financialAccounts.toast.movedIn", {
              name: res.account?.name ?? "",
            }),
          });
          onOpenChange(false);
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  const shops = shopNames.join(", ") || t("financialAccounts.identify.itsShop");

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("financialAccounts.identify.title")}
      error={error}
      busy={identify.isPending}
      canSave={canSave}
      testId="identify"
      onSubmit={submit}
    >
      <Text fontSize="sm" color="fg.muted">
        {t("financialAccounts.identify.intro", { shops, amount: balance === undefined ? "—" : formatRupiahNumber(balance) })}
      </Text>

      <RadioPills<Mode>
        value={mode}
        onChange={setMode}
        ariaLabel={t("financialAccounts.identify.title")}
        testId="identify-mode"
        options={[
          { value: "fill", label: t("financialAccounts.identify.fill"), testId: "identify-fill" },
          { value: "move", label: t("financialAccounts.identify.move"), testId: "identify-move" },
        ]}
      />
      {/* WHEN TO PICK WHICH (owner, `set-account-reads-lengkapi-data-or-pindah-saldo`) — the pills now say what each
          does, so the line under them says when: the old labels carried that, and it is the actual question. */}
      <Text fontSize="xs" color="fg.muted" mt="-2" data-testid="identify-when">
        {t(mode === "fill" ? "financialAccounts.identify.fillWhen" : "financialAccounts.identify.moveWhen")}
      </Text>

      {mode === "fill" ? (
        <>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.type")}</Field.Label>
            <TypeSegment value={type} onChange={pickType} types={IDENTIFIABLE_TYPES} testId="identify-type" />
          </Field.Root>
          {/* NO PROVIDER FIELD WHERE THE TYPE SETS IT (owner, `kas-and-lainnya-ask-no-provider`) — a cash box is Kas,
              type Lainnya is Lainnya, and a field with nothing to choose is only noise. A wallet keeps its picker. */}
          {fixedProvider(type) === undefined && (
            <Field.Root required>
              <Field.Label>{t("financialAccounts.form.provider")}</Field.Label>
              <ProviderPicker value={provider} onChange={setProvider} options={PROVIDERS_BY_TYPE[type] ?? []} testId="identify-provider" />
            </Field.Root>
          )}
          {needsNumber && (
            <Field.Root required>
              <Field.Label>{t("financialAccounts.form.number")}</Field.Label>
              <Input
                value={accountNumber}
                inputMode="numeric"
                placeholder={t("financialAccounts.form.numberPlaceholder")}
                data-testid="identify-number"
                onChange={(e) => setAccountNumber(e.target.value.replace(/\s/g, ""))}
              />
            </Field.Root>
          )}
          <Field.Root>
            <Field.Label>{t("financialAccounts.form.holder")}</Field.Label>
            <Input
              value={holderName}
              placeholder={t("financialAccounts.form.holderPlaceholder")}
              data-testid="identify-holder"
              onChange={(e) => setHolderName(e.target.value)}
            />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.name")}</Field.Label>
            <Input value={name} placeholder={t("financialAccounts.identify.namePlaceholder")} data-testid="identify-name" onChange={(e) => setName(e.target.value)} />
          </Field.Root>
          <Text fontSize="sm" color="fg.muted">
            {t("financialAccounts.identify.fillHelp")}
          </Text>
        </>
      ) : (
        <>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.identify.into")}</Field.Label>
            <FinancialAccountSelect teamId={teamId} value={into} onChange={setInto} excludeIds={[account.id]} testId="identify-into" />
          </Field.Root>
          <Text fontSize="sm" color="fg.muted" data-testid="identify-move-summary">
            {t("financialAccounts.identify.moveHelp", {
              amount: balance === undefined ? "—" : formatRupiahNumber(balance),
              shops,
            })}
          </Text>
        </>
      )}
    </FormDialog>
  );
}
