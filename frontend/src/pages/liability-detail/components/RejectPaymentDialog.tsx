import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Portal, Stack, Text, Textarea } from "@chakra-ui/react";

import { rpcError } from "../../../api/clients";
import { formatRupiah } from "../../../lib/money";
import { useRejectPayment } from "../../../features/liability/queries";
import type { LiabilityPayment } from "../../../gen/warehouse/liability/v1/liability_pb";

interface RejectPaymentDialogProps {
  /** The payment being refused, or null when the dialog is closed. */
  target: LiabilityPayment | null;
  onClose: () => void;
  /** The CREDITOR — only the team that was supposedly paid may say the money did not arrive. */
  teamId: bigint;
}

// RejectPaymentDialog is the `no` arm of `balance_context.md` §Payment Flow — *"Is Payment Correct?
// → no → Team B Reject Payment"*.
//
// ⚠ IT IS A DIALOG, NOT A ONE-CLICK BUTTON, and it is marked destructive. Rejection is TERMINAL in
// the owner's lifecycle diagram: the payer cannot amend the claim, they must record a new one. That
// is not trivially reversible, so it confirms (CLAUDE.md — destructive actions always confirm).
//
// ⚠ THE REASON IS REQUIRED, and the field is the entire reason this is a bespoke dialog rather than a
// `ConfirmDialog`. The server refuses an empty one, and it is right to: a refusal the payer cannot
// read is a debt they cannot fix — they would see a claim marked wrong with no way to know whether to
// re-send the slip or the money.
export function RejectPaymentDialog({ target, onClose, teamId }: RejectPaymentDialogProps) {
  const { t } = useTranslation();
  const reject = useRejectPayment();

  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  // A fresh dialog per payment. Carrying the previous reason over would let somebody refuse one claim
  // with the sentence they wrote about another.
  useEffect(() => {
    if (target) {
      setReason("");
      setError("");
    }
  }, [target]);

  const busy = reject.isPending;
  const ready = reason.trim().length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !target) return;
    setError("");

    reject.mutate(
      { teamId, paymentId: target.id, reason: reason.trim() },
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
                <Dialog.Title>{t("liabilityDetail.rejectTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Text color="fg.muted" fontSize="sm">
                    {t("liabilityDetail.rejectDescription", {
                      amount: target ? formatRupiah(target.amount) : "",
                    })}
                  </Text>

                  <Field.Root required invalid={error !== ""}>
                    <Field.Label>{t("liabilityDetail.rejectReason")}</Field.Label>
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={t("liabilityDetail.rejectReasonPlaceholder")}
                      maxLength={500}
                      rows={3}
                      disabled={busy}
                      data-testid="liability-detail-reject-reason"
                    />
                    <Field.HelperText>{t("liabilityDetail.rejectReasonHelp")}</Field.HelperText>
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
                  colorPalette="red"
                  loading={busy}
                  disabled={!ready}
                  data-testid="liability-detail-reject-submit"
                >
                  {t("liabilityDetail.rejectLabel")}
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
