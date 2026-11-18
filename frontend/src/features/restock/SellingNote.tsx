import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockLogChangeField, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { toaster } from "../../components/feedback/Toaster";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { NoteEditor } from "./NoteEditor";
import { useRestockActors, useSaveRestockRequest, useSetRestockNote } from "./queries";

/** The selling team's head line — its badge, who wrote the note and when, and an action at its end. */
export function SellingNoteHead({ request, action }: { request: RestockRequest; action?: ReactNode }) {
  const { t } = useTranslation();

  // WHO WROTE THE NOTE, AND WHEN — the note's OWN writer, kept with it (the-notes-are-one-per-writer): the raise, or the
  // last edit or note set that changed the note — never an edit that changed only a line.
  const own = request.noteAtUnix > 0n;
  // A NOTE LAST WRITTEN BEFORE ITS WRITER WAS KEPT has none: the restock's last raise or edit stands in, as it always
  // did — and SAYS it is that (`-fallback`), so it never reads as the note's writer. A Koreksi Jumlah Terima is never in
  // `logs` (its rows are `count_corrections`), so it is never read as this edit; nor is the WAREHOUSE's own note, an edit's
  // row whose only change is that note (the-warehouse-writes-its-own-note) — the warehouse never edits the selling team's.
  const last = own
    ? undefined
    : [...request.logs]
        .reverse()
        .find(
          (log) =>
            log.fromStatus === RestockRequestStatus.UNSPECIFIED ||
            (log.fromStatus === log.toStatus && !onlyTheWarehouseNote(log.changes)),
        );
  const who = own ? request.noteByUserId : last?.actorUserId;
  const at = own ? request.noteAtUnix : last?.atUnix;
  const actors = useRestockActors(who ? [who] : []);
  const actor = who ? actors.data?.get(who.toString()) : undefined;
  const by = actor ? actor.name || actor.username : "";

  return (
    <HStack gap="2" wrap="wrap">
      <TeamTypeBadge type={TeamType.SELLING} />
      {at !== undefined && (
        <Text
          fontSize="xs"
          color="fg.muted"
          data-testid="restock-detail-note-selling-by"
          data-source={own ? "note" : "restock"}
        >
          {[by, formatUnixDateTimeShort(at)].filter(Boolean).join(" · ")}
        </Text>
      )}
      {/* Root or the System Administrator wrote it from outside the team (an-override-shows-a-platform-badge). */}
      {own && request.noteByIsOverride && <RootTeamBadge size="xs" />}
      {last && (
        <Text fontSize="xs" color="fg.muted" data-testid="restock-detail-note-selling-by-fallback">
          {t("restock.notes.byFallback")}
        </Text>
      )}
      {action && <Box ms="auto">{action}</Box>}
    </HStack>
  );
}

/** An edit's row that changed the receiving warehouse's own note and nothing else — the warehouse's write, not an edit. */
function onlyTheWarehouseNote(changes: { field: RestockLogChangeField }[]): boolean {
  return changes.length > 0 && changes.every((c) => c.field === RestockLogChangeField.WAREHOUSE_NOTE);
}

// THE SELLING TEAM'S NOTE, READ — AND CHANGED FROM A BUTTON, IN PLACE (the-note-is-edited-from-a-button). One component
// for the list's Catatan dialog and the restock page's Catatan section (owner: *"edit di detailnya?"*), so the two edit
// the same way — and the way itself is NoteEditor's, which the warehouse's own note shares (the-warehouse-writes-its-own-note).
//
// IT IS EDITED IN ANY STATUS (owner: *"catatan bisa diedit kapanpun"*, the-note-is-edited-in-any-status), and kept:
//   on its way    the restock is sent back WHOLE with only the note changed, as before — the update replaces every field
//                 and line, so the restock passed in must be the STORED one (a by-id read, never a list's row);
//   past its way  the note ALONE (RestockRequestNoteSet) — the head of an arrived restock is closed to the edit form, and
//                 an accepted, lost or cancelled one takes no update at all; the note set moves the note and nothing else.
export function SellingNote({
  request,
  teamId,
  onEditingChange,
  inPlace = false,
}: {
  /** The stored restock — a by-id read. */
  request: RestockRequest;
  teamId: bigint;
  /** Told when the edit opens and shuts — a dialog keeps itself open while a note is being typed. */
  onEditingChange?: (editing: boolean) => void;
  /** Edit where it is even on a phone — the note already sits in a dialog, which a sheet would be stacked on. */
  inPlace?: boolean;
}) {
  const { t } = useTranslation();
  const save = useSaveRestockRequest();
  const setNote = useSetRestockNote();

  async function submit(draft: string): Promise<boolean> {
    try {
      if (request.status === RestockRequestStatus.ONGOING) {
        await save.mutateAsync({ requestId: request.id, fields: unchangedBut(request, teamId, draft) });
      } else {
        await setNote.mutateAsync({ teamId, requestId: request.id, note: draft });
      }
      toaster.create({ type: "success", title: t("restock.notes.saved") });
      // Back to reading — the save refreshes the restock, so the saved note is what is read.
      return true;
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.notes.saveFailed"), description: rpcError(err) });
      return false;
    }
  }

  return (
    <Stack gap="2" data-testid="restock-detail-note-selling">
      <NoteEditor
        value={request.note}
        head={(action) => <SellingNoteHead request={request} action={action} />}
        emptyText="—"
        onSubmit={submit}
        saving={save.isPending || setNote.isPending}
        testId="restock-notes"
        textTestId="restock-detail-note"
        ariaLabel={t("restock.notes.sellingLabel")}
        sheetTitle={t("restock.notes.editTitle")}
        onEditingChange={onEditingChange}
        inPlace={inPlace}
      />
    </Stack>
  );
}

// The restock exactly as stored, with only its note replaced — the update replaces every field and every line, so
// anything not sent back as it was would read to the server as a change.
function unchangedBut(request: RestockRequest, teamId: bigint, note: string) {
  return {
    teamId,
    warehouseId: request.warehouseId,
    receipt: request.receipt,
    receiptFile: request.receiptFile,
    shipmentId: request.shipmentId,
    invoiceRefId: request.invoiceRefId,
    financeAccountId: request.financeAccountId,
    shipmentCost: request.shipmentCost,
    note,
    items: request.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productCode: item.productCode,
      name: item.name,
      count: item.count,
      total: item.total,
      supplierId: item.supplierId,
      supplierChannelId: item.supplierChannelId,
      note: item.note,
    })),
  };
}
