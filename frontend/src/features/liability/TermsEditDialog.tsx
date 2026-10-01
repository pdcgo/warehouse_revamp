import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  NativeSelect,
  Portal,
  RadioGroup,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";

import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { rpcError } from "../../api/clients";
import { useSetTerms } from "./queries";
import type { LiabilityTerms } from "../../gen/warehouse/liability/v1/liability_pb";
import { limitStateOf, type LimitState } from "./CreditMeter";

export interface CounterpartyOption {
  id: bigint;
  name: string;
}

interface TermsEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: bigint;
  /** Editing an existing row; absent when setting terms for a counterparty that has none. */
  editing?: LiabilityTerms;
  /** Only used when adding — the teams this creditor trades with that have no terms yet. */
  options: CounterpartyOption[];
  /**
   * PIN the counterparty and hide the picker.
   *
   * ⚠ THIS IS WHAT GIVES THE DEFAULT ROW A HOME (the-default-terms-row-is-a-dialog-on-the-list).
   * `counterparty_id = 0` is terms for every team without their own, and it is NOT A PAIR — so it can
   * never appear on `/liability/:counterpartyId`. The list opens this dialog with `0n` pinned.
   *
   * Without it a first-time default would fall back to `options[0]`, i.e. an actual team, and
   * somebody setting "the house rate" would quietly set one counterparty's instead.
   */
  fixedCounterpartyId?: bigint;
  /**
   * TRUE when the caller is ROOT or ADMIN — writing somebody else's terms.
   *
   * ⚠ This is what makes the reason REQUIRED, per
   * docs/business/balance/context_decision.md#a-limit-change-is-recorded: a creditor setting its own
   * terms owes nobody an explanation, somebody else changing them does. The server decides this for
   * real — the flag here only shapes the form, because a UI that let an override through with no
   * reason would be showing a field the write is going to reject.
   */
  overrideWriter: boolean;
}

