import { useState } from "react";
import { Button, CloseButton, Dialog, Flex, HStack, Icon, IconButton, Input, Portal, Span, Stack, Text } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { useIsMobile } from "../../../layouts/shell";
import { RestockTagChip } from "../../restock/RestockTagChips";
import type { ProductTag, ProductTagsApi } from "./productTags";
import { isAppTag, tagNamed } from "./productTags";
import { useProductTagUsage } from "./tagQueries";

// THE PRODUCTS' TAG LIST, AS AN ADMIN MANAGES IT — *Kelola tag produk* on a product's Tags box (backlog #148, live:
// ProductTagManageList, ProductTagRename, ProductTagDelete). A COPY of the restock's
// RestockTagManageDialog (the-restock-tags-prototype-is-accepted) over the PRODUCTS' own list
// (products-have-their-own-tag-list), with the products' test ids and words: renaming and deleting a tag is for ADMINS
// only — Root / the Administrator — so this dialog opens only for them.
//
//   ┌ Kelola tag produk ───────────────────────────── × ┐
//   │ Tag produk semua tim. Ganti nama atau hapus …      │
//   │ [🔒 need_reprint_code]   2 produk   Dipasang aplikasi│   ← the app's own: listed, never renamed or deleted
//   │ [Promo Lebaran]          2 produk   ✎  🗑            │
//   │ [Laris ______] [Simpan] [Batal]                     │   ← a rename, in place
//   └────────────────────────────────────────────────────┘
//
// A rename keeps one name to one tag within the products' list: a name another product tag already carries, in any
// case, is refused in place. A delete confirms first and says how many products it comes off — every team's. The APP's
// own tag (`need_reprint_code`) is listed but never renamed or deleted: the team code change puts it on and the
// warehouses' reprint takes it off (products-have-their-own-tag-list, 🔄 *what clears*).

export function ProductTagManageDialog({
  api,
  open,
  onOpenChange,
}: {
  api: ProductTagsApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<bigint | null>(null);
  const [deleting, setDeleting] = useState<ProductTag | null>(null);
  // How many products carry each tag, every team's — read while the dialog is open (ProductTagManageList).
  const usageOf = useProductTagUsage(open);
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
          <Dialog.Content data-testid="product-tag-manage-dialog">
            <Dialog.Header>
              <Dialog.Title>{t("products.tags.manage.title")}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>

            <Dialog.Body>
              <Stack gap="card">
                <Text fontSize="sm" color="fg.muted">
                  {t("products.tags.manage.hint")}
                </Text>
                <Stack gap="0" divideY="1px" data-testid="product-tag-manage-list">
                  {api.catalogue.map((tag) =>
                    editing === tag.id ? (
                      <RenameRow key={tag.id.toString()} tag={tag} api={api} onDone={() => setEditing(null)} />
                    ) : (
                      <Flex
                        key={tag.id.toString()}
                        align="center"
                        gap="2"
                        py="2"
                        data-testid={`product-tag-manage-row-${tag.id}`}
                      >
                        <Flex flex="1" minW="0">
                          <RestockTagChip tag={tag} maxW="full" />
                        </Flex>
                        <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`product-tag-manage-usage-${tag.id}`}>
                          {t("products.tags.manage.usage", { count: usage(tag.id) })}
                        </Span>
                        {isAppTag(tag) ? (
                          <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`product-tag-manage-app-${tag.id}`}>
                            {t("products.tags.byApp")}
                          </Span>
                        ) : (
                          <>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("products.tags.manage.rename", { name: tag.name })}
                              title={t("products.tags.manage.rename", { name: tag.name })}
                              onClick={() => setEditing(tag.id)}
                              data-testid={`product-tag-manage-rename-${tag.id}`}
                            >
                              <Icon as={Pencil} boxSize="4" />
                            </IconButton>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              colorPalette="error"
                              aria-label={t("products.tags.manage.delete", { name: tag.name })}
                              title={t("products.tags.manage.delete", { name: tag.name })}
                              onClick={() => setDeleting(tag)}
                              data-testid={`product-tag-manage-delete-${tag.id}`}
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

      {/* THE DELETE ASKS FIRST, and says what it does — the tag comes off every product that carries it, every team's. */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t("products.tags.manage.deleteTitle", { name: deleting?.name ?? "" })}
        message={
          deleting && usage(deleting.id) > 0
            ? t("products.tags.manage.deleteMessage", { count: usage(deleting.id) })
            : t("products.tags.manage.deleteMessageNone")
        }
        confirmLabel={t("products.tags.manage.deleteConfirm")}
        onConfirm={async () => {
          if (deleting) await api.drop(deleting.id);
          setDeleting(null);
        }}
      />
    </Dialog.Root>
  );
}

/** One tag's name, edited in place — Simpan keeps it, Batal (or Escape) puts the row back. */
function RenameRow({ tag, api, onDone }: { tag: ProductTag; api: ProductTagsApi; onDone: () => void }) {
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
    <Stack gap="1" py="2" data-testid={`product-tag-manage-row-${tag.id}`}>
      <HStack gap="2">
        <Input
          value={name}
          autoFocus
          aria-label={t("products.tags.manage.rename", { name: tag.name })}
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
          data-testid="product-tag-manage-name-input"
        />
        <Button colorPalette="brand" disabled={name.trim() === ""} onClick={() => void save()} data-testid="product-tag-manage-save">
          {t("products.tags.manage.save")}
        </Button>
        <Button variant="outline" onClick={onDone} data-testid="product-tag-manage-cancel">
          {t("common.cancel")}
        </Button>
      </HStack>
      {taken && (
        <Text fontSize="xs" color="error.fg" data-testid="product-tag-manage-taken">
          {t("products.tags.manage.taken")}
        </Text>
      )}
    </Stack>
  );
}
