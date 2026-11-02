import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Icon, Portal, SegmentGroup, Stack, Text, Textarea } from "@chakra-ui/react";
import { Minus, Plus } from "lucide-react";

import { rpcError } from "../../../api/clients";
import type { ExpenseRecord } from "../../../gen/warehouse/expense/v1/expense_pb";
import { CurrencyInput } from "../../../components/inputs/CurrencyInput";
import { toaster } from "../../../components/feedback/Toaster";
import { expenseKindLabel } from "../../../components/pickers/ExpenseKindSelect";
import { formatRupiah } from "../../../lib/money";
import { useAdjustExpense } from "../queries";

type Direction = "reduce" | "add";

interface AdjustExpenseDialogProps {
  teamId: bigint;
  /** The EXPENSE corrected — never an adjustment. */
  expense: ExpenseRecord;
  /** The dialog has closed, after a save or a cancel alike. */
  onClose: () => void;
}

// AdjustExpenseDialog corrects an expense with a NEW ROW (every-correction-is-a-signed-adjustment) — the expense itself
// never changes. The person types the CORRECTION, never the new total: which way it goes, and by how much. The amount
// field takes digits only, so the sign is the direction, chosen, rather than a minus somebody has to remember to type.
//
// The correction counts on the expense's own day (an-adjustment-counts-on-the-day-it-fixes), so there is no date here.
// What it leaves is shown before it is sent, and a correction past 0 is refused here as the server refuses it.
export function AdjustExpenseDialog({ teamId, expense, onClose }: AdjustExpenseDialogProps) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(true);
  const [direction, setDirection] = useState<Direction>("reduce");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const adjust = useAdjustExpense();
  const busy = adjust.isPending;

  const typed = amount === "" ? 0n : BigInt(amount);
  const correction = direction === "reduce" ? -typed : typed;
  const after = expense.netAmount + correction;
  const belowZero = after < 0n;
  const ready = typed > 0n && !belowZero;

  function close() {
    setOpen(false);
    onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!ready) return;

    setError("");

    adjust.mutate(
      { teamId, expenseId: expense.id, amount: correction, note },
      {
        onSuccess: () => {
          toaster.create({ type: "success", title: t("expenses.toast.adjusted") });
          close();
        },
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && close()} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="adjust-expense-dialog">
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("expenses.adjustTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  {/* Which expense, and what it counts for now — the figure the correction moves. */}
                  <Text fontSize="sm" color="fg.muted" data-testid="adjust-expense-now">
                    {t("expenses.adjustFor", {
                      kind: expenseKindLabel(t, expense.kind),
                      date: expense.occurredAt,
                      now: formatRupiah(expense.netAmount),
                    })}
                  </Text>

                  <Field.Root required>
                    <Field.Label>{t("expenses.adjustDirection")}</Field.Label>
                    <SegmentGroup.Root
                      value={direction}
                      onValueChange={(e) => setDirection((e.value as Direction | null) ?? direction)}
                      disabled={busy}
                      aria-label={t("expenses.adjustDirection")}
                      data-testid="adjust-direction"
                    >
                      <SegmentGroup.Indicator />
                      <SegmentGroup.Item value="reduce" data-testid="adjust-direction-reduce">
                        <Icon as={Minus} boxSize="3.5" />
                        <SegmentGroup.ItemText>{t("expenses.adjustReduce")}</SegmentGroup.ItemText>
                        <SegmentGroup.ItemHiddenInput />
                      </SegmentGroup.Item>
                      <SegmentGroup.Item value="add" data-testid="adjust-direction-add">
                        <Icon as={Plus} boxSize="3.5" />
                        <SegmentGroup.ItemText>{t("expenses.adjustAdd")}</SegmentGroup.ItemText>
                        <SegmentGroup.ItemHiddenInput />
                      </SegmentGroup.Item>
                    </SegmentGroup.Root>
                  </Field.Root>

                  <Field.Root required invalid={belowZero}>
                    <Field.Label>{t("expenses.adjustAmount")}</Field.Label>
                    <CurrencyInput value={amount} onChange={setAmount} disabled={busy} data-testid="adjust-amount" />
                    {belowZero ? (
                      <Field.ErrorText data-testid="adjust-below-zero">
                        {t("expenses.adjustBelowZero", { now: formatRupiah(expense.netAmount) })}
                      </Field.ErrorText>
                    ) : (
                      <Field.HelperText data-testid="adjust-after">
                        {t("expenses.adjustAfter", { after: formatRupiah(after) })}
                      </Field.HelperText>
                    )}
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("expenses.table.note")}</Field.Label>
                    <Textarea
                      value={note}
                      disabled={busy}
                      placeholder={t("expenses.adjustNotePlaceholder")}
                      data-testid="adjust-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {error && (
                    <Dialog.Description color="error.fg" data-testid="adjust-form-error">
                      {error}
                    </Dialog.Description>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Button variant="outline" disabled={busy} onClick={close}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" colorPalette="brand" loading={busy} disabled={!ready} data-testid="submit-adjust">
                  {t("expenses.adjustSave")}
                </Button>
              </Dialog.Footer>

              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </form>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
