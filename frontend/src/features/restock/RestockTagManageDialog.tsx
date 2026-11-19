import { useState } from "react";
import { Button, CloseButton, Dialog, Flex, HStack, Icon, IconButton, Input, Portal, Span, Stack, Text } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { useIsMobile } from "../../layouts/shell";
import { RestockTagChip } from "./RestockTagChips";
import type { RestockTag } from "./restockTags";
import { isAppTag, tagNamed } from "./restockTags";
import type { RestockTagsApi } from "./tagQueries";
import { useRestockTagUsage } from "./tagQueries";

// THE APP-WIDE TAG LIST, AS AN ADMIN MANAGES IT (backlog #87, live: RestockTagManageList, RestockTagRename, RestockTagDelete). The owner, 2026-11-18 (a 🔄 line under
// custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): a team's user makes a custom tag and puts it on / takes
// it off a restock; RENAMING and DELETING a tag in the shared list is for ADMINS only — Root / the Administrator, the same
// people who manage the system tags. So this dialog opens only for them (the Tags box's *Kelola tag*), and a team's user
// has no rename or delete anywhere.
//
//   ┌ Kelola tag ─────────────────────────────────── × ┐
//   │ Tag semua tim. Mengganti nama atau menghapus …    │
//   │ [🔒 Diperiksa Admin]          2 restok   ✎  🗑     │
//   │ [Barang Promo]                1 restok   ✎  🗑     │
//   │ [Lebaran 2026 ______] [Simpan] [Batal]           │   ← a rename, in place
//   └───────────────────────────────────────────────────┘
//
// A rename keeps one name to one tag: a name another tag already carries, in any case, is refused in place. A delete
// confirms first and says how many restocks it comes off — every team's. The APP's own tags (the problem tags) are
// listed but not renamed or deleted: the app puts them on, and when they come off is not decided
// (a-restock-problem-is-a-system-tag).

export function RestockTagManageDialog({
  api,
  open,
  onOpenChange,
}: {
  api: RestockTagsApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<bigint | null>(null);
  const [deleting, setDeleting] = useState<RestockTag | null>(null);
  // How many restocks carry each tag, every team's — read while the dialog is open (RestockTagManageList).
  const usageOf = useRestockTagUsage(open);
  const usage = (tagId: bigint) => usageOf.data?.get(tagId.toString()) ?? 0;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => {
        onOpenChange(e.open);
        if (!e.open) setEditing(null);
      }}
      size={isMobile ? "full" : "md"}
      closeOnInteractOutside={editing === null}
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="restock-tag-manage-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("restock.tags.manage.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {t("restock.tags.manage.hint")}
                </Text>
                <Stack gap="0" divideY="1px" data-testid="restock-tag-manage-list">
                  {api.catalogue.map((tag) =>
                    editing === tag.id ? (
                      <RenameRow key={tag.id.toString()} tag={tag} api={api} onDone={() => setEditing(null)} />
                    ) : (
                      <Flex
                        key={tag.id.toString()}
                        align="center"
                        gap="2"
                        py="2"
                        data-testid={`restock-tag-manage-row-${tag.id}`}
                      >
                        <Flex flex="1" minW="0">
                          <RestockTagChip tag={tag} maxW="full" />
                        </Flex>
                        <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`restock-tag-manage-usage-${tag.id}`}>
                          {t("restock.tags.manage.usage", { count: usage(tag.id) })}
                        </Span>
                        {isAppTag(tag) ? (
                          <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`restock-tag-manage-app-${tag.id}`}>
                            {t("restock.tags.byApp")}
                          </Span>
                        ) : (
                          <>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("restock.tags.manage.rename", { name: tag.name })}
                              title={t("restock.tags.manage.rename", { name: tag.name })}
                              onClick={() => setEditing(tag.id)}
                              data-testid={`restock-tag-manage-rename-${tag.id}`}
                            >
                              <Icon as={Pencil} boxSize="4" />
                            </IconButton>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              colorPalette="error"
                              aria-label={t("restock.tags.manage.delete", { name: tag.name })}
                              title={t("restock.tags.manage.delete", { name: tag.name })}
                              onClick={() => setDeleting(tag)}
                              data-testid={`restock-tag-manage-delete-${tag.id}`}
                            >
                              <Icon as={Trash2} boxSize="4" />
                            </IconButton>
                          </>
                        )}
                      </Flex>
                    ),
                  )}
                </Stack>
              </Stack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>

      {/* THE DELETE ASKS FIRST, and says what it does — the tag comes off every restock that carries it, every team's. */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t("restock.tags.manage.deleteTitle", { name: deleting?.name ?? "" })}
        message={
          deleting && usage(deleting.id) > 0
            ? t("restock.tags.manage.deleteMessage", { count: usage(deleting.id) })
            : t("restock.tags.manage.deleteMessageNone")
        }
        confirmLabel={t("restock.tags.manage.deleteConfirm")}
        onConfirm={async () => {
          if (deleting) await api.drop(deleting.id);
          setDeleting(null);
        }}
      />
    </Dialog.Root>
  );
}

/** One tag's name, edited in place — Simpan keeps it, Batal (or Escape) puts the row back. */
function RenameRow({ tag, api, onDone }: { tag: RestockTag; api: RestockTagsApi; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(tag.name);
  const [taken, setTaken] = useState(false);

  // A name another tag already carries (any case) is said here at once, and by the server's AlreadyExists if the list
  // on screen had not caught up yet; any other refusal is a toast.
  const save = async () => {
    const clash = tagNamed(api.catalogue, name);
    if (clash && clash.id !== tag.id) {
      setTaken(true);
      return;
    }

    const outcome = await api.rename(tag.id, name);
    if (outcome === "renamed") onDone();
    if (outcome === "taken") setTaken(true);
  };

  return (
    <Stack gap="1" py="2" data-testid={`restock-tag-manage-row-${tag.id}`}>
      <HStack gap="2">
        <Input
          value={name}
          autoFocus
          aria-label={t("restock.tags.manage.rename", { name: tag.name })}
          onChange={(e) => {
            setName(e.target.value);
            setTaken(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              e.stopPropagation();
              onDone();
            }
          }}
          data-testid="restock-tag-manage-name-input"
        />
        <Button colorPalette="brand" disabled={name.trim() === ""} onClick={() => void save()} data-testid="restock-tag-manage-save">
          {t("restock.tags.manage.save")}
        </Button>
        <Button variant="outline" onClick={onDone} data-testid="restock-tag-manage-cancel">
          {t("common.cancel")}
        </Button>
      </HStack>
      {taken && (
        <Text fontSize="xs" color="error.fg" data-testid="restock-tag-manage-taken">
          {t("restock.tags.manage.taken")}
        </Text>
      )}
    </Stack>
  );
}
