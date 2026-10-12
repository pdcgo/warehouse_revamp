import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Checkbox,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { Pagination } from "../../components/chrome/Pagination";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import {
  useDeleteShipmentChannel,
  useRestoreShipmentChannel,
  useShipmentChannels,
} from "../../features/shipment/queries";
import { ShipmentChannelFormDialog } from "./components/ShipmentChannelFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ShipmentChannelsPage — root curates the GLOBAL courier catalogue.
// Design: docs/business/shipment/context_decision.md.
//
// Mounted at /shipping, offered in the nav to root only (only-root-manages-channels).
//
// The rules this screen carries:
//  - deleted channels are HIDDEN by default and shown on request, because root restores from here;
//  - a live row offers Edit and Delete (confirmed); a deleted row offers Restore only;
//  - the code is never editable (a-code-never-changes).
export function ShipmentChannelsPage() {
  const { t } = useTranslation();

  const [q, setQ] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<ShipmentChannel | null>(null);

  const query = useShipmentChannels({ q, includeDeleted, page, pageSize });
  const deleteChannel = useDeleteShipmentChannel();
  const restoreChannel = useRestoreShipmentChannel();

  const channels = query.data?.channels ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  async function remove(channel: ShipmentChannel) {
    try {
      await deleteChannel.mutateAsync({ channelId: channel.id });
      toaster.create({ type: "success", title: t("shipmentChannels.deletedToast", { name: channel.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("shipmentChannels.failed"), description: rpcError(err) });
    }
  }

  // No confirm: a restore puts a channel back into the pickers, and deleting it again undoes that.
  function restore(channel: ShipmentChannel) {
    restoreChannel.mutate(
      { channelId: channel.id },
      {
        onSuccess: () =>
          toaster.create({ type: "success", title: t("shipmentChannels.restoredToast", { name: channel.name }) }),
        onError: (err) =>
          toaster.create({ type: "error", title: t("shipmentChannels.failed"), description: rpcError(err) }),
      },
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("shipmentChannels.title")}</Heading>
        <Spacer />
        <ShipmentChannelFormDialog />
      </Flex>

      <Flex gap="card" wrap="wrap" align="center">
        <Input
          maxW="sm"
          placeholder={t("shipmentChannels.searchPlaceholder")}
          value={q}
          data-testid="shipment-channel-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <Checkbox.Root
          checked={includeDeleted}
          onCheckedChange={(e) => {
            setPage(1);
            setIncludeDeleted(!!e.checked);
          }}
          data-testid="shipment-channel-show-deleted"
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>{t("shipmentChannels.showDeleted")}</Checkbox.Label>
        </Checkbox.Root>
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="shipment-channels-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>
          <Table.ScrollArea>
            <Table.Root size="sm" data-testid="shipment-channels-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("shipmentChannels.code")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("shipmentChannels.name")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("shipmentChannels.desc")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("shipmentChannels.status")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("shipmentChannels.updated")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("shipmentChannels.actions")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {channels.map((channel) => (
                  <Table.Row key={channel.id.toString()} data-testid={`shipment-channel-row-${channel.code}`}>
                    <Table.Cell fontFamily="mono">{channel.code}</Table.Cell>
                    <Table.Cell color={channel.isDeleted ? "fg.muted" : undefined}>{channel.name}</Table.Cell>
                    <Table.Cell color="fg.muted" maxW="xs" truncate>
                      {channel.desc || "—"}
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        colorPalette={channel.isDeleted ? "gray" : "success"}
                        data-testid={`shipment-channel-status-${channel.code}`}
                      >
                        {channel.isDeleted ? t("shipmentChannels.deleted") : t("shipmentChannels.live")}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell color="fg.muted">
                      {channel.updatedAt ? timestampDate(channel.updatedAt).toLocaleDateString() : "—"}
                    </Table.Cell>

                    <Table.Cell textAlign="end">
                      <HStack justify="end" gap="1">
                        {channel.isDeleted ? (
                          <IconButton
                            size="xs"
                            variant="ghost"
                            colorPalette="success"
                            aria-label={t("shipmentChannels.restore")}
                            data-testid={`restore-${channel.code}`}
                            loading={restoreChannel.isPending && restoreChannel.variables?.channelId === channel.id}
                            onClick={() => restore(channel)}
                          >
                            <Icon as={ArchiveRestore} boxSize="4" />
                          </IconButton>
                        ) : (
                          <>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("shipmentChannels.edit")}
                              data-testid={`edit-${channel.code}`}
                              onClick={() => setEditing(channel)}
                            >
                              <Icon as={Pencil} boxSize="4" />
                            </IconButton>

                            <ConfirmDialog
                              title={t("shipmentChannels.deleteTitle")}
                              message={t("shipmentChannels.deleteConfirm", { name: channel.name })}
                              confirmLabel={t("shipmentChannels.delete")}
                              destructive
                              onConfirm={() => remove(channel)}
                              trigger={
                                <IconButton
                                  size="xs"
                                  variant="ghost"
                                  colorPalette="error"
                                  aria-label={t("shipmentChannels.delete")}
                                  data-testid={`delete-${channel.code}`}
                                >
                                  <Icon as={Trash2} boxSize="4" />
                                </IconButton>
                              }
                            />
                          </>
                        )}
                      </HStack>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        </RefreshOverlay>
      )}

      {!loading && channels.length === 0 && !error && (
        <Text color="fg.muted" data-testid="shipment-channels-empty">
          {t("shipmentChannels.empty")}
        </Text>
      )}

      <Pagination
        count={totalItems}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

      {editing && (
        <ShipmentChannelFormDialog
          key={editing.id.toString()}
          channel={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </Stack>
  );
}
