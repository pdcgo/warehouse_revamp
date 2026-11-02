import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Box, Button, CloseButton, Drawer, Field, HStack, Icon, Portal, Stack, Text, Textarea } from "@chakra-ui/react";
import { Pencil } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../../components/badges/TeamTypeBadge";
import { toaster } from "../../components/feedback/Toaster";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { useRestockActors, useSaveRestockRequest } from "./queries";

/** The selling team's head line — its badge, who and when, the mark on them, and an action at its end. */
export function SellingNoteHead({ request, mark, action }: { request: RestockRequest; mark?: ReactNode; action?: ReactNode }) {
  // WHO WROTE IT, AND WHEN — the last raise or edit of the restock. Nothing stores the note's own author or time, so
  // this is the nearest real figure, and it is marked (`derived`): an edit that changed only a line counts too.
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

/** The longest the selling team's note may be — the contract's `max_len`. */
export const MAX_NOTE = 1000;

// THE SELLING TEAM'S NOTE, READ — AND CHANGED FROM A BUTTON, IN PLACE (the-note-is-edited-from-a-button). One component
// for the list's Catatan dialog and the restock page's Catatan section (owner: *"edit di detailnya?"*), so the two edit
// the same way:
//
//   [Penjual]  Ani Rahayu · 29 Okt 13:05 ⚠          [✎ Ubah]        ← in any status; ⚠ past its way, where it is not kept
//   Untuk promo 10.10
//        ↓ Ubah
//   ┌──────────────────────────────────────┐  ← the focus is in it
//   │ Untuk promo 10.10                    │
//   └──────────────────────────────────────┘
//                                   17/1000
//                         [Batal] [Simpan Catatan]
//        ↓ Simpan — back to reading, the saved note in place (owner: *"close saat save maksudku"*)
//
// ON A PHONE THE EDIT IS A SHEET (owner: *"edit catatan di mobile tidak bagus"*, a-phone-edits-the-note-in-a-sheet). In
// the middle of a long page the textarea shared a phone's height with the sticky title, the section chips and the
// keyboard, and its Batal / Simpan were two small buttons in a corner. So Ubah opens a bottom sheet of its own — the
// title, the textarea, the count, and Batal | Simpan as two equal halves. Where the note already sits in a dialog
// (`inPlace`, the list's Catatan) it is edited where it is: a sheet over a dialog is one surface too many — only the
// buttons take the two halves.
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
  const isMobile = useIsMobile();
  const inSheet = isMobile && !inPlace;
  const [draft, setDraft] = useState("");
  const [editing, setEditingState] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // THE NOTE IS EDITED IN ANY STATUS (owner: *"catatan bisa diedit kapanpun"*, the-note-is-edited-in-any-status) — Ubah is
  // always there. Only while the restock is on its way does the server take it: after that the head of a restock is
  // closed, the note with it, so a save is thrown away, said so, and marked.
  const storable = request.status === RestockRequestStatus.ONGOING;
  const changed = draft.trim() !== request.note.trim();

  const setEditing = (next: boolean) => {
    setEditingState(next);
    onEditingChange?.(next);
  };

  // UBAH OPENS THE EDIT IN PLACE. Ubah itself leaves the page as it is pressed, and the focus it held would fall outside
  // a dialog, which a dialog reads as the reader leaving — so the textarea is drawn at once (flushSync) and takes the
  // focus in the same click. A sheet focuses it itself, as it opens (`initialFocusEl`).
  const startEditing = () => {
    if (inSheet) {
      setDraft(request.note);
      setEditing(true);
      return;
    }
    flushSync(() => {
      setDraft(request.note);
      setEditing(true);
    });
    const el = input.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  };

  async function submit() {
    if (!changed) return;

    if (!storable) {
      toaster.create({ type: "info", title: t("restock.notes.notStored") });
      setEditing(false);
      return;
    }

    try {
      await save.mutateAsync({ requestId: request.id, fields: unchangedBut(request, teamId, draft.trim()) });
      toaster.create({ type: "success", title: t("restock.notes.saved") });
      // Back to reading — the save refreshes the restock, so the saved note is what is read.
      setEditing(false);
    } catch (err) {
      toaster.create({ type: "error", title: t("restock.notes.saveFailed"), description: rpcError(err) });
    }
  }

  // The edit's own field — in place, or in the phone's sheet.
  const field = (
    <Field.Root>
      <Textarea
        ref={input}
        value={draft}
        maxLength={MAX_NOTE}
        rows={isMobile ? 5 : 4}
        autoresize
        // An example, not a label (every-form-field-shows-an-example).
        placeholder={t("restock.form.notePlaceholder")}
        aria-label={t("restock.notes.sellingLabel")}
        data-testid="restock-notes-input"
        onChange={(e) => setDraft(e.target.value)}
      />
      {/* How much of the limit is used (a-limited-field-shows-its-count). */}
      <Field.HelperText alignSelf="end" data-testid="restock-notes-count">
        {draft.length}/{MAX_NOTE}
      </Field.HelperText>
    </Field.Root>
  );

  // Batal leaves the edit — the note as it was; Simpan saves and goes back to reading. On a phone they are two equal
  // halves of the width, under the thumb; on a desktop, two buttons at the end.
  const halves = isMobile ? "1" : undefined;
  const buttons = (
    <HStack gap="2" justify="end" w={isMobile ? "full" : undefined}>
      <Button variant="outline" flex={halves} data-testid="restock-notes-cancel-edit" onClick={() => setEditing(false)}>
        {t("common.cancel")}
      </Button>
      <Button
        colorPalette="brand"
        flex={halves}
        disabled={!changed}
        loading={save.isPending}
        data-testid="restock-notes-save"
        onClick={() => void submit()}
      >
        {t("restock.notes.save")}
      </Button>
    </HStack>
  );

  const editingHere = editing && !inSheet;

  return (
    <Stack gap="2" data-testid="restock-detail-note-selling">
      <SellingNoteHead
        request={request}
        mark={mark}
        action={
          !editingHere ? (
            <HStack gap="1">
              <Button size="xs" variant="outline" data-testid="restock-notes-edit" onClick={startEditing}>
                <Icon as={Pencil} boxSize="4" />
                {t("restock.notes.edit")}
              </Button>
              {!storable && lateMark}
            </HStack>
          ) : undefined
        }
      />

      {editingHere ? (
        <Stack gap="2">
          {field}
          {buttons}
        </Stack>
      ) : (
        <Stack gap="1">
          <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word" data-testid="restock-detail-note">
            {request.note || "—"}
          </Text>
        </Stack>
      )}

      {inSheet && (
        // A tap outside does not throw a typed note away — Batal or × do.
        <Drawer.Root
          open={editing}
          onOpenChange={(e) => {
            if (!e.open) setEditing(false);
          }}
          placement="bottom"
          closeOnInteractOutside={false}
          initialFocusEl={() => input.current}
        >
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content roundedTop="l3" data-testid="restock-notes-sheet">
                <Drawer.Header>
                  <Drawer.Title>{t("restock.notes.editTitle")}</Drawer.Title>
                </Drawer.Header>
                <Drawer.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Drawer.CloseTrigger>
                <Drawer.Body>{field}</Drawer.Body>
                <Drawer.Footer>{buttons}</Drawer.Footer>
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root>
      )}
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
      sku: item.sku,
      name: item.name,
      count: item.count,
      total: item.total,
      supplierId: item.supplierId,
      supplierChannelId: item.supplierChannelId,
      note: item.note,
    })),
  };
}
