import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, HStack, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { toaster } from "../../components/feedback/Toaster";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { NoteEditor } from "./NoteEditor";
import { useRestockActors, useSaveRestockRequest } from "./queries";

/** The selling team's head line — its badge, who and when, the mark on them, and an action at its end. */
export function SellingNoteHead({ request, mark, action }: { request: RestockRequest; mark?: ReactNode; action?: ReactNode }) {
  // WHO WROTE IT, AND WHEN — the last raise or edit of the restock. Nothing stores the note's own author or time, so
  // this is the nearest real figure, and it is marked (`derived`): an edit that changed only a line counts too.
  // A Koreksi Jumlah Terima is never in `logs` (its rows are `count_corrections`), so it is never read as this edit.
  const last = [...request.logs]
    .reverse()
    .find((log) => log.fromStatus === RestockRequestStatus.UNSPECIFIED || log.fromStatus === log.toStatus);
  const actors = useRestockActors(last ? [last.actorUserId] : []);
  const actor = last ? actors.data?.get(last.actorUserId.toString()) : undefined;
  const by = actor ? actor.name || actor.username : "";

  return (
    <HStack gap="2" wrap="wrap">
      <TeamTypeBadge type={TeamType.SELLING} />
      {last && (
        <Text fontSize="xs" color="fg.muted" data-testid="restock-detail-note-selling-by">
          {[by, formatUnixDateTimeShort(last.atUnix)].filter(Boolean).join(" · ")}
        </Text>
      )}
      {mark}
      {action && <Box ms="auto">{action}</Box>}
    </HStack>
  );
}

// THE SELLING TEAM'S NOTE, READ — AND CHANGED FROM A BUTTON, IN PLACE (the-note-is-edited-from-a-button). One component
// for the list's Catatan dialog and the restock page's Catatan section (owner: *"edit di detailnya?"*), so the two edit
// the same way — and the way itself is NoteEditor's, which the warehouse's own note shares (the-warehouse-writes-its-own-note).
//
// ⚠ IT SAVES THE RESTOCK WHOLE. The update replaces every field and every line while the restock is on its way, so the
// restock passed in must be the STORED one (a by-id read, never a list's row), and it is sent back exactly as stored
// with only the note changed — as the edit form sends a locked header. Once the box has arrived the head of a restock is
// closed, its note with it: an edit then is thrown away, said so, and marked (the-note-is-edited-in-any-status).
export function SellingNote({
  request,
  teamId,
  mark,
  lateMark,
  onEditingChange,
  inPlace = false,
}: {
  /** The stored restock — a by-id read. */
  request: RestockRequest;
  teamId: bigint;
  /** ⚠ — who and when are the restock's last raise or edit, not the note's own. */
  mark?: ReactNode;
  /**
   * ⚠ — once the restock is past its way the server keeps its head closed, the note with it: an edit then is thrown away
   * (`dropped`). Beside Ubah, on those statuses only.
   */
  lateMark?: ReactNode;
  /** Told when the edit opens and shuts — a dialog keeps itself open while a note is being typed. */
  onEditingChange?: (editing: boolean) => void;
  /** Edit where it is even on a phone — the note already sits in a dialog, which a sheet would be stacked on. */
  inPlace?: boolean;
}) {
  const { t } = useTranslation();
  const save = useSaveRestockRequest();

  // THE NOTE IS EDITED IN ANY STATUS (owner: *"catatan bisa diedit kapanpun"*, the-note-is-edited-in-any-status) — Ubah is
  // always there. Only while the restock is on its way does the server take it: after that the head of a restock is
  // closed, the note with it, so a save is thrown away, said so, and marked.
  const storable = request.status === RestockRequestStatus.ONGOING;

  async function submit(draft: string): Promise<boolean> {
    if (!storable) {
      toaster.create({ type: "info", title: t("restock.notes.notStored") });
      return true;
    }

    try {
      await save.mutateAsync({ requestId: request.id, fields: unchangedBut(request, teamId, draft) });
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
        head={(action) => <SellingNoteHead request={request} mark={mark} action={action} />}
        emptyText="—"
        onSubmit={submit}
        saving={save.isPending}
        testId="restock-notes"
        textTestId="restock-detail-note"
        ariaLabel={t("restock.notes.sellingLabel")}
        sheetTitle={t("restock.notes.editTitle")}
        beside={!storable && lateMark}
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
