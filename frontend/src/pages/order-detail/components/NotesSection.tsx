import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Box, Button, Flex, Icon, IconButton, Stack, Text, Textarea } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Cog, Pencil, UserRound } from "lucide-react";

import { formatUnixDateTime } from "../../../lib/datetime";
import type { OrderNote } from "../notesMock";
import { SectionEmpty } from "./Section";

// THE ORDER'S NOTES — a list, two kinds, and the person's ones editable (owner: *"catatan harusnya bisa
// diedit, catatan bisa lebih dari 1 dan catatan itu ada tipenya, dari sistem dan dari user"*).
//
// ⚠ NEWEST FIRST, COMPOSER ON TOP. A note here is usually an instruction to the people packing, and the
// latest one is the one that governs — "kirim sebelum jam 3" written after "titip bubble wrap" does not
// cancel it, but it is what somebody needs to read first.
//
// ⚠ THE TWO KINDS LOOK DIFFERENT AT A GLANCE. A system note is a RECORD (a gear, "Sistem", muted text);
// a user note is a REQUEST (a person's name, full-strength text). Drawn alike, the app's lines would
// read as if somebody had typed them.
//
// ⚠ A SYSTEM NOTE HAS NO PENCIL. It records what happened; letting a person edit it is letting them
// rewrite history. Absent, not greyed — the house rule.
//
// ⚠ NOTHING HERE PERSISTS. `Order` carries ONE note string, with no list, no type, no author and no edit
// RPC — so adding and editing work on this screen only and are gone on reload. That is the `notes` mark
// (kind `dropped`: typed and thrown away), and it is why this component keeps its own state.
export function NotesSection({
  initial,
  addMark,
}: {
  initial: OrderNote[];
  /** ⚠ beside the add button — a note added here is gone on reload. */
  addMark?: ReactNode;
}) {
  const { t } = useTranslation();

  const [notes, setNotes] = useState<OrderNote[]>(initial);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const sorted = useMemo(() => [...notes].sort((a, b) => Number(b.at - a.at)), [notes]);

  function add() {
    const text = draft.trim();

    if (!text) {
      return;
    }

    setNotes((list) => [
      ...list,
      {
        id: `new-${Date.now()}`,
        kind: "user",
        author: t("orderDetail.notes.you"),
        at: BigInt(Math.floor(Date.now() / 1000)),
        text,
      },
    ]);
    setDraft("");
  }

  function save() {
    if (!editing || !editing.text.trim()) {
      return;
    }

    setNotes((list) =>
      list.map((note) => (note.id === editing.id ? { ...note, text: editing.text.trim() } : note)),
    );
    setEditing(null);
  }

  return (
    <Stack gap="card">
      <Stack gap="2" data-testid="notes-composer">
        <Textarea
          value={draft}
          rows={2}
          placeholder={t("orderDetail.notes.placeholder")}
          aria-label={t("orderDetail.notes.placeholder")}
          data-testid="notes-input"
          onChange={(e) => setDraft(e.target.value)}
        />
        <Flex gap="2" align="center" alignSelf="flex-end">
          {addMark}
          <Button
            colorPalette="brand"
            disabled={draft.trim() === ""}
            data-testid="notes-add"
            onClick={add}
          >
            {t("orderDetail.notes.add")}
          </Button>
        </Flex>
      </Stack>

      {sorted.length === 0 ? (
        <SectionEmpty>{t("orderDetail.notes.empty")}</SectionEmpty>
      ) : (
        <Stack gap="3" data-testid="notes-list">
          {sorted.map((note) => {
            const system = note.kind === "system";
            const isEditing = editing?.id === note.id;

            return (
              <Flex key={note.id} gap="3" align="start" data-testid={`note-${note.kind}`}>
                <Box pt="0.5" flexShrink="0">
                  <Icon
                    as={system ? Cog : UserRound}
                    boxSize="4"
                    color={system ? "fg.subtle" : "fg.muted"}
                  />
                </Box>

                <Stack gap="1" flex="1" minW="0">
                  <Flex gap="2" align="center" wrap="wrap">
                    <Text fontSize="sm" fontWeight="bold" color={system ? "fg.muted" : undefined}>
                      {system ? t("orderDetail.notes.system") : note.author}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {formatUnixDateTime(note.at)}
                    </Text>
                  </Flex>

                  {isEditing ? (
                    <Stack gap="2">
                      <Textarea
                        value={editing.text}
                        rows={2}
                        aria-label={t("orderDetail.notes.edit")}
                        data-testid="note-edit-input"
                        onChange={(e) => setEditing({ id: note.id, text: e.target.value })}
                      />
                      <Flex gap="2" justify="flex-end">
                        <Button variant="ghost" data-testid="note-edit-cancel" onClick={() => setEditing(null)}>
                          {t("orderDetail.notes.cancel")}
                        </Button>
                        <Button
                          colorPalette="brand"
                          disabled={editing.text.trim() === ""}
                          data-testid="note-edit-save"
                          onClick={save}
                        >
                          {t("orderDetail.notes.save")}
                        </Button>
                      </Flex>
                    </Stack>
                  ) : (
                    <Text
                      whiteSpace="pre-wrap"
                      color={system ? "fg.muted" : undefined}
                      data-testid="note-text"
                    >
                      {note.text}
                    </Text>
                  )}
                </Stack>

                {!system && !isEditing && (
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={t("orderDetail.notes.edit")}
                    data-testid="note-edit"
                    onClick={() => setEditing({ id: note.id, text: note.text })}
                  >
                    <Icon as={Pencil} boxSize="4" />
                  </IconButton>
                )}
              </Flex>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
