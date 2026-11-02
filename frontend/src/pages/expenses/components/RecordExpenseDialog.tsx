import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Icon, Portal, Stack, Textarea } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { useSaveExpense } from "../queries";
import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKindSelect } from "../../../components/pickers/ExpenseKindSelect";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { DatePicker } from "../../../components/datetime/DatePicker";
import { ShopSelect } from "../../../components/pickers/ShopSelect";
import { toaster } from "../../../components/feedback/Toaster";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RecordCostDialogProps {
  teamId: bigint;
}

// RecordExpenseDialog enters a cost (#170).
//
// A DIALOG rather than a page, and that is the repo's own distinction: a dialog is for a focused
// ACTION, a page is for reading an entity. Entering a cost is five fields and a button.
//
// It only ever RECORDS: an expense is never edited after it is saved (an-expense-is-never-edited). A mistake is
// corrected by AdjustExpenseDialog, which writes a row of its own.
export function RecordExpenseDialog({ teamId }: RecordCostDialogProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExpenseKind>(ExpenseKind.UNSPECIFIED);
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(today);
  const [shopId, setShopId] = useState<bigint>(0n);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // The write, and what it invalidates, declared together in queries.ts (#177). `busy` is gone: the
  // mutation already knows whether it is in flight, and a second flag beside it is a second answer to
  // the same question that can disagree with the first.
  const save = useSaveExpense();
  const busy = save.isPending;

  function reset() {
    setKind(ExpenseKind.UNSPECIFIED);
    setAmount("");
    setOccurredAt(today());
    setShopId(0n);
    setNote("");
    setError("");
  }

  // A kind and a real amount are the two things a cost cannot be recorded without — the contract
  // refuses UNSPECIFIED and requires amount > 0, so this mirrors the server rather than inventing a
  // second idea of "ready to send".
  const ready = kind !== ExpenseKind.UNSPECIFIED && amount !== "" && Number(amount) > 0;

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!ready) return;

    setError("");

    save.mutate(
      {
        teamId,
        kind,
        amount: BigInt(amount),
        occurredAt,
        shopId,
        note,
      },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("expenses.toast.recorded") });

          setOpen(false);
          reset();
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  function change(next: boolean) {
    setOpen(next);

    if (!next) {
      reset();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)} placement="center">
      <Dialog.Trigger asChild>
        <Button colorPalette="brand" size="xs" data-testid="open-record-cost">
          <Icon as={Plus} boxSize="4" />
          {t("expenses.record")}
        </Button>
      </Dialog.Trigger>

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("expenses.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Field.Root required>
                    <Field.Label>{t("expenses.table.kind")}</Field.Label>
                    <ExpenseKindSelect value={kind} onChange={setKind} disabled={busy} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("expenses.table.amount")}</Field.Label>
                    <CurrencyInput
                      value={amount}
                      onChange={setAmount}
                      disabled={busy}
                      data-testid="expense-amount"
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("expenses.table.date")}</Field.Label>
                    <DatePicker
                      value={occurredAt}
                      onChange={setOccurredAt}
                      disabled={busy}
                      testId="expense-date"
                    />
                    {/* The date the cost BELONGS TO — payroll paid on the 5th is last month's cost. */}
                    <Field.HelperText>{t("expenses.dateHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("expenses.table.shop")}</Field.Label>
                    {/* Optional on EVERY kind (owner), not just ads: a team with two shops may split
                        its wages or a subscription between them. */}
                    <ShopSelect teamId={teamId} value={shopId} onChange={setShopId} disabled={busy} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("expenses.table.note")}</Field.Label>
                    <Textarea
                      value={note}
                      disabled={busy}
                      data-testid="expense-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {error && (
                    <Dialog.Description color="error.fg" data-testid="expense-form-error">
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
                <Button type="submit" colorPalette="brand" loading={busy} disabled={!ready} data-testid="submit-cost">
                  {t("expenses.save")}
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
