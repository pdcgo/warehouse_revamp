import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, HStack, Separator, Stack, Text } from "@chakra-ui/react";

import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { toaster } from "../../components/feedback/Toaster";
import { NoteEditor } from "./NoteEditor";
import { SellingNote, SellingNoteHead } from "./SellingNote";

// A RESTOCK'S NOTES, ONE PER WRITER (owner, shown three sources — the restock's, the warehouse's, the system's: *"boleh"*;
// the-notes-are-one-per-writer):
//
//   [Penjual]  Ani Rahayu · 29 Okt 13:05 ⚠       the selling team's note on the restock — real
//   Urgent, untuk sale 10.10
//   ─────────────────────────
//   [Gudang] ⚠                                    the warehouse's note on the restock — not stored anywhere yet
//   Belum ada catatan dari gudang.
//
// EACH WRITER EDITS ITS OWN, AND ONLY ITS OWN (owner: *"bisa mengubah catatan warehouse"*,
// the-warehouse-writes-its-own-note): on the selling team's page Ubah sits on the selling note; on the warehouse's
// (`side="warehouse"`) on the warehouse's, the selling one read. The SYSTEM's voice is the Riwayat, not a third note.
// Shared by both restock pages and the list's Catatan dialog; each passes the marks from its own pending list.

/** The warehouse's head line — its badge, the mark, and an action at its end. */
function WarehouseNoteHead({ mark, action }: { mark?: ReactNode; action?: ReactNode }) {
  return (
    <HStack gap="2" wrap="wrap">
      <TeamTypeBadge type={TeamType.WAREHOUSE} />
      {mark}
      {action && <Box ms="auto">{action}</Box>}
    </HStack>
  );
}

/**
 * THE WAREHOUSE'S NOTE, READ — on the selling team's side. When it may be written (from the box's arrival, the owner's
 * leaning, *"harusnya mulai dari tiba"*) is not the owner's to decide; nothing stores it yet, so it is shown, marked, and
 * says so.
 */
export function WarehouseNoteBlock({ mark }: { mark?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <Stack gap="1" data-testid="restock-detail-note-warehouse">
      <WarehouseNoteHead mark={mark} />
      <Text fontSize="sm" color="fg.muted">
        {t("restock.detail.warehouseNoteNone")}
      </Text>
    </Stack>
  );
}

/**
 * THE WAREHOUSE'S NOTE, WRITTEN — on the warehouse's own page (the-warehouse-writes-its-own-note), edited as the selling
 * note is (NoteEditor). ⚠ Nothing stores it (`dropped`): a save says so, and the note reads empty again.
 */
function WarehouseNote({ mark }: { mark?: ReactNode }) {
  const { t } = useTranslation();

  async function submit(): Promise<boolean> {
    toaster.create({ type: "info", title: t("restock.notes.warehouseNotStored") });
    return true;
  }

  return (
    <Stack gap="2" data-testid="restock-detail-note-warehouse">
      <NoteEditor
        value=""
        head={(action) => <WarehouseNoteHead mark={mark} action={action} />}
        emptyText={t("restock.detail.warehouseNoteNone")}
        onSubmit={submit}
        saving={false}
        testId="restock-warehouse-note"
        textTestId="restock-detail-note-warehouse-text"
        ariaLabel={t("restock.notes.warehouseLabel")}
        sheetTitle={t("restock.notes.warehouseEditTitle")}
      />
    </Stack>
  );
}

/**
 * Both notes — a restock page's Catatan section. The selling team's is changed from its Ubah, in place, as in the list's
 * dialog (owner: *"edit di detailnya?"*, the-note-is-edited-from-a-button); `request` is the page's by-id read.
 */
export function RestockNotes({
  request,
  teamId,
  sellingByMark,
  warehouseMark,
  lateMark,
  side = "selling",
}: {
  request: RestockRequest;
  teamId: bigint;
  /** ⚠ — who and when are the restock's last raise or edit, not the note's own. */
  sellingByMark?: ReactNode;
  /** ⚠ — the warehouse's note has no field yet: read, it is missing; written, it is thrown away. */
  warehouseMark?: ReactNode;
  /** ⚠ — a selling team's edit past the restock's way is thrown away. */
  lateMark?: ReactNode;
  /** Whose page — each writer edits its own note and reads the other's. */
  side?: "selling" | "warehouse";
}) {
  return (
    <Stack gap="card">
      {side === "warehouse" ? (
        <Stack gap="2" data-testid="restock-detail-note-selling">
          <SellingNoteHead request={request} mark={sellingByMark} />
          <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word" data-testid="restock-detail-note">
            {request.note || "—"}
          </Text>
        </Stack>
      ) : (
        <SellingNote request={request} teamId={teamId} mark={sellingByMark} lateMark={lateMark} />
      )}

      <Separator />

      {side === "warehouse" ? <WarehouseNote mark={warehouseMark} /> : <WarehouseNoteBlock mark={warehouseMark} />}
    </Stack>
  );
}
