import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Flex,
  Heading,
  Icon,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Stat,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { kindLabel } from "../../features/inventory/movementKind";
import { useBatchDetail } from "../../features/inventory/queries";

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDateUnix(unix: bigint): string {
  if (unix <= 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// A batch is flagged amber when it expires within 30 days — the "expiring soon" window the server uses.
function isExpiringSoon(unix: bigint): boolean {
  return Number(unix) * 1000 <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

// BatchDetailPage is one batch's living detail (#209) — drilled into from the Batches list or a
// delivery on the warehouse product's Batches tab. A batch = one product's units from one delivery,
// carrying a frozen cost (HPP), a lifecycle (Arrived = Damaged + Used + Ready), where its ready units
// sit now, and its own history.
export function BatchDetailPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { batchId: raw } = useParams();
  const batchId = parseId(raw);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const query = useBatchDetail({ warehouseId, batchId });
  const data = query.data;
  const batch = data?.batch ?? null;

  // The place a shelf sits: its painted code, the named unplaced pile (#135), or a bare id if the code
  // could not be resolved.
  const placeLabel = (rackId: bigint): string => {
    if (rackId === 0n) return t("racks.select.unplaced");
    return data?.rackCodes.get(rackId.toString()) ?? `#${rackId.toString()}`;
  };

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batchDetail.title")}</Heading>
        <Text color="fg.muted">{t("batches.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batchDetail.title")}</Heading>
        <Text color="fg.muted" data-testid="batch-detail-not-warehouse">
          {t("batches.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (query.isPending) {
    return <Spinner colorPalette="brand" />;
  }

  if (query.isError) {
    return (
      <Stack gap="section">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <Text color="red.fg" data-testid="batch-detail-error">
          {rpcError(query.error)}
        </Text>
      </Stack>
    );
  }

  if (!batch) {
    return (
      <Stack gap="section">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <Text color="fg.muted" data-testid="batch-detail-missing">
          {t("batchDetail.notFound")}
        </Text>
      </Stack>
    );
  }

  const cost = (v: bigint) => (batch.costKnown ? formatRupiah(v) : t("batchDetail.costUnknown"));

  return (
    <Stack gap="section" data-testid="batch-detail-page">
      {/* Header — back, identity, and a link into the product where Move / Adjust live. */}
      <Flex align="center" gap="card" wrap="wrap">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <Stack gap="0">
          <Flex align="center" gap="2">
            <Heading size="md" data-testid="batch-detail-name">
              {t("batchDetail.batchNo", { id: batch.deliveryId.toString() })}
            </Heading>
            {batch.expiresOnUnix > 0n && isExpiringSoon(batch.expiresOnUnix) && (
              <Badge colorPalette="orange" data-testid="batch-detail-expiring">
                {t("batchDetail.expiring", { date: formatDateUnix(batch.expiresOnUnix) })}
              </Badge>
            )}
          </Flex>
          <Text color="fg.subtle" fontSize="sm">
            {batch.name}
            <Text as="span" ml="2">
              {batch.sku}
            </Text>
          </Text>
        </Stack>
        <Spacer />
        <Button
          variant="outline"
          size="sm"
          data-testid="batch-detail-open-product"
          onClick={() => navigate(`/inventories/products/${batch.productId}`)}
        >
          <Icon as={ExternalLink} boxSize="4" />
          {t("batchDetail.openProduct")}
        </Button>
      </Flex>

      {/* IDENTITY — what this batch IS, and whose goods (#142). */}
      <SimpleGrid columns={{ base: 2, md: 3 }} gap="card">
        <Meta label={t("batchDetail.product")}>
          {batch.name}
          <Text color="fg.subtle" fontSize="xs">
            {batch.sku}
          </Text>
        </Meta>
        <Meta label={t("batchDetail.owner")}>
          {data?.ownerName ? (
            <Badge colorPalette="brand">{data.ownerName}</Badge>
          ) : (
            <Text color="fg.subtle">—</Text>
          )}
        </Meta>
        <Meta label={t("batchDetail.delivery")}>
          <Text
            as="span"
            color="brand.fg"
            cursor="pointer"
            textDecoration="underline"
            data-testid="batch-detail-delivery"
            onClick={() => navigate(`/inventories/restock/${batch.deliveryId}`)}
          >
            #{batch.deliveryId.toString()}
            {batch.receiptNo && ` · ${batch.receiptNo}`}
          </Text>
        </Meta>
        <Meta label={t("batchDetail.unitCost")}>{cost(batch.unitCost)}</Meta>
        <Meta label={t("batchDetail.accepted")}>{formatDateUnix(batch.acceptedAtUnix)}</Meta>
        <Meta label={t("batchDetail.created")}>{formatDateUnix(batch.createdAtUnix)}</Meta>
      </SimpleGrid>

      {/* LIFECYCLE — Arrived = Damaged + Used + Ready. */}
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("batchDetail.arrived")}</Stat.Label>
          <Stat.ValueText data-testid="batch-detail-arrived">{batch.arrived.toString()}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.damaged")}</Stat.Label>
          <Stat.ValueText color={batch.damaged > 0n ? "red.fg" : undefined}>
            {batch.damaged.toString()}
          </Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.used")}</Stat.Label>
          <Stat.ValueText>{batch.used.toString()}</Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.ready")}</Stat.Label>
          <Stat.ValueText color={batch.ready > 0n ? "green.fg" : undefined} data-testid="batch-detail-ready">
            {batch.ready.toString()}
          </Stat.ValueText>
          <Stat.HelpText>{cost(batch.readyValue)}</Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>

      {/* TABS — where it sits now, and its own ledger (#198 vertical tabs). */}
      <Tabs.Root defaultValue="placements" orientation="vertical" variant="subtle">
        <Tabs.List>
          <Tabs.Trigger value="placements" data-testid="batch-detail-tab-placements">
            {t("batchDetail.tabPlacements")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" data-testid="batch-detail-tab-history">
            {t("batchDetail.tabHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* PLACEMENTS — the shelves that still hold some of this batch. */}
        <Tabs.Content value="placements" flex="1">
          <Stack gap="card">
            <Table.Root size="sm" data-testid="batch-detail-placements-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("batchDetail.place")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("batchDetail.readyHere")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(data?.shelves ?? []).map((s) => (
                  <Table.Row key={s.rackId.toString()}>
                    <Table.Cell>{placeLabel(s.rackId)}</Table.Cell>
                    <Table.Cell textAlign="end">{s.qty.toString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            {(data?.shelves ?? []).length === 0 && (
              <Text color="fg.muted" data-testid="batch-detail-placements-empty">
                {t("batchDetail.noPlacements")}
              </Text>
            )}
          </Stack>
        </Tabs.Content>

        {/* HISTORY — this batch's ledger. A batch-less recount (batch_id 0) does not appear here. */}
        <Tabs.Content value="history" flex="1">
          <Stack gap="card">
            <Table.Root size="sm" data-testid="batch-detail-history-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("batchDetail.when")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("batchDetail.what")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("batchDetail.place")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("batchDetail.change")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("batchDetail.after")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {(data?.history ?? []).map((m) => (
                  <Table.Row key={m.id.toString()}>
                    <Table.Cell>{m.createdAt}</Table.Cell>
                    <Table.Cell>{kindLabel(t, m.kind)}</Table.Cell>
                    <Table.Cell>{placeLabel(m.rackId)}</Table.Cell>
                    <Table.Cell textAlign="end">
                      {m.delta > 0n ? `+${m.delta}` : m.delta.toString()}
                    </Table.Cell>
                    <Table.Cell textAlign="end">{m.balance.toString()}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
            {(data?.history ?? []).length === 0 && (
              <Text color="fg.muted" data-testid="batch-detail-history-empty">
                {t("batchDetail.noHistory")}
              </Text>
            )}
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} data-testid="batch-detail-back">
      <Icon as={ArrowLeft} boxSize="4" />
      {label}
    </Button>
  );
}

// One labelled figure in the identity grid.
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap="0">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontWeight="medium" as="div">
        {children}
      </Text>
    </Stack>
  );
}
