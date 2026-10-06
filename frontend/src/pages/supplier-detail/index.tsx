import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Link,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { SupplierChannelRecord } from "../../features/suppliers/adapt";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteSupplierChannel, useSupplier, useSupplierChannels } from "../../features/suppliers/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useIsMobile } from "../../layouts/shell";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { toaster } from "../../components/feedback/Toaster";
import { SupplierChannelFormDialog } from "./components/SupplierChannelFormDialog";
import { SUPPLIER_DETAIL_PENDING } from "./pending";

function parseSupplierId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
function Field({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="bold" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3} whiteSpace="pre-line" data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// A channel's link, opened in a new tab — or a dash, since the link is optional.
function ChannelLink({ uri }: { uri: string }) {
  if (!uri) {
    return <Text color="fg.muted">—</Text>;
  }

  return (
    <Link href={uri} target="_blank" rel="noreferrer" colorPalette="brand" wordBreak="break-all">
      {uri}
      <Icon as={ExternalLink} boxSize="3.5" />
    </Link>
  );
}

// SupplierDetailPage is the dedicated detail route for a supplier — a PAGE, not a dialog. It shows the
// supplier (a name, a contact, an address, a description) and, under a horizontal CHANNELS tab
// (channels-are-a-horizontal-tab), the stores it sells through, each typed off the shared marketplace list
// (the-supplier-lists-only-its-online-stores, channel-type-is-the-marketplace-list). The tab row is where
// what is parked — the products per channel, the statistics — lands later. Reached by clicking a supplier row.
export function SupplierDetailPage() {
  const { supplierId } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const id = parseSupplierId(supplierId);
  // Only a selling team has suppliers (only-a-selling-team-has-suppliers), so only a selling team edits
  // their channels. The backend interceptor is the real boundary either way.
  const canManage = current?.teamType === TeamType.SELLING;

  const [editing, setEditing] = useState<SupplierChannelRecord | null>(null);

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
  async function removeChannel(channel: SupplierChannelRecord) {
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

  const back = (
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
  );

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
        {back}
        <Text color="error.fg" data-testid="supplier-detail-error">
          {error || t("supplierChannel.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  function channelActions(ch: SupplierChannelRecord) {
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
    <Stack gap="section" data-testid="supplier-detail-page">
      {back}

      <Heading size="md" data-testid="supplier-detail-name">
        {supplier.name}
      </Heading>

      <NotImplementedSummary list={SUPPLIER_DETAIL_PENDING} />

      <Card.Root>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
            <Field label={t("supplierChannel.detail.contact")} value={supplier.contact} testId="supplier-detail-contact" />
            <Field label={t("supplierChannel.detail.address")} value={supplier.address} testId="supplier-detail-address" />
            <Field
              label={t("supplierChannel.detail.description")}
              value={supplier.description}
              testId="supplier-detail-description"
            />
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Tabs.Root defaultValue="channels" data-testid="supplier-tabs">
        <Tabs.List>
          <Tabs.Trigger value="channels" data-testid="supplier-tab-channels">
            {t("supplierChannel.section.title")}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="channels" data-testid="channels-section">
          <Stack gap="card">
            {canManage && (
              <Flex align="center" gap="card">
                <Spacer />
                <SupplierChannelFormDialog supplierId={supplier.id} />
              </Flex>
            )}

            {channelsError && (
              <Text color="error.fg" data-testid="channels-error">
                {channelsError}
              </Text>
            )}

            {channels.length === 0 && !channelsError ? (
              <Text color="fg.muted" data-testid="channels-empty">
                {t("supplierChannel.section.empty")}
              </Text>
            ) : isMobile ? (
              // A phone reads each channel as a block: the type and the name, then the link and the
              // description on their own lines.
              <Stack gap="2" data-testid="channels-table">
                {channels.map((ch) => (
                  <Flex
                    key={ch.id.toString()}
                    data-testid={`channel-row-${ch.id}`}
                    borderWidth="1px"
                    borderRadius="md"
                    p="3"
                    gap="2"
                    align="start"
                  >
                    <Stack gap="1" minW="0" flex="1">
                      <HStack gap="2">
                        <MarketplaceBadge marketplace={ch.channelType} />
                        <Text fontWeight="bold">{ch.name}</Text>
                      </HStack>
                      <ChannelLink uri={ch.uri} />
                      {ch.description && (
                        <Text fontSize="sm" color="fg.muted">
                          {ch.description}
                        </Text>
                      )}
                    </Stack>
                    {canManage && channelActions(ch)}
                  </Flex>
                ))}
              </Stack>
            ) : (
              <Table.Root size="sm" data-testid="channels-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("supplierChannel.table.channel")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("supplierChannel.table.uri")}</Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <HStack gap="1">
                        {t("supplierChannel.table.description")}
                        <NotImplemented list={SUPPLIER_DETAIL_PENDING} id="channelDescription" />
                      </HStack>
                    </Table.ColumnHeader>
                    {canManage && (
                      <Table.ColumnHeader textAlign="end">{t("supplierChannel.table.actions")}</Table.ColumnHeader>
                    )}
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {channels.map((ch) => (
                    <Table.Row key={ch.id.toString()} data-testid={`channel-row-${ch.id}`}>
                      <Table.Cell>
                        <HStack gap="2">
                          <MarketplaceBadge marketplace={ch.channelType} />
                          <Text>{ch.name}</Text>
                        </HStack>
                      </Table.Cell>

                      <Table.Cell maxW="xs">
                        <ChannelLink uri={ch.uri} />
                      </Table.Cell>

                      <Table.Cell maxW="xs">
                        <Text lineClamp={2} color={ch.description ? undefined : "fg.muted"}>
                          {ch.description || "—"}
                        </Text>
                      </Table.Cell>

                      {canManage && <Table.Cell textAlign="end">{channelActions(ch)}</Table.Cell>}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </Stack>
        </Tabs.Content>
      </Tabs.Root>

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
