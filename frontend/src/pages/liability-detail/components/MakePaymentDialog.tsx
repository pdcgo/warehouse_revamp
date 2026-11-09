import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  CloseButton,
  Dialog,
  Field,
  FileUpload,
  Flex,
  Icon,
  IconButton,
  Portal,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { Paperclip, X } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { FinancialAccountSelect } from "../../../components/pickers/FinancialAccountSelect";
import { useProofUpload, type UploadedProof } from "../../../features/documents/useProofUpload";
import { useRecordPayment } from "../../../features/liability/queries";

// What a transfer slip arrives as: a photo or screenshot of it, or the bank's PDF.
const PROOF_ACCEPT = "image/*,application/pdf";
// The contract's own ceiling — `LiabilityPaymentRecordRequest.document_ids` takes at most 10.
const MAX_PROOFS = 10;

export interface MakePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payerTeamId: bigint;
  creditorTeamId: bigint;
  counterpartyName: string;
}

// MAKE A PAYMENT — a focused form dialog for a payment YOU are sending. It has NO ledger effect until the creditor
// confirms it arrived (two-phase, #188). Offered only while this team OWES the counterparty
// (the-debtor-claims-the-creditor-decides) — the server refuses anyone else.
export function MakePaymentDialog({
  open,
  onOpenChange,
  payerTeamId,
  creditorTeamId,
  counterpartyName,
}: MakePaymentDialogProps) {
  const { t } = useTranslation();
  const record = useRecordPayment();

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [proofs, setProofs] = useState<UploadedProof[]>([]);
  // WHICH OF YOUR ACCOUNTS PAID — the payer's half of a-team-payment-posts-on-accept. When they
  // accept, this account goes down and theirs goes up, so it is chosen here, by the one person who
  // knows which bank the transfer left from.
  const [fromAccountId, setFromAccountId] = useState(0n);
  // Remounting the picker after every upload resets Chakra's own file list, which otherwise accumulates across picks
  // (ReceiptUpload's and ProductImagesInput's reason for the same key).
  const [pickerKey, setPickerKey] = useState(0);
  // A synchronous guard: FileUpload can fire onFileChange twice for one pick, and state lags.
  const uploadingRef = useRef(false);

  const proof = useProofUpload({ teamId: payerTeamId, shareWithTeamId: creditorTeamId });
  const busy = record.isPending || proof.uploading;

  // ⚠ PROOF IS PART OF "READY", not a nicety. The contract requires amount > 0 AND at least one
  // document (a-payment-must-carry-proof) — this mirrors the server rather than inventing a second
  // idea of ready, so the button is disabled instead of the send being refused after the fact.
  // ⚠ AND THE ACCOUNT. The acceptance has to post OUT of somewhere; a payment with no account is one
  // the financial accounts can never hear. The server requires it too, and refuses one not yours.
  const ready = amount !== "" && Number(amount) > 0 && proofs.length > 0 && fromAccountId > 0n;

  function change(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setAmount("");
      setNote("");
      setError("");
      setFromAccountId(0n);
      // ⚠ THE UPLOADED FILES ARE NOT DELETED, only forgotten. They are already shared with the
      // creditor and a share cannot be withdrawn; a cancelled dialog leaves an orphan document, which
      // is the cheap side of that trade.
      setProofs([]);
      proof.setError("");
    }
  }

  async function pick(file: File | undefined) {
    if (!file || uploadingRef.current) return;

    uploadingRef.current = true;
    try {
      const uploaded = await proof.upload(file);
      if (uploaded) {
        setProofs((prev) => [...prev, uploaded]);
      }
    } finally {
      uploadingRef.current = false;
      setPickerKey((k) => k + 1);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError("");

    record.mutate(
      {
        teamId: payerTeamId,
        creditorTeamId,
        amount: Number(amount),
        note,
        documentIds: proofs.map((p) => p.id),
        fromAccountId,
      },
      {
        onSuccess: () => change(false),
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            {/* ⚠ noValidate — `ready` above IS this form's validation. The proof's hidden input is `required` (from
                its Field) and is emptied after every upload so the same file can be picked again, so the browser saw
                an empty required field and silently swallowed every submit: Make Payment could not be sent from this
                screen at all. */}
            <form onSubmit={submit} noValidate>
              <Dialog.Header>
                <Dialog.Title>{t("liabilityDetail.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Text color="fg.muted" fontSize="sm">
                    {t("liabilityDetail.recordDescription", { name: counterpartyName })}
                  </Text>

                  <Field.Root required>
                    <Field.Label>{t("liabilityDetail.recordAmount")}</Field.Label>
                    <CurrencyInput value={amount} onChange={setAmount} disabled={busy} data-testid="record-amount" />
                  </Field.Root>

                  {/* PAID FROM — any active account of yours, not only the operational ones: those
                      are what a RESTOCK may be paid from (operational-accounts-pay-for-operations),
                      and settling a debt with another team is not an operation. */}
                  <Field.Root required>
                    <Field.Label>{t("liabilityDetail.recordFromAccount")}</Field.Label>
                    <FinancialAccountSelect
                      teamId={payerTeamId}
                      value={fromAccountId}
                      onChange={setFromAccountId}
                      autoPickSingle
                      disabled={busy}
                      placeholder={t("liabilityDetail.recordFromAccountPlaceholder")}
                      testId="record-from-account"
                    />
                    <Field.HelperText>{t("liabilityDetail.recordFromAccountHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>
                      {t("liabilityDetail.recordNote")}{" "}
                      <Text as="span" color="fg.subtle" fontWeight="normal">
                        {t("liabilityDetail.recordNoteOptional")}
                      </Text>
                    </Field.Label>
                    <Textarea
                      value={note}
                      disabled={busy}
                      placeholder={t("liabilityDetail.recordNotePlaceholder")}
                      data-testid="record-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <Field.HelperText>{t("liabilityDetail.recordNoteHelp")}</Field.HelperText>
                  </Field.Root>

                  {/* PROOF OF THE TRANSFER — required (a-payment-must-carry-proof).
                      `balance_context.md` §Payment Flow has the payer BRING it and the creditor CHECK
                      IT MANUALLY, so a payment with nothing attached asks them to accept on your
                      word. Uploading also SHARES the file with them: without that they would get
                      NotFound on the one thing they have to look at.

                      ⚠ CHAKRA'S FILE UPLOAD (chakra-first-whenever-it-has-the-component) — a trigger button with its
                      icon, as the order form's receipt and the settlement import pick a file. It was the browser's
                      native file input, which kept reading "No file chosen" beside a file already attached. */}
                  <Field.Root required>
                    <Field.Label>{t("liabilityDetail.recordProof")}</Field.Label>

                    {proofs.length > 0 && (
                      <Stack gap="0.5" pb="1" data-testid="record-proof-list">
                        {proofs.map((p) => (
                          <Flex key={p.id} align="center" gap="field">
                            <Icon as={Paperclip} boxSize="4" color="fg.muted" />
                            <Text fontSize="sm" lineClamp={1} flex="1">
                              {p.filename}
                            </Text>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("liabilityDetail.recordProofRemove")}
                              disabled={busy}
                              data-testid={`record-proof-remove-${p.id}`}
                              onClick={() => setProofs((prev) => prev.filter((x) => x.id !== p.id))}
                            >
                              <Icon as={X} boxSize="4" />
                            </IconButton>
                          </Flex>
                        ))}
                      </Stack>
                    )}

                    <FileUpload.Root
                      key={pickerKey}
                      accept={PROOF_ACCEPT}
                      maxFiles={1}
                      disabled={busy || proofs.length >= MAX_PROOFS}
                      onFileChange={(details) => void pick(details.acceptedFiles[0])}
                    >
                      <FileUpload.HiddenInput data-testid="record-proof-input" />
                      <FileUpload.Trigger asChild>
                        <Button
                          variant="outline"
                          colorPalette="brand"
                          loading={proof.uploading}
                          data-testid="record-proof-pick"
                        >
                          <Icon as={Paperclip} boxSize="4" />
                          {proofs.length > 0
                            ? t("liabilityDetail.recordProofAttachAnother")
                            : t("liabilityDetail.recordProofAttach")}
                        </Button>
                      </FileUpload.Trigger>
                    </FileUpload.Root>

                    <Field.HelperText>{t("liabilityDetail.recordProofHelp")}</Field.HelperText>

                    {proof.error && <Field.ErrorText data-testid="record-proof-error">{proof.error}</Field.ErrorText>}
                  </Field.Root>

                  {error && (
                    <Dialog.Description color="error.fg" data-testid="record-error">
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
                <Button type="submit" colorPalette="brand" loading={busy} disabled={!ready} data-testid="record-submit">
                  {t("liabilityDetail.recordSubmit")}
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
