import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, HStack, Icon } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../../api/clients";
import type { SupplierChannelRecord } from "../../../features/suppliers/adapt";
import { ChannelBrowser } from "../../../features/suppliers/ChannelBrowser";
import { useDeleteSupplierChannel } from "../../../features/suppliers/queries";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { toaster } from "../../../components/feedback/Toaster";
import { SupplierChannelFormDialog } from "./SupplierChannelFormDialog";

// ChannelsPanel is the MANAGE detail's Channels tab: the shared ChannelBrowser over the supplier, with what only
// the team that keeps it may do — Add Channel, and Edit / Delete on each row. Reads cross teams and writes do not,
// so the page decides `canManage` (its own team's supplier, and a selling team); the discover detail mounts the
// same browser read-only.
export function ChannelsPanel({
  teamId,
  supplierId,
  canManage,
}: {
  teamId: bigint;
  supplierId: bigint;
  /** The current team keeps this supplier — only then may it add, edit or delete a store. */
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<SupplierChannelRecord | null>(null);
  const deleteChannel = useDeleteSupplierChannel();

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function removeChannel(channel: SupplierChannelRecord) {
    try {
      await deleteChannel.mutateAsync({ teamId, channelId: channel.id });
      toaster.create({ type: "success", title: t("supplierChannel.deleted", { name: channel.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("supplierChannel.deleteFailed"), description: rpcError(err) });
    }
  }

  // Edit and Delete, LABELLED buttons as on the supplier list's rows (owner: *"di channel, aksi ada namanya"*,
  // `a-channel-action-is-labelled`) — the same pair on a table row and at a phone block's foot.
  function rowActions(ch: SupplierChannelRecord) {
    return (
      <HStack justify="end" gap="1.5">
        <Button size="xs" variant="outline" data-testid={`edit-channel-${ch.id}`} onClick={() => setEditing(ch)}>
          <Icon as={Pencil} boxSize="4" />
          {t("supplierChannel.editAction")}
        </Button>

        <ConfirmDialog
          title={t("supplierChannel.deleteTitle")}
          message={t("supplierChannel.deleteConfirm", { name: ch.name })}
          confirmLabel={t("supplierChannel.delete")}
          onConfirm={() => removeChannel(ch)}
          trigger={
            <Button size="xs" variant="outline" colorPalette="error" data-testid={`delete-channel-${ch.id}`}>
              <Icon as={Trash2} boxSize="4" />
              {t("supplierChannel.delete")}
            </Button>
          }
        />
      </HStack>
    );
  }

  return (
    <>
      <ChannelBrowser
        teamId={teamId}
        supplierId={supplierId}
        actions={canManage ? <SupplierChannelFormDialog supplierId={supplierId} /> : undefined}
        rowActions={canManage ? rowActions : undefined}
      />

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per channel. */}
      {editing && (
        <SupplierChannelFormDialog
          key={editing.id.toString()}
          supplierId={supplierId}
          channel={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </>
  );
}