// TermsEditDialog sets one pair's terms (#189).
//
// ⚠ THE LIMIT IS A THREE-WAY CHOICE, NOT A NUMBER FIELD, and that is the entire point of this
// dialog. `unlimited`, `frozen` and a ceiling are three different acts, and a single money input
// cannot express the first: a blank field would coerce to 0, which means the OPPOSITE of what the
// person leaving it blank intended. So the choice is explicit and the amount only appears once a
// ceiling is chosen.
export function TermsEditDialog({
  open,
  onOpenChange,
  teamId,
  editing,
  options,
  fixedCounterpartyId,
  overrideWriter,
}: TermsEditDialogProps) {
  const { t } = useTranslation();
  const setTerms = useSetTerms();

  const isEdit = !!editing;
  // The counterparty is shown rather than chosen when we are editing an existing row OR when the
  // caller has pinned one. Both mean the same thing to the form: there is nothing to pick.
  const pinned = fixedCounterpartyId !== undefined;

  const [counterpartyId, setCounterpartyId] = useState<string>("0");
  const [limitMode, setLimitMode] = useState<LimitState>("unlimited");
  const [limit, setLimit] = useState("");
  const [handlingFee, setHandlingFee] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset from the row every time the dialog opens, so a cancelled edit never leaks into the next
  // one. Keyed on `open` as well as the row: reopening the SAME row after a cancel must also reset.
  useEffect(() => {
    if (!open) return;

    setError(null);
    setReason("");

    if (editing) {
      setCounterpartyId(editing.counterpartyId.toString());
      setLimitMode(limitStateOf(editing.creditLimit));
      setLimit(editing.creditLimit && editing.creditLimit > 0n ? editing.creditLimit.toString() : "");
      setHandlingFee(editing.handlingFee > 0n ? editing.handlingFee.toString() : "");
      return;
    }

    setCounterpartyId(fixedCounterpartyId?.toString() ?? options[0]?.id.toString() ?? "0");
    setLimitMode("unlimited");
    setLimit("");
    setHandlingFee("");
  }, [open, editing, options, fixedCounterpartyId]);

  const busy = setTerms.isPending;
  const needsReason = overrideWriter;
  const ready =
    (!needsReason || reason.trim().length > 0) && (limitMode !== "capped" || limit.trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // The three states, mapped to the wire exactly once. `undefined` is UNLIMITED and `0n` is
    // FROZEN — never let a blank input decide which.
    const creditLimit =
      limitMode === "unlimited" ? undefined : limitMode === "frozen" ? 0n : BigInt(limit || "0");

    try {
      await setTerms.mutateAsync({
        teamId,
        counterpartyId: BigInt(counterpartyId),
        handlingFee: BigInt(handlingFee || "0"),
        // ⚠ PASSED THROUGH UNCHANGED, NEVER 0 — and this is not tidiness, it is what stops this dialog
        // silently wiping a fee. The cross-product markup is `product_service`'s (owner), so it is no
        // longer EDITED here; but `LiabilityTermsSet` is an upsert that writes
        // `product_markup_bp = EXCLUDED.product_markup_bp` unconditionally, and `order_fees.go` still
        // charges the cross fee from that column. Sending 0 because the field left the form would
        // zero the markup on every unrelated limit edit.
        //
        // ⚠ DELETE THIS LINE ONLY WHEN THE COLUMN GOES. It is a bridge, and it is load-bearing until
        // the charge is moved to the product's own `cross_markup_bps`.
        productMarkupBp: editing?.productMarkupBp ?? 0n,
        creditLimit,
        reason: reason.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      setError(rpcError(err));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                {/* Title Case, per the dialog rule in CLAUDE.md. */}
                <Dialog.Title>{isEdit ? t("terms.editTitle") : t("terms.setTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Field.Root required>
                    <Field.Label>{t("terms.counterparty")}</Field.Label>
                    {isEdit || pinned ? (
                      <Text data-testid="terms-counterparty-fixed">
                        {BigInt(counterpartyId) === 0n
                          ? t("terms.defaultRow")
                          : t("terms.teamFallback", { id: counterpartyId })}
                      </Text>
                    ) : (
                      <NativeSelect.Root>
                        <NativeSelect.Field
                          value={counterpartyId}
                          data-testid="terms-counterparty"
                          onChange={(e) => setCounterpartyId(e.target.value)}
                        >
                          {/* 0 is a REAL option, not a placeholder — the house rate every team
                              without its own row falls back to. */}
                          <option value="0">{t("terms.defaultRow")}</option>
                          {options.map((o) => (
                            <option key={o.id.toString()} value={o.id.toString()}>
                              {o.name}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    )}
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("terms.creditLimit")}</Field.Label>
                    <RadioGroup.Root
                      value={limitMode}
                      onValueChange={(e) => setLimitMode((e.value ?? "unlimited") as LimitState)}
                    >
                      <Stack gap="2">
                        <RadioGroup.Item value="unlimited" data-testid="terms-limit-unlimited">
                          <RadioGroup.ItemHiddenInput />
                          <RadioGroup.ItemIndicator />
                          <RadioGroup.ItemText>{t("terms.limitUnlimited")}</RadioGroup.ItemText>
                        </RadioGroup.Item>
                        <RadioGroup.Item value="capped" data-testid="terms-limit-capped">
                          <RadioGroup.ItemHiddenInput />
                          <RadioGroup.ItemIndicator />
                          <RadioGroup.ItemText>{t("terms.limitCapped")}</RadioGroup.ItemText>
                        </RadioGroup.Item>
                        <RadioGroup.Item value="frozen" data-testid="terms-limit-frozen">
                          <RadioGroup.ItemHiddenInput />
                          <RadioGroup.ItemIndicator />
                          <RadioGroup.ItemText>{t("terms.limitFrozen")}</RadioGroup.ItemText>
                        </RadioGroup.Item>
                      </Stack>
                    </RadioGroup.Root>

                    {limitMode === "capped" && (
                      <CurrencyInput
                        value={limit}
                        onChange={setLimit}
                        disabled={busy}
                        placeholder="0"
                        data-testid="terms-limit-amount"
                      />
                    )}

                    <Field.HelperText>{t("terms.limitHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("terms.handlingFee")}</Field.Label>
                    <CurrencyInput
                      value={handlingFee}
                      onChange={setHandlingFee}
                      disabled={busy}
                      placeholder="0"
                      data-testid="terms-handling-fee"
                    />
                    {/* Nothing configured means CHARGE NOTHING — a warehouse that has set no rate is
                        not silently billing anybody. */}
                    <Field.HelperText>{t("terms.handlingFeeHelp")}</Field.HelperText>
                  </Field.Root>

                  {/* ⛔ THE CROSS-PRODUCT MARKUP IS GONE FROM THIS FORM (owner): it is a property of
                      the PRODUCT, not of a credit relationship, and `products.cross_markup_bps`
                      already exists in product_service. Setting it here made a rate that varies
                      per product look like one rate per counterparty. */}

                  <Field.Root required={needsReason}>
                    <Field.Label>{t("terms.reason")}</Field.Label>
                    <Textarea
                      value={reason}
                      disabled={busy}
                      data-testid="terms-reason"
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Field.HelperText>
                      {needsReason ? t("terms.reasonRequired") : t("terms.reasonOptional")}
                    </Field.HelperText>
                  </Field.Root>

                  {error && (
                    <Dialog.Description color="red.fg" data-testid="terms-form-error">
                      {error}
                    </Dialog.Description>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!ready}
                  data-testid="terms-submit"
                >
                  {t("terms.save")}
                </Button>
              </Dialog.Footer>
            </form>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
