import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Separator, Stack, Text } from "@chakra-ui/react";

import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { SellingNote } from "./SellingNote";

// A RESTOCK'S NOTES, ONE PER WRITER (owner, shown three sources — the restock's, the warehouse's, the system's: *"boleh"*;
// the-notes-are-one-per-writer):
//
//   [Penjual]  Ani Rahayu · 29 Okt 13:05 ⚠       the selling team's note on the restock — real
//   Urgent, untuk sale 10.10
//   ─────────────────────────
//   [Gudang] ⚠                                    the warehouse's note on the restock — not stored anywhere yet
//   Belum ada catatan dari gudang.
//
// The SYSTEM's voice is the Riwayat, not a third note: it already says every move, who and when. Shared by the restock's
// page and the list's Catatan dialog (the-list-opens-the-notes-in-a-dialog); each passes the marks from its own pending
// list, so a badge's number is that screen's.

/**
 * THE WAREHOUSE'S NOTE — when it may be written (from the box's arrival, the owner's leaning, *"harusnya mulai dari
 * tiba"*) is not the owner's to decide; nothing stores it yet, so it is shown, marked, and says so.
 */
export function WarehouseNoteBlock({ mark }: { mark?: ReactNode }) {
  const { t } = useTranslation();

  return (
    <Stack gap="1" data-testid="restock-detail-note-warehouse">
      <HStack gap="2">
        <TeamTypeBadge type={TeamType.WAREHOUSE} />
        {mark}
      </HStack>
      <Text fontSize="sm" color="fg.muted">
        {t("restock.detail.warehouseNoteNone")}
      </Text>
    </Stack>
  );
}

/**
 * Both notes — the restock page's Catatan section. The selling team's is changed from its Ubah, in place, as in the list's
 * dialog (owner: *"edit di detailnya?"*, the-note-is-edited-from-a-button); `request` is the page's by-id read.
 */
export function RestockNotes({
  request,
  teamId,
  sellingByMark,
  warehouseMark,
  lateMark,
}: {
  request: RestockRequest;
  teamId: bigint;
  /** ⚠ — who and when are the restock's last raise or edit, not the note's own. */
  sellingByMark?: ReactNode;
  /** ⚠ — the warehouse's note has no field yet. */
  warehouseMark?: ReactNode;
  /** ⚠ — an edit past the restock's way is thrown away. */
  lateMark?: ReactNode;
}) {
  return (
    <Stack gap="card">
      <SellingNote request={request} teamId={teamId} mark={sellingByMark} lateMark={lateMark} />

      <Separator />

      <WarehouseNoteBlock mark={warehouseMark} />
    </Stack>
  );
}
