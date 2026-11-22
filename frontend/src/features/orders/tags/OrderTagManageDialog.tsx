import { useState } from "react";
import { Button, CloseButton, Dialog, Flex, HStack, Icon, IconButton, Input, Portal, Span, Stack, Text } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { useIsMobile } from "../../../layouts/shell";
import { RestockTagChip } from "../../restock/RestockTagChips";
import type { OrderTag } from "./orderTags";
import { tagNamed } from "./orderTags";
import type { OrderTagsApi } from "./tagQueries";
import { useOrderTagUsage } from "./tagQueries";

// THE ORDERS' TAG LIST, AS AN ADMIN MANAGES IT — *Kelola tag* on an order's Tags box (backlog #100, live:
// OrderTagManageList, OrderTagRename, OrderTagDelete). A COPY of the restock's RestockTagManageDialog
// (the-restock-tags-prototype-is-accepted) over the ORDERS' own list (orders-have-their-own-tag-list), with the orders'
// test ids and words. The restock rule applied to orders by the
// owner's "A": a team's user makes a custom tag and puts it on / takes it off an order; RENAMING and DELETING a tag in the
// shared list is for ADMINS only — Root / the Administrator. So this dialog opens only for them.
//
//   ┌ Kelola tag pesanan ──────────────────────────── × ┐
//   │ Tag pesanan semua tim. Ganti nama atau hapus …     │
//   │ [🔒 Audit Admin]             1 pesanan   ✎  🗑      │
//   │ [VIP]                        2 pesanan   ✎  🗑      │
//   │ [Pelanggan VIP ______] [Simpan] [Batal]           │   ← a rename, in place
//   └────────────────────────────────────────────────────┘
//
// A rename keeps one name to one tag within the orders' list: a name another order tag already carries, in any case, is
// refused in place. A delete confirms first and says how many orders it comes off — every team's. No app-owned order tags
// exist for now, so every row has its rename and delete.

export function OrderTagManageDialog({
  api,
  open,
  onOpenChange,
}: {
  api: OrderTagsApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<bigint | null>(null);
  const [deleting, setDeleting] = useState<OrderTag | null>(null);
  // How many orders carry each tag, every team's — read while the dialog is open (OrderTagManageList).
  const usageOf = useOrderTagUsage(open);
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
          <Dialog.Content data-testid="order-tag-manage-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("orders.tags.manage.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {t("orders.tags.manage.hint")}
                </Text>
                <Stack gap="0" divideY="1px" data-testid="order-tag-manage-list">
                  {api.catalogue.map((tag) =>
                    editing === tag.id ? (
                      <RenameRow key={tag.id.toString()} tag={tag} api={api} onDone={() => setEditing(null)} />
                    ) : (
                      <Flex key={tag.id.toString()} align="center" gap="2" py="2" data-testid={`order-tag-manage-row-${tag.id}`}>
                        <Flex flex="1" minW="0">
                          <RestockTagChip tag={tag} maxW="full" />
                        </Flex>
                        <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`order-tag-manage-usage-${tag.id}`}>
                          {t("orders.tags.manage.usage", { count: usage(tag.id) })}
                        </Span>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t("orders.tags.manage.rename", { name: tag.name })}
                          title={t("orders.tags.manage.rename", { name: tag.name })}
                          onClick={() => setEditing(tag.id)}
                          data-testid={`order-tag-manage-rename-${tag.id}`}
                        >
                          <Icon as={Pencil} boxSize="4" />
                        </IconButton>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="error"
                          aria-label={t("orders.tags.manage.delete", { name: tag.name })}
                          title={t("orders.tags.manage.delete", { name: tag.name })}
                          onClick={() => setDeleting(tag)}
                          data-testid={`order-tag-manage-delete-${tag.id}`}
                        >
                          <Icon as={Trash2} boxSize="4" />
                        </IconButton>
                      </Flex>
                    ),
                  )}
                </Stack>
              </Stack>
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>

      {/* THE DELETE ASKS FIRST, and says what it does — the tag comes off every order that carries it, every team's. */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t("orders.tags.manage.deleteTitle", { name: deleting?.name ?? "" })}
        message={
          deleting && usage(deleting.id) > 0
            ? t("orders.tags.manage.deleteMessage", { count: usage(deleting.id) })
            : t("orders.tags.manage.deleteMessageNone")
        }
        confirmLabel={t("orders.tags.manage.deleteConfirm")}
        onConfirm={async () => {
          if (deleting) await api.drop(deleting.id);
          setDeleting(null);
        }}
      />
    </Dialog.Root>
  );
}

/** One tag's name, edited in place — Simpan keeps it, Batal (or Escape) puts the row back. */
function RenameRow({ tag, api, onDone }: { tag: OrderTag; api: OrderTagsApi; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(tag.name);
  const [taken, setTaken] = useState(false);

  // A name another order tag already carries (any case) is said here at once — and by the server's AlreadyExists in the
  // build, if the list on screen had not caught up yet.
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
    <Stack gap="1" py="2" data-testid={`order-tag-manage-row-${tag.id}`}>
      <HStack gap="2">
        <Input
          value={name}
          autoFocus
          aria-label={t("orders.tags.manage.rename", { name: tag.name })}
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
          data-testid="order-tag-manage-name-input"
        />
        <Button colorPalette="brand" disabled={name.trim() === ""} onClick={() => void save()} data-testid="order-tag-manage-save">
          {t("orders.tags.manage.save")}
        </Button>
        <Button variant="outline" onClick={onDone} data-testid="order-tag-manage-cancel">
          {t("common.cancel")}
        </Button>
      </HStack>
      {taken && (
        <Text fontSize="xs" color="error.fg" data-testid="order-tag-manage-taken">
          {t("orders.tags.manage.taken")}
        </Text>
      )}
    </Stack>
  );
}
