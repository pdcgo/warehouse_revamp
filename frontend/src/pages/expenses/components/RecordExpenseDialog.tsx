import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";

import { Button, IconButton } from "../../../components/ui/Button";
import { Dialog, Portal } from "../../../components/ui/Dialog";
import { Field } from "../../../components/ui/Field";
import { rpcError } from "../../../api/clients";
import { useSaveExpense } from "../queries";
import type { ExpenseRecord } from "../../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKind } from "../../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKindSelect } from "../../../components/ExpenseKindSelect";
import { CurrencyInput } from "../../../components/CurrencyInput";
import { ShopSelect } from "../../../components/ShopSelect";
import { toaster } from "../../../components/Toaster";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RecordCostDialogProps {
  teamId: bigint;
  /** When set, the dialog edits this cost instead of recording a new one. */
  editing?: ExpenseRecord;
  /**
   * The dialog has CLOSED — after a save or a cancel alike.
   *
   * Lifecycle only. It used to be joined by an `onDone` that existed purely so the page could refetch
   * (#177); the write now invalidates the cache itself, so the parent is told the dialog is gone and
   * nothing more. In edit mode that is what clears `editing`.
   */
  onClose?: () => void;
}

// RecordExpenseDialog enters or corrects a cost (#170).
//
// A DIALOG rather than a page, and that is the repo's own distinction: a dialog is for a focused
// ACTION, a page is for reading an entity. Entering a cost is five fields and a button.
//
// The same dialog serves create and EDIT, because the edit form IS the record re-opened — a second
// component would be the same five fields drifting apart. `editing` decides which RPC it calls.
export function RecordExpenseDialog({ teamId, editing, onClose }: RecordCostDialogProps) {
  const { t } = useTranslation();

  const isEdit = editing !== undefined;

  const [open, setOpen] = useState(isEdit);
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

  // In edit mode the dialog opens already holding the record. Keyed on the cost's id so opening a
  // DIFFERENT row re-fills rather than showing the previous one's figures.
  useEffect(() => {
    if (!editing) return;

    setKind(editing.kind);
    setAmount(editing.amount.toString());
    setOccurredAt(editing.occurredAt);
    setShopId(editing.shopId);
    setNote(editing.note);
    setError("");
    setOpen(true);
  }, [editing]);

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
        expenseId: editing?.id,
        kind,
        amount: BigInt(amount),
        occurredAt,
        shopId,
        note,
      },
      {
        onSuccess: () => {
          toaster.create({
            type: "success",
            title: isEdit ? t("expenses.toast.updated") : t("expenses.toast.recorded"),
          });

          setOpen(false);
          reset();
          // The dialog is gone — in edit mode this is what clears the parent's `editing`. It is NOT a
          // refetch signal: the hook already invalidated before this ran.
          onClose?.();
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  function change(next: boolean) {
    setOpen(next);

    if (!next) {
      reset();
      onClose?.();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)}>
      {/* In edit mode the caller opens it, so there is no trigger to render. */}
      {!isEdit && (
        <Dialog.Trigger asChild>
          <Button colorPalette="brand" size="xs" data-testid="open-record-cost">
            <Plus className="size-4" />
            {t("expenses.record")}
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{isEdit ? t("expenses.editTitle") : t("expenses.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="flex flex-col gap-field">
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
                      placeholder="0"
                      data-testid="expense-amount"
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("expenses.table.date")}</Field.Label>
                    <Field.Input
                      type="date"
                      value={occurredAt}
                      disabled={busy}
                      data-testid="expense-date"
                      onChange={(e) => setOccurredAt(e.target.value)}
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
                    <Field.Textarea
                      value={note}
                      disabled={busy}
                      data-testid="expense-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {error && (
                    <p className="text-sm text-red-600 dark:text-red-400" data-testid="expense-form-error">
                      {error}
                    </p>
                  )}
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.CloseTrigger asChild>
                  <Button type="button" variant="outline" colorPalette="gray" disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.CloseTrigger>
                <Button type="submit" colorPalette="brand" loading={busy} disabled={!ready} data-testid="submit-cost">
                  {t("expenses.save")}
                </Button>
              </Dialog.Footer>
            </form>

            <Dialog.CloseTrigger asChild>
              <IconButton type="button" size="sm" aria-label={t("common.cancel")} className="absolute right-3 top-3">
                <X className="size-4" />
              </IconButton>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
