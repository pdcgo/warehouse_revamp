import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Field, Icon, Input, Portal, Stack, Textarea } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { costClient, rpcError } from "../api/clients";
import type { CostRecord } from "../gen/warehouse/cost/v1/cost_pb";
import { CostKind } from "../gen/warehouse/cost/v1/cost_pb";
import { CostKindSelect } from "../components/CostKindSelect";
import { CurrencyInput } from "../components/CurrencyInput";
import { ShopSelect } from "../components/ShopSelect";
import { toaster } from "../components/Toaster";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RecordCostDialogProps {
  teamId: bigint;
  /** When set, the dialog edits this cost instead of recording a new one. */
  editing?: CostRecord;
  onDone: () => void;
  /** Only used in edit mode, where the dialog is opened by the caller rather than by its trigger. */
  onClose?: () => void;
}

// RecordCostDialog enters or corrects a cost (#170).
//
// A DIALOG rather than a page, and that is the repo's own distinction: a dialog is for a focused
// ACTION, a page is for reading an entity. Entering a cost is five fields and a button.
//
// The same dialog serves create and EDIT, because the edit form IS the record re-opened — a second
// component would be the same five fields drifting apart. `editing` decides which RPC it calls.
export function RecordCostDialog({ teamId, editing, onDone, onClose }: RecordCostDialogProps) {
  const { t } = useTranslation();

  const isEdit = editing !== undefined;

  const [open, setOpen] = useState(isEdit);
  const [kind, setKind] = useState<CostKind>(CostKind.UNSPECIFIED);
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(today);
  const [shopId, setShopId] = useState<bigint>(0n);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
    setKind(CostKind.UNSPECIFIED);
    setAmount("");
    setOccurredAt(today());
    setShopId(0n);
    setNote("");
    setError("");
  }

  // A kind and a real amount are the two things a cost cannot be recorded without — the contract
  // refuses UNSPECIFIED and requires amount > 0, so this mirrors the server rather than inventing a
  // second idea of "ready to send".
  const ready = kind !== CostKind.UNSPECIFIED && amount !== "" && Number(amount) > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (!ready) return;

    setBusy(true);
    setError("");

    try {
      if (isEdit) {
        await costClient.costUpdate({
          teamId,
          costId: editing.id,
          kind,
          amount: BigInt(amount),
          occurredAt,
          shopId,
          note,
        });
      } else {
        await costClient.costCreate({
          teamId,
          kind,
          amount: BigInt(amount),
          occurredAt,
          shopId,
          note,
        });
      }

      toaster.create({
        type: "success",
        title: isEdit ? t("costs.toast.updated") : t("costs.toast.recorded"),
      });

      setOpen(false);
      reset();
      onDone();
    } catch (err) {
      setError(rpcError(err));
    } finally {
      setBusy(false);
    }
  }

  function change(next: boolean) {
    setOpen(next);

    if (!next) {
      reset();
      onClose?.();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)} placement="center">
      {/* In edit mode the caller opens it, so there is no trigger to render. */}
      {!isEdit && (
        <Dialog.Trigger asChild>
          <Button colorPalette="brand" size="xs" data-testid="open-record-cost">
            <Icon as={Plus} boxSize="4" />
            {t("costs.record")}
          </Button>
        </Dialog.Trigger>
      )}

      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{isEdit ? t("costs.editTitle") : t("costs.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Field.Root required>
                    <Field.Label>{t("costs.table.kind")}</Field.Label>
                    <CostKindSelect value={kind} onChange={setKind} disabled={busy} />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("costs.table.amount")}</Field.Label>
                    <CurrencyInput
                      value={amount}
                      onChange={setAmount}
                      disabled={busy}
                      placeholder="0"
                      data-testid="cost-amount"
                    />
                  </Field.Root>

                  <Field.Root required>
                    <Field.Label>{t("costs.table.date")}</Field.Label>
                    <Input
                      type="date"
                      value={occurredAt}
                      disabled={busy}
                      data-testid="cost-date"
                      onChange={(e) => setOccurredAt(e.target.value)}
                    />
                    {/* The date the cost BELONGS TO — payroll paid on the 5th is last month's cost. */}
                    <Field.HelperText>{t("costs.dateHelp")}</Field.HelperText>
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("costs.table.shop")}</Field.Label>
                    {/* Optional on EVERY kind (owner), not just ads: a team with two shops may split
                        its wages or a subscription between them. */}
                    <ShopSelect teamId={teamId} value={shopId} onChange={setShopId} disabled={busy} />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>{t("costs.table.note")}</Field.Label>
                    <Textarea
                      value={note}
                      disabled={busy}
                      data-testid="cost-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field.Root>

                  {error && (
                    <Dialog.Description color="red.fg" data-testid="cost-form-error">
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
                  {t("costs.save")}
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
