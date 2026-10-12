import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, HStack, Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { rpcError } from "../../../api/clients";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { toaster } from "../../../components/feedback/Toaster";
import type { SupplierRecord } from "../../../features/suppliers/adapt";
import { useDeleteSupplier } from "../../../features/suppliers/queries";
import { SupplierFormDialog } from "../../../features/suppliers/SupplierFormDialog";

// THE SUPPLIER'S OWN ACTIONS, on its page — Ubah and Hapus, the list row's pair (`a-supplier-action-is-labelled`), until
// now offered on the list alone. A desktop shows them as labelled buttons beside the name; a phone folds them into ⋯,
// so its header stays one row (`the-phone-header-is-one-row`). Hapus confirms, keeps the supplier for its figures
// (a-deleted-supplier-is-kept-for-its-figures), and goes back to the list — the page it was on no longer opens.
export function SupplierHeaderActions({
  teamId,
  supplier,
  folded,
}: {
  teamId: bigint;
  supplier: SupplierRecord;
  /** On a phone: everything in a ⋯ menu. */
  folded: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deleteSupplier = useDeleteSupplier();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `mutateAsync` — ConfirmDialog awaits it to hold its button busy; a failure is caught and said.
  async function remove() {
    try {
      await deleteSupplier.mutateAsync({ teamId, supplierId: supplier.id });
      toaster.create({ type: "success", title: t("suppliers.deleted", { name: supplier.name }) });
      navigate("/inventories/suppliers");
    } catch (err) {
      toaster.create({ type: "error", title: t("suppliers.deleteFailed"), description: rpcError(err) });
    }
  }

  return (
    <>
      {folded ? (
        <Menu.Root positioning={{ placement: "bottom-end" }}>
          <Menu.Trigger asChild>
            <IconButton size="sm" variant="ghost" aria-label={t("suppliers.actions")} data-testid="supplier-detail-menu">
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="edit" data-testid="supplier-detail-edit" onClick={() => setEditing(true)}>
                  <Icon as={Pencil} boxSize="4" />
                  {t("suppliers.editAction")}
                </Menu.Item>
                <Menu.Item value="delete" color="fg.error" data-testid="supplier-detail-delete" onClick={() => setDeleting(true)}>
                  <Icon as={Trash2} boxSize="4" />
                  {t("suppliers.delete")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      ) : (
        <HStack gap="1.5" flexShrink={0}>
          <Button size="xs" variant="outline" data-testid="supplier-detail-edit" onClick={() => setEditing(true)}>
            <Icon as={Pencil} boxSize="4" />
            {t("suppliers.editAction")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            colorPalette="error"
            data-testid="supplier-detail-delete"
            onClick={() => setDeleting(true)}
          >
            <Icon as={Trash2} boxSize="4" />
            {t("suppliers.delete")}
          </Button>
        </HStack>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("suppliers.deleteSupplier")}
        message={t("suppliers.deleteConfirm", { name: supplier.name })}
        confirmLabel={t("suppliers.delete")}
        onConfirm={remove}
      />

      {editing && (
        <SupplierFormDialog supplier={supplier} open onOpenChange={(open) => !open && setEditing(false)} />
      )}
    </>
  );
}
