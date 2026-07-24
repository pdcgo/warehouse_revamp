import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Card, CardBody } from "../../components/ui/Card";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { rpcError } from "../../api/clients";
import type { SupplierChannel } from "../../gen/warehouse/inventory/v1/supplier_channel_pb";
import { SupplierChannelType } from "../../gen/warehouse/inventory/v1/supplier_channel_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteSupplierChannel, useSupplier, useSupplierChannels } from "../../features/suppliers/queries";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { MarketplaceBadge } from "../../components/MarketplaceBadge";
import { toaster } from "../../components/Toaster";
import { SupplierChannelFormDialog } from "./components/SupplierChannelFormDialog";

function parseSupplierId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium uppercase text-fg-muted">{label}</span>
      <span className="line-clamp-3 text-sm">{value || "—"}</span>
    </div>
  );
}

// The channel type as a standard-coloured Badge — Online=blue, Offline=purple.
function ChannelTypeBadge({ type, label }: { type: SupplierChannelType; label: string }) {
  const offline = type === SupplierChannelType.OFFLINE;
  return <Badge colorPalette={offline ? "purple" : "blue"}>{label}</Badge>;
}

// SupplierDetailPage is the dedicated detail route for a supplier (#120) — a PAGE, not a dialog. It
// shows the supplier's read-only info, plus its CHANNELS: the online (marketplace store) and offline
// (physical shop) ways the team reaches that vendor. Reached by clicking a supplier row.
export function SupplierDetailPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();

  const id = parseSupplierId(supplierId);
  // Only a selling team (and root/admin) manages channels; a warehouse team is read-only (mirrors
  // SuppliersPage). The backend interceptor is the real boundary either way.
  const canManage = current?.teamType !== TeamType.WAREHOUSE;

  const [editing, setEditing] = useState<SupplierChannel | null>(null);

  const teamId = current?.teamId;

  // Two queries, not one. They failed independently before — a channel-list error did not blank the
  // supplier — and folding them together would let one request's failure hide the other's result.
  const supplierQuery = useSupplier({ teamId, supplierId: id });
  const channelsQuery = useSupplierChannels({ teamId, supplierId: id });
  const deleteChannel = useDeleteSupplierChannel();

  const supplier = supplierQuery.data ?? null;
  const loading = supplierQuery.isPending && id !== 0n;

  // A malformed id never reaches the server (the queries are disabled for it), so its message is
  // produced here rather than by an error no request produced.
  const error =
    id === 0n
      ? t("supplierChannel.detail.invalidId")
      : supplierQuery.isError
        ? rpcError(supplierQuery.error)
        : "";

  const channels = channelsQuery.data ?? [];
  const channelsError = channelsQuery.isError ? rpcError(channelsQuery.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function removeChannel(channel: SupplierChannel) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteChannel.mutateAsync({ teamId, channelId: channel.id });
      toaster.create({ type: "success", title: t("supplierChannel.deleted", { name: channel.name }) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("supplierChannel.deleteFailed"),
        description: rpcError(err),
      });
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("suppliers.title")}</h1>
        <p className="text-fg-muted" data-testid="supplier-detail-no-team">
          {t("supplierChannel.detail.selectTeam")}
        </p>
      </div>
    );
  }

  if (loading) {
    return <Spinner />;
  }

  if (error || !supplier) {
    return (
      <div className="flex flex-col gap-section">
        <Button
          size="xs"
          variant="ghost"
          className="self-start"
          data-testid="supplier-detail-back"
          onClick={() => navigate("/inventories/suppliers")}
        >
          <ArrowLeft className="size-4" />
          {t("supplierChannel.detail.back")}
        </Button>
        <p className="text-red-600 dark:text-red-400" data-testid="supplier-detail-error">
          {error || t("supplierChannel.detail.notFound")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section" data-testid="supplier-detail-page">
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        data-testid="supplier-detail-back"
        onClick={() => navigate("/inventories/suppliers")}
      >
        <ArrowLeft className="size-4" />
        {t("supplierChannel.detail.back")}
      </Button>

      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("supplierChannel.detail.title")}</h1>
        <Badge colorPalette="brand">{supplier.code}</Badge>
      </div>

      <Card>
        <CardBody>
          <div className="flex flex-col gap-card">
            <h2 className="text-[15px] font-semibold" data-testid="supplier-detail-name">
              {supplier.name}
            </h2>

            <div className="grid grid-cols-1 gap-card sm:grid-cols-2">
              <Field label={t("supplierChannel.detail.code")} value={supplier.code} />
              <Field label={t("supplierChannel.detail.contact")} value={supplier.contact} />
              <Field label={t("supplierChannel.detail.province")} value={supplier.province} />
              <Field label={t("supplierChannel.detail.city")} value={supplier.city} />
              <Field label={t("supplierChannel.detail.address")} value={supplier.address} />
              <Field label={t("supplierChannel.detail.description")} value={supplier.description} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card data-testid="channels-section">
        <CardBody>
          <div className="flex flex-col gap-card">
            <div className="flex items-center gap-card">
              <h2 className="text-[15px] font-semibold">{t("supplierChannel.section.title")}</h2>
              <div className="flex-1" />
              {canManage && <SupplierChannelFormDialog supplierId={supplier.id} />}
            </div>

            {channelsError && (
              <p className="text-red-600 dark:text-red-400" data-testid="channels-error">
                {channelsError}
              </p>
            )}

            {channels.length === 0 && !channelsError ? (
              <p className="text-fg-muted" data-testid="channels-empty">
                {t("supplierChannel.section.empty")}
              </p>
            ) : (
              <Table.Root data-testid="channels-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("supplierChannel.table.type")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("supplierChannel.table.channel")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("supplierChannel.table.details")}</Table.ColumnHeader>
                    {canManage && (
                      <Table.ColumnHeader className="text-right">
                        {t("supplierChannel.table.actions")}
                      </Table.ColumnHeader>
                    )}
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {channels.map((ch) => {
                    const online = ch.type !== SupplierChannelType.OFFLINE;
                    return (
                      <Table.Row key={ch.id.toString()} data-testid={`channel-row-${ch.id}`}>
                        <Table.Cell>
                          <ChannelTypeBadge
                            type={ch.type}
                            label={online ? t("supplierChannel.type.online") : t("supplierChannel.type.offline")}
                          />
                        </Table.Cell>

                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            {online && <MarketplaceBadge marketplace={ch.marketplace} />}
                            <span>{ch.name}</span>
                          </div>
                        </Table.Cell>

                        <Table.Cell>
                          {online ? (
                            ch.url ? (
                              <a
                                href={ch.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-accent-fg hover:underline"
                              >
                                {ch.url}
                                <ExternalLink className="size-3.5" />
                              </a>
                            ) : (
                              <span className="text-fg-muted">—</span>
                            )
                          ) : (
                            <span>{[ch.contact, ch.location].filter(Boolean).join(" · ") || "—"}</span>
                          )}
                        </Table.Cell>

                        {canManage && (
                          <Table.Cell className="text-right">
                            <div className="flex justify-end gap-1">
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label="Edit"
                                data-testid={`edit-channel-${ch.id}`}
                                onClick={() => setEditing(ch)}
                              >
                                <Pencil className="size-4" />
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
                                    colorPalette="red"
                                    aria-label="Delete"
                                    data-testid={`delete-channel-${ch.id}`}
                                  >
                                    <Trash2 className="size-4" />
                                  </IconButton>
                                }
                              />
                            </div>
                          </Table.Cell>
                        )}
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </div>
        </CardBody>
      </Card>

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per channel. */}
      {editing && (
        <SupplierChannelFormDialog
          key={editing.id.toString()}
          supplierId={supplier.id}
          channel={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
