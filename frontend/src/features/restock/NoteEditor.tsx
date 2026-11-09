import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Drawer, Field, HStack, Icon, Portal, Stack, Text, Textarea } from "@chakra-ui/react";
import { Pencil } from "lucide-react";

import { useIsMobile } from "../../layouts/shell";
import { useCanWrite } from "../team/TeamContext";

/** The longest a restock note may be — the contract's `max_len`. */
export const MAX_NOTE = 1000;

// A RESTOCK NOTE, READ — AND CHANGED FROM A BUTTON, IN PLACE (the-note-is-edited-from-a-button). The one way both writers'
// notes are edited: the selling team's (SellingNote) and the warehouse's (WarehouseNote,
// the-warehouse-writes-its-own-note), so the two edit alike:
//
//   [head]                                      [✎ Ubah]
//   Untuk promo 10.10
//        ↓ Ubah
//   ┌──────────────────────────────────────┐  ← the focus is in it
//   │ Untuk promo 10.10                    │
//   └──────────────────────────────────────┘
//                                   17/1000
//                         [Batal] [Simpan Catatan]
//        ↓ Simpan — back to reading
//
// ON A PHONE THE EDIT IS A SHEET (a-phone-edits-the-note-in-a-sheet) — the title, the textarea, the count, and Batal |
// Simpan as two equal halves. Where the note already sits in a dialog (`inPlace`, the list's Catatan) it is edited where it
// is: a sheet over a dialog is one surface too many — only the buttons take the two halves.
export function NoteEditor({
  value,
  head,
  emptyText,
  onSubmit,
  saving,
  testId,
  textTestId,
  ariaLabel,
  sheetTitle,
  beside,
  onEditingChange,
  inPlace = false,
}: {
  /** The note as it stands. */
  value: string;
  /** The writer's head line, given the Ubah button to place at its end. */
  head: (action: ReactNode) => ReactNode;
  /** What an empty note reads as. */
  emptyText: ReactNode;
  /** Save the typed note — resolves true when the edit should close. */
  onSubmit: (draft: string) => Promise<boolean>;
  saving: boolean;
  /** Prefix for the controls' test ids: `<testId>-edit`, `-input`, `-count`, `-cancel-edit`, `-save`, `-sheet`. */
  testId: string;
  /** The read note's own test id. */
  textTestId: string;
  ariaLabel: string;
  sheetTitle: string;
  /** Beside Ubah — a mark that says a save here is not kept. */
  beside?: ReactNode;
  onEditingChange?: (editing: boolean) => void;
  inPlace?: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // READ, NEVER CHANGED, WHILE THE ADMIN TEAM MONITORS (the-admin-team-monitors-read-only, monitoring-keeps-what-only-reads):
  // the note is still there to read; its Ubah is a write control, so it is not offered.
  const writable = useCanWrite();
  const inSheet = isMobile && !inPlace;
  const [draft, setDraft] = useState("");
  const [editing, setEditingState] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const changed = draft.trim() !== value.trim();

  const setEditing = (next: boolean) => {
    setEditingState(next);
    onEditingChange?.(next);
  };

  // UBAH OPENS THE EDIT IN PLACE. Ubah itself leaves the page as it is pressed, and the focus it held would fall outside
  // a dialog, which a dialog reads as the reader leaving — so the textarea is drawn at once (flushSync) and takes the
  // focus in the same click. A sheet focuses it itself, as it opens (`initialFocusEl`).
  const startEditing = () => {
    if (inSheet) {
      setDraft(value);
      setEditing(true);
      return;
    }
    flushSync(() => {
      setDraft(value);
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
    if (await onSubmit(draft.trim())) setEditing(false);
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
        aria-label={ariaLabel}
        data-testid={`${testId}-input`}
        onChange={(e) => setDraft(e.target.value)}
      />
      {/* How much of the limit is used (a-limited-field-shows-its-count). */}
      <Field.HelperText alignSelf="end" data-testid={`${testId}-count`}>
        {draft.length}/{MAX_NOTE}
      </Field.HelperText>
    </Field.Root>
  );

  // Batal leaves the edit — the note as it was; Simpan saves and goes back to reading. On a phone they are two equal
  // halves of the width, under the thumb; on a desktop, two buttons at the end.
  const halves = isMobile ? "1" : undefined;
  const buttons = (
    <HStack gap="2" justify="end" w={isMobile ? "full" : undefined}>
      <Button variant="outline" flex={halves} data-testid={`${testId}-cancel-edit`} onClick={() => setEditing(false)}>
        {t("common.cancel")}
      </Button>
      <Button
        colorPalette="brand"
        flex={halves}
        disabled={!changed}
        loading={saving}
        data-testid={`${testId}-save`}
        onClick={() => void submit()}
      >
        {t("restock.notes.save")}
      </Button>
    </HStack>
  );

  const editingHere = editing && !inSheet;

  return (
    <>
      {head(
        !writable ? undefined : !editingHere ? (
          <HStack gap="1">
            <Button size="xs" variant="outline" data-testid={`${testId}-edit`} onClick={startEditing}>
              <Icon as={Pencil} boxSize="4" />
              {t("restock.notes.edit")}
            </Button>
            {beside}
          </HStack>
        ) : undefined,
      )}

      {editingHere ? (
        <Stack gap="2">
          {field}
          {buttons}
        </Stack>
      ) : (
        <Stack gap="1">
          <Text
            fontSize="sm"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            color={value ? undefined : "fg.muted"}
            data-testid={textTestId}
          >
            {value || emptyText}
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
              <Drawer.Content roundedTop="l3" data-testid={`${testId}-sheet`}>
                <Drawer.Header>
                  <Drawer.Title>{sheetTitle}</Drawer.Title>
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
    </>
  );
}
