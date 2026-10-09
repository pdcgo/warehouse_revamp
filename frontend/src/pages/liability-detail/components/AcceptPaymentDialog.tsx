import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Flex, Portal, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../../api/clients";
import { formatRupiah } from "../../../lib/money";
import { useConfirmPayment } from "../../../features/liability/queries";
import { FinancialAccountSelect } from "../../../components/pickers/FinancialAccountSelect";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import type { LiabilityPayment } from "../../../gen/warehouse/liability/v1/liability_pb";
import { LIABILITY_DETAIL_PENDING } from "../pending";

interface AcceptPaymentDialogProps {
  /** The payment being accepted, or null when the dialog is closed. */
  target: LiabilityPayment | null;
  onClose: () => void;
  /** The CREDITOR — only the team that was paid may say the money arrived, and where. */
  teamId: bigint;
}

// AcceptPaymentDialog is the `yes` arm of `balance_context.md` §Payment Flow — *"Is Payment Correct?
// → yes → Team B Accept Payment"* — and it is where the money LANDS.
//
// ⚠ IT ASKS WHICH ACCOUNT, and that is why it replaced a `ConfirmDialog`. Accepting is the one act
// the financial accounts hear (a-team-payment-posts-on-accept): the payer's account goes down and
// the creditor's goes up, in one go. The payer named their half when recording; this is the other
// half, and only the creditor can name it — they are the one who looked at their bank and saw it.
//
// ⚠ AND IT IS FINAL (an-accepted-payment-is-final). Nothing reverses an accept, so the account is
// required rather than defaulted: a wrong one stays wrong until a reconcile finds the gap.
//
// ⛔ The account is DROPPED today — `LiabilityPaymentConfirmRequest` has no `to_account_id`. The mark
// on the field says so; see `../pending.ts`.
export function AcceptPaymentDialog({ target, onClose, teamId }: AcceptPaymentDialogProps) {
  const { t } = useTranslation();
  const confirm = useConfirmPayment();

  const [toAccountId, setToAccountId] = useState(0n);
  const [error, setError] = useState("");

  // A fresh dialog per payment. Carrying the previous account over would land one transfer in the
  // account somebody picked for another.
  useEffect(() => {
    if (target) {
      setToAccountId(0n);
      setError("");
    }
  }, [target]);

  const busy = confirm.isPending;
  const ready = toAccountId > 0n;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !target) return;
    setError("");

    confirm.mutate(
      // ⛔ `toAccountId` is not sent — the request has no field for it yet (pending: toAccount).
      { teamId, paymentId: target.id },
      {
        onSuccess: onClose,
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root
      open={target !== null}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      placement="center"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("liabilityDetail.confirmTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Text color="fg.muted" fontSize="sm">
                    {t("liabilityDetail.confirmMessage", {
                      amount: target ? formatRupiah(target.amount) : "",
                    })}
                  </Text>

                  <Field.Root required invalid={error !== ""}>
                    <Field.Label>
                      <Flex align="center" gap="2" wrap="wrap">
                        {t("liabilityDetail.confirmToAccount")}
                        <NotImplemented list={LIABILITY_DETAIL_PENDING} id="toAccount" />
                      </Flex>
                    </Field.Label>
                    <FinancialAccountSelect
                      teamId={teamId}
                      value={toAccountId}
                      onChange={setToAccountId}
                      autoPickSingle
                      disabled={busy}
                      placeholder={t("liabilityDetail.confirmToAccountPlaceholder")}
                      testId="liability-detail-confirm-account"
                    />
                    <Field.HelperText>{t("liabilityDetail.confirmToAccountHelp")}</Field.HelperText>
                    {error !== "" && <Field.ErrorText>{error}</Field.ErrorText>}
                  </Field.Root>
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
                  colorPalette="success"
                  loading={busy}
                  disabled={!ready}
                  data-testid="liability-detail-confirm-submit"
                >
                  {t("liabilityDetail.confirmLabel")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" disabled={busy} />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
