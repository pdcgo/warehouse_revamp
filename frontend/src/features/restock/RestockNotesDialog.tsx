import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Portal, Separator, Stack, Text } from "@chakra-ui/react";

import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { useRestockRequest } from "./queries";
import { WarehouseNoteBlock } from "./RestockNotes";
import { SellingNote } from "./SellingNote";

// THE NOTES, FROM THE LIST (owner: *"di listnya aku ingin ada modal menampilkan catatannya atau dialog bukan modal di aksi,
// bisa edit juga"*, the-list-opens-the-notes-in-a-dialog) — the row's ⋯ › Catatan opens both notes, one per writer
// (the-notes-are-one-per-writer), and the selling team's is changed here, from its Ubah, without opening the form:
//
//   ┌ Catatan Restok ─────────────────────────── × ┐
//   │ INV/2026/10/1001                              │
//   │ [Penjual]  Ani Rahayu · 29 Okt 13:05 ⚠ [✎ Ubah]│   ← SellingNote — the same as the restock page's
//   │ Urgent, untuk sale 10.10                      │
//   │ ───────────────────────────────────────────── │
//   │ [Gudang] ⚠  Belum ada catatan dari gudang.    │
//   │                                       [Tutup] │
//   └───────────────────────────────────────────────┘
//
// It reads the STORED restock by id (not the list's row): SellingNote saves the restock whole.
export function RestockNotesDialog({
  open,
  onOpenChange,
  teamId,
  requestId,
  marks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: bigint;
  requestId: bigint;
  /** The screen's ⚠ marks — who wrote the note (derived), a late edit (dropped), the warehouse's note (missing). */
  marks?: { sellingBy?: ReactNode; late?: ReactNode; warehouse?: ReactNode };
}) {
  const { t } = useTranslation();
  const query = useRestockRequest({ teamId: open ? teamId : undefined, requestId });
  const request = query.data ?? null;
  const [editing, setEditing] = useState(false);

  return (
    // While a note is being typed, a click outside does not throw it away — Batal or × do.
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} closeOnInteractOutside={!editing} size="md">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="restock-notes-dialog">
            <Dialog.Header>
              <Stack gap="0.5" minW="0">
                <Dialog.Title>{t("restock.notes.title")}</Dialog.Title>
                {/* Which restock — by the reference people quote, as its page is titled (the-title-is-the-reference-alone). */}
                {request && (
                  <Text fontSize="sm" color="fg.muted" truncate>
                    {request.invoiceRefId || request.receipt || t("restock.detail.requestTitle", { id: request.id.toString() })}
                  </Text>
                )}
              </Stack>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              {!request ? (
                <ListSkeleton rows={2} testId="restock-notes-loading" />
              ) : (
                <Stack gap="card">
                  <SellingNote
                    request={request}
                    teamId={teamId}
                    mark={marks?.sellingBy}
                    lateMark={marks?.late}
                    onEditingChange={setEditing}
                    inPlace
                  />
                  <Separator />
                  <WarehouseNoteBlock mark={marks?.warehouse} />
                </Stack>
              )}
            </Dialog.Body>

            {/* While a note is being typed its Batal / Simpan are the dialog's actions — Tutup under them would be a second
                row of buttons, and a second way out (a-phone-edits-the-note-in-a-sheet). */}
            {!editing && (
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" data-testid="restock-notes-close">
                    {t("common.close")}
                  </Button>
                </Dialog.ActionTrigger>
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
