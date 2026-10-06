import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Icon, IconButton } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../../api/clients";
import type { SupplierChannelRecord } from "../../../features/suppliers/adapt";
import { ChannelBrowser } from "../../../features/suppliers/ChannelBrowser";
import { useDeleteSupplierChannel, useSupplierChannels } from "../../../features/suppliers/queries";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { toaster } from "../../../components/feedback/Toaster";
import { SUPPLIER_DETAIL_PENDING } from "../pending";
import { SupplierChannelFormDialog } from "./SupplierChannelFormDialog";

// ChannelsPanel is the MANAGE detail's Channels tab: the shared ChannelBrowser over this team's supplier, with
// what only its owning team may do — Add Channel, and Edit / Delete on each row (only-a-selling-team-has-suppliers).
// The discover detail mounts the same browser read-only.
export function ChannelsPanel({
  teamId,
  supplierId,
  canManage,
}: {
  teamId: bigint;
  supplierId: bigint;
  /** Only a selling team edits its channels (only-a-selling-team-has-suppliers). */
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<SupplierChannelRecord | null>(null);
  const deleteChannel = useDeleteSupplierChannel();

  // The whole list, once — the browser searches, filters and pages it (see ChannelBrowser).
  const query = useSupplierChannels({ teamId, supplierId });

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

  function rowActions(ch: SupplierChannelRecord) {
    return (
      <HStack justify="end" gap="1">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("supplierChannel.edit")}
          data-testid={`edit-channel-${ch.id}`}
          onClick={() => setEditing(ch)}
        >
          <Icon as={Pencil} boxSize="4" />
        </IconButton>

        <ConfirmDialog
          title={t("supplierChannel.deleteTitle")}
          message={t("supplierChannel.deleteConfirm", { name: ch.name })}
          confirmLabel={t("supplierChannel.delete")}
          onConfirm={() => removeChannel(ch)}
          trigger={
            <IconButton
              size="xs"
              variant="ghost"
              colorPalette="error"
              aria-label={t("supplierChannel.delete")}
              data-testid={`delete-channel-${ch.id}`}
            >
              <Icon as={Trash2} boxSize="4" />
            </IconButton>
          }
        />
      </HStack>
    );
  }

  return (
    <>
      <ChannelBrowser
        channels={query.data ?? []}
        loading={query.isPending}
        busy={query.isFetching && !query.isPending}
        error={query.isError ? rpcError(query.error) : ""}
        actions={canManage ? <SupplierChannelFormDialog supplierId={supplierId} /> : undefined}
        rowActions={canManage ? rowActions : undefined}
        descriptionMark={<NotImplemented list={SUPPLIER_DETAIL_PENDING} id="channelDescription" />}
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
