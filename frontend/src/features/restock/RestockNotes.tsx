import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, HStack, Separator, Stack, Text } from "@chakra-ui/react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { toaster } from "../../components/feedback/Toaster";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { NoteEditor } from "./NoteEditor";
import { useRestockActors, useSetWarehouseNote } from "./queries";
import { SellingNote, SellingNoteHead } from "./SellingNote";

// A RESTOCK'S NOTES, ONE PER WRITER (owner, shown three sources — the restock's, the warehouse's, the system's: *"boleh"*;
// the-notes-are-one-per-writer):
//
//   [Penjual]  Ani Rahayu · 29 Okt 13:05         the selling team's note on the restock, with its own writer
//   Urgent, untuk sale 10.10
//   ─────────────────────────
//   [Gudang]   Budi Santoso · 30 Okt 09:12        the receiving warehouse's note on the restock, with its own writer
//   Kardus penyok di sudut
//
// EACH WRITER EDITS ITS OWN, AND ONLY ITS OWN (owner: *"bisa mengubah catatan warehouse"*,
// the-warehouse-writes-its-own-note): on the selling team's page Ubah sits on the selling note; on the warehouse's
// (`side="warehouse"`) on the warehouse's, the selling one read. The SYSTEM's voice is the Riwayat, not a third note.
// Shared by both restock pages and the list's Catatan dialog.

/**
 * The warehouse's head line — its badge, WHO WROTE ITS NOTE AND WHEN (the-notes-are-one-per-writer: the warehouse
 * member whose write last changed it, as the server keeps it), and an action at its end. Nothing is said before the
 * warehouse first writes one.
 */
function WarehouseNoteHead({ request, action }: { request: RestockRequest; action?: ReactNode }) {
  const own = request.warehouseNoteAtUnix > 0n;
  const who = own ? request.warehouseNoteByUserId : 0n;
  const actors = useRestockActors(who ? [who] : []);
  const actor = who ? actors.data?.get(who.toString()) : undefined;
  const by = actor ? actor.name || actor.username : "";

  return (
    <HStack gap="2" wrap="wrap">
      <TeamTypeBadge type={TeamType.WAREHOUSE} />
      {own && (
        <Text fontSize="xs" color="fg.muted" data-testid="restock-detail-note-warehouse-by">
          {[by, formatUnixDateTimeShort(request.warehouseNoteAtUnix)].filter(Boolean).join(" · ")}
        </Text>
      )}
      {/* Root or the System Administrator wrote it from outside the warehouse (an-override-shows-a-platform-badge). */}
      {own && request.warehouseNoteByIsOverride && <RootTeamBadge size="xs" />}
      {action && <Box ms="auto">{action}</Box>}
    </HStack>
  );
}

/**
 * THE WAREHOUSE'S NOTE, READ — on the selling team's side (its page and the list's Catatan dialog): the note the
 * receiving warehouse wrote, with who and when, never changed here (three-notes-one-writer-each).
 */
export function WarehouseNoteBlock({ request }: { request: RestockRequest }) {
  const { t } = useTranslation();

  return (
    <Stack gap="1" data-testid="restock-detail-note-warehouse">
      <WarehouseNoteHead request={request} />
      <Text
        fontSize="sm"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color={request.warehouseNote ? undefined : "fg.muted"}
        data-testid="restock-detail-note-warehouse-text"
      >
        {request.warehouseNote || t("restock.detail.warehouseNoteNone")}
      </Text>
    </Stack>
  );
}

/**
 * THE WAREHOUSE'S NOTE, WRITTEN — on the warehouse's own page (the-warehouse-writes-its-own-note), edited as the selling
 * note is (NoteEditor) and kept: RestockRequestWarehouseNoteSet stores it with its writer and time, and the change goes on
 * the Riwayat. Offered wherever the page draws it — when the warehouse may write it is not decided, so no status hides it.
 */
function WarehouseNote({ request, teamId }: { request: RestockRequest; teamId: bigint }) {
  const { t } = useTranslation();
  const setNote = useSetWarehouseNote();

  async function submit(draft: string): Promise<boolean> {
    try {
      await setNote.mutateAsync({ teamId, requestId: request.id, note: draft });
      toaster.create({ type: "success", title: t("restock.notes.saved") });
      // Back to reading — the save refreshes the restock, so the saved note is what is read.
      return true;
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.notes.saveFailed"), description: rpcError(err) });
      return false;
    }
  }

  return (
    <Stack gap="2" data-testid="restock-detail-note-warehouse">
      <NoteEditor
        value={request.warehouseNote}
        head={(action) => <WarehouseNoteHead request={request} action={action} />}
        emptyText={t("restock.detail.warehouseNoteNone")}
        onSubmit={submit}
        saving={setNote.isPending}
        testId="restock-warehouse-note"
        textTestId="restock-detail-note-warehouse-text"
        ariaLabel={t("restock.notes.warehouseLabel")}
        sheetTitle={t("restock.notes.warehouseEditTitle")}
      />
    </Stack>
  );
}

/**
 * Both notes — a restock page's Catatan section. Each side changes its own from its Ubah, in place, as in the list's
 * dialog (owner: *"edit di detailnya?"*, the-note-is-edited-from-a-button); `request` is the page's by-id read.
 */
export function RestockNotes({
  request,
  teamId,
  side = "selling",
}: {
  request: RestockRequest;
  teamId: bigint;
  /** Whose page — each writer edits its own note and reads the other's. */
  side?: "selling" | "warehouse";
}) {
  return (
    <Stack gap="card">
      {side === "warehouse" ? (
        <Stack gap="2" data-testid="restock-detail-note-selling">
          <SellingNoteHead request={request} />
          <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word" data-testid="restock-detail-note">
            {request.note || "—"}
          </Text>
        </Stack>
      ) : (
        <SellingNote request={request} teamId={teamId} />
      )}

      <Separator />

      {side === "warehouse" ? <WarehouseNote request={request} teamId={teamId} /> : <WarehouseNoteBlock request={request} />}
    </Stack>
  );
}
