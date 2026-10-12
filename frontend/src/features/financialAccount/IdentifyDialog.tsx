import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Input, SegmentGroup, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import { toaster } from "../../components/feedback/Toaster";
import { FinancialAccountSelect } from "../../components/pickers/FinancialAccountSelect";
import {
  type FinancialAccount,
  FinancialAccountProvider,
  FinancialAccountType,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import { formatRupiahNumber } from "../../lib/money";
import { FormDialog } from "./FormDialog";
import { ProviderPicker, TypeSegment } from "./fields";
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

      <SegmentGroup.Root
        value={mode}
        onValueChange={(e) => setMode((e.value as Mode | null) ?? mode)}
        aria-label={t("financialAccounts.identify.title")}
        data-testid="identify-mode"
      >
        <SegmentGroup.Indicator />
        <SegmentGroup.Item value="fill" data-testid="identify-fill">
          <SegmentGroup.ItemText>{t("financialAccounts.identify.fill")}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
        <SegmentGroup.Item value="move" data-testid="identify-move">
          <SegmentGroup.ItemText>{t("financialAccounts.identify.move")}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      </SegmentGroup.Root>

      {mode === "fill" ? (
        <>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.type")}</Field.Label>
            <TypeSegment value={type} onChange={setType} testId="identify-type" />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.provider")}</Field.Label>
            <ProviderPicker value={provider} onChange={setProvider} testId="identify-provider" />
          </Field.Root>
          {needsNumber && (
            <Field.Root required>
              <Field.Label>{t("financialAccounts.form.number")}</Field.Label>
              <Input
                value={accountNumber}
                inputMode="numeric"
                data-testid="identify-number"
                onChange={(e) => setAccountNumber(e.target.value.replace(/\s/g, ""))}
              />
            </Field.Root>
          )}
          <Field.Root>
            <Field.Label>{t("financialAccounts.form.holder")}</Field.Label>
            <Input value={holderName} data-testid="identify-holder" onChange={(e) => setHolderName(e.target.value)} />
          </Field.Root>
          <Field.Root required>
            <Field.Label>{t("financialAccounts.form.name")}</Field.Label>
            <Input value={name} placeholder="BCA TikTok" data-testid="identify-name" onChange={(e) => setName(e.target.value)} />
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
