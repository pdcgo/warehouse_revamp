import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Link,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../api/clients";
import type { SupplierChannel } from "../gen/warehouse/inventory/v1/supplier_channel_pb";
import { SupplierChannelType } from "../gen/warehouse/inventory/v1/supplier_channel_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { useDeleteSupplierChannel, useSupplier, useSupplierChannels } from "./queries";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarketplaceBadge } from "../components/MarketplaceBadge";
import { toaster } from "../components/Toaster";
import { SupplierChannelFormDialog } from "./SupplierChannelFormDialog";

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
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
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
      <Stack gap="section">
        <Heading size="md">{t("suppliers.title")}</Heading>
        <Text color="fg.muted" data-testid="supplier-detail-no-team">
          {t("supplierChannel.detail.selectTeam")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return <Spinner colorPalette="brand" />;
  }

  if (error || !supplier) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="supplier-detail-back"
          onClick={() => navigate("/inventories/suppliers")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("supplierChannel.detail.back")}
        </Button>
        <Text color="red.fg" data-testid="supplier-detail-error">
          {error || t("supplierChannel.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="supplier-detail-page">
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        data-testid="supplier-detail-back"
        onClick={() => navigate("/inventories/suppliers")}
      >
        <Icon as={ArrowLeft} boxSize="4" />
        {t("supplierChannel.detail.back")}
      </Button>

      <Flex align="center" gap="card">
        <Heading size="md">{t("supplierChannel.detail.title")}</Heading>
        <Badge colorPalette="brand">{supplier.code}</Badge>
      </Flex>

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Heading size="sm" data-testid="supplier-detail-name">
              {supplier.name}
            </Heading>

            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field label={t("supplierChannel.detail.code")} value={supplier.code} />
              <Field label={t("supplierChannel.detail.contact")} value={supplier.contact} />
              <Field label={t("supplierChannel.detail.province")} value={supplier.province} />
              <Field label={t("supplierChannel.detail.city")} value={supplier.city} />
              <Field label={t("supplierChannel.detail.address")} value={supplier.address} />
              <Field label={t("supplierChannel.detail.description")} value={supplier.description} />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root data-testid="channels-section">
        <Card.Body>
          <Stack gap="card">
            <Flex align="center" gap="card">
              <Heading size="sm">{t("supplierChannel.section.title")}</Heading>
              <Spacer />
              {canManage && <SupplierChannelFormDialog supplierId={supplier.id} />}
            </Flex>

            {channelsError && (
              <Text color="red.fg" data-testid="channels-error">
                {channelsError}
              </Text>
            )}

            {channels.length === 0 && !channelsError ? (
              <Text color="fg.muted" data-testid="channels-empty">
                {t("supplierChannel.section.empty")}
              </Text>
            ) : (
              <Table.Root size="sm" data-testid="channels-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("supplierChannel.table.type")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("supplierChannel.table.channel")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("supplierChannel.table.details")}</Table.ColumnHeader>
                    {canManage && (
                      <Table.ColumnHeader textAlign="end">
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
                          <HStack gap="2">
                            {online && <MarketplaceBadge marketplace={ch.marketplace} />}
                            <Text>{ch.name}</Text>
                          </HStack>
                        </Table.Cell>

                        <Table.Cell>
                          {online ? (
                            ch.url ? (
                              <Link href={ch.url} target="_blank" rel="noreferrer" colorPalette="brand">
                                {ch.url}
                                <Icon as={ExternalLink} boxSize="3.5" />
                              </Link>
                            ) : (
                              <Text color="fg.muted">—</Text>
                            )
                          ) : (
                            <Text>{[ch.contact, ch.location].filter(Boolean).join(" · ") || "—"}</Text>
                          )}
                        </Table.Cell>

                        {canManage && (
                          <Table.Cell textAlign="end">
                            <HStack justify="end" gap="1">
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label="Edit"
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
                                    colorPalette="red"
                                    aria-label="Delete"
                                    data-testid={`delete-channel-${ch.id}`}
                                  >
                                    <Icon as={Trash2} boxSize="4" />
                                  </IconButton>
                                }
                              />
                            </HStack>
                          </Table.Cell>
                        )}
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

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
    </Stack>
  );
}
