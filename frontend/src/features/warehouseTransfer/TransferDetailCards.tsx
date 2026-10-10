import { useTranslation } from "react-i18next";
import { Badge, Card, Flex, HStack, Icon, SimpleGrid, Span, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import type { WarehouseTransfer, WarehouseTransferItem } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferStatus as S } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { useTeamsByIds } from "../teams/queries";
import { useRackCodes } from "../racks/queries";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { useFinancialAccount } from "../financialAccount/queries";
import { DetailField } from "../restock/DetailField";
import { TeamItem } from "../../components/entity/TeamItem";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import { brokenOf, missingOf, problemValue, unitsSent } from "./summary";

// The three cards both transfer detail pages show — the route, the parcel and the lines — in one place, so the selling
// team and the two warehouses read the same transfer the same way. What differs by reader is passed in: a warehouse
// crew sees no values (the goods are the selling team's), and A sees its pick list.

/** Where the goods go, whose they are, and when it was opened. */
export function RouteCard({ transfer }: { transfer: WarehouseTransfer }) {
  const { t } = useTranslation();
  const teams = useTeamsByIds({ ids: [transfer.teamId, transfer.fromWarehouseId, transfer.toWarehouseId] });
  const team = (id: bigint) => {
    const found = teams.data?.[id.toString()];

    return { teamId: id, teamName: found?.name, teamType: found?.type, imageUrl: found?.imageUrl };
  };

  return (
    <Card.Root data-testid="transfer-route-card">
      <Card.Header>
        <Card.Title>{t("warehouseTransfer.detail.route")}</Card.Title>
      </Card.Header>
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="card" wrap="wrap">
            <Stack gap="1" minW="52" data-testid="transfer-route-from">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseTransfer.detail.from")}
              </Text>
              <TeamItem team={team(transfer.fromWarehouseId)} />
            </Stack>
            <Icon as={ArrowRight} boxSize="5" color="fg.muted" />
            <Stack gap="1" minW="52" data-testid="transfer-route-to">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseTransfer.detail.to")}
              </Text>
              <TeamItem team={team(transfer.toWarehouseId)} />
            </Stack>
          </Flex>
          <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
            <DetailField
              label={t("warehouseTransfer.detail.owner")}
              value={<TeamItem team={team(transfer.teamId)} />}
              testId="transfer-detail-owner"
            />
            <DetailField
              label={t("warehouseTransfer.detail.created")}
              value={formatUnixDateTime(transfer.createdAtUnix)}
              testId="transfer-detail-created"
            />
            {transfer.note && (
              <DetailField label={t("warehouseTransfer.detail.note")} value={transfer.note} testId="transfer-detail-note" />
            )}
          </SimpleGrid>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The trip: the courier and its label (entered by A when it ships), and the money. `showMoney` is the selling team's —
 * the expense and its account are its own; a warehouse sees only the on-site charge, which concerns B.
 */
export function ParcelCard({
  transfer,
  teamId,
  showMoney,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  showMoney: boolean;
}) {
  const { t } = useTranslation();
  const couriers = useShipmentChannelsByIds([transfer.shipmentId]);
  const account = useFinancialAccount(showMoney ? teamId : undefined, transfer.financeAccountId);
  const shipped = transfer.shippedAtUnix > 0n;

  return (
    <Card.Root data-testid="transfer-parcel-card">
      <Card.Header>
        <Card.Title>{t("warehouseTransfer.detail.parcel")}</Card.Title>
      </Card.Header>
      <Card.Body>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
          <DetailField
            label={t("warehouseTransfer.detail.courier")}
            value={
              shipped ? (
                <ShipmentChannelBadge
                  channelId={transfer.shipmentId}
                  channel={couriers.data?.get(transfer.shipmentId.toString())}
                />
              ) : (
                <Span color="fg.muted">{t("warehouseTransfer.detail.notShipped")}</Span>
              )
            }
            testId="transfer-detail-courier"
          />
          <DetailField
            label={t("warehouseTransfer.detail.tracking")}
            value={transfer.receipt || <Span color="fg.muted">—</Span>}
            testId="transfer-detail-tracking"
          />
          {showMoney && (
            <>
              <DetailField
                label={t("warehouseTransfer.detail.shippingCost")}
                value={
                  transfer.shipmentCost > 0n ? (
                    formatRupiah(transfer.shipmentCost)
                  ) : (
                    <Span color="fg.muted">{t("warehouseTransfer.detail.noCostYet")}</Span>
                  )
                }
                testId="transfer-detail-shipping-cost"
              />
              {transfer.financeAccountId > 0n && (
                <DetailField
                  label={t("warehouseTransfer.detail.paidFrom")}
                  value={
                    account.data?.name ??
                    t("warehouseTransfer.detail.accountRef", { id: transfer.financeAccountId.toString() })
                  }
                  testId="transfer-detail-account"
                />
              )}
            </>
          )}
          {transfer.warehouseAdditionalCost > 0n && (
            <DetailField
              label={t("warehouseTransfer.detail.onSiteCharge")}
              value={
                <Stack gap="0">
                  <Span>{formatRupiah(transfer.warehouseAdditionalCost)}</Span>
                  <Span fontSize="xs" color="fg.muted">
                    {transfer.warehouseAdditionalCostNote}
                  </Span>
                </Stack>
              }
              testId="transfer-detail-on-site"
            />
          )}
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The lines — what was sent and, once accepted, what arrived. `showPrices` is the selling team's; `showPicks` is A's
 * pick list (where to take each product from), shown until it ships.
 */
export function TransferLinesCard({
  transfer,
  showPrices,
  showPicks,
}: {
  transfer: WarehouseTransfer;
  showPrices: boolean;
  showPicks: boolean;
}) {
  const { t } = useTranslation();
  const fromRacks = useRackCodes({ warehouseId: transfer.fromWarehouseId, enabled: showPicks });
  const accepted = transfer.status === S.ACCEPTED;
  const toRacks = useRackCodes({ warehouseId: transfer.toWarehouseId, enabled: accepted });
  const lost = problemValue(transfer);

  const racksOf = (codes: Record<string, string> | undefined, places: { placementId: bigint; quantity: bigint }[]) =>
    places
      .map((p) => `${codes?.[p.placementId.toString()] ?? `#${p.placementId}`} × ${p.quantity}`)
      .join(" · ");

  return (
    <Card.Root data-testid="transfer-lines-card">
      <Card.Header>
        <HStack gap="2" wrap="wrap">
          <Card.Title>{t("warehouseTransfer.detail.products")}</Card.Title>
          <Badge variant="subtle">
            {t("warehouseTransfer.table.itemsSummary", {
              count: transfer.items.length,
              pieces: unitsSent(transfer.items).toString(),
            })}
          </Badge>
        </HStack>
      </Card.Header>
      <Card.Body overflowX="auto">
        <Table.Root size="sm" data-testid="transfer-lines-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("warehouseTransfer.table.product")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.sent")}</Table.ColumnHeader>
              {showPicks && <Table.ColumnHeader>{t("warehouseTransfer.table.pickFrom")}</Table.ColumnHeader>}
              {accepted && (
                <>
                  <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.arrived")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.broken")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.missing")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("warehouseTransfer.table.putAway")}</Table.ColumnHeader>
                </>
              )}
              {showPrices && <Table.ColumnHeader textAlign="end">{t("warehouseTransfer.table.value")}</Table.ColumnHeader>}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {transfer.items.map((item) => (
              <LineRow
                key={item.id.toString()}
                item={item}
                showPrices={showPrices}
                picks={showPicks ? racksOf(fromRacks.data, item.picks) : undefined}
                putAway={accepted ? racksOf(toRacks.data, item.placements) : undefined}
              />
            ))}
          </Table.Body>
        </Table.Root>

        {showPrices && (
          <Stack gap="1" pt="card" align="end">
            <Text fontWeight="bold" data-testid="transfer-detail-total">
              {t("warehouseTransfer.detail.total", { amount: formatRupiah(transfer.total) })}
            </Text>
            {lost > 0n && (
              <Text fontSize="sm" color="warning.fg" data-testid="transfer-detail-loss">
                {t("warehouseTransfer.detail.loss", { amount: formatRupiah(lost) })}
              </Text>
            )}
          </Stack>
        )}
      </Card.Body>
    </Card.Root>
  );
}

function LineRow({
  item,
  showPrices,
  picks,
  putAway,
}: {
  item: WarehouseTransferItem;
  showPrices: boolean;
  picks?: string;
  putAway?: string;
}) {
  const { t } = useTranslation();
  const broken = brokenOf(item);
  const missing = missingOf(item);
  const note = item.problems.map((p) => p.note).filter(Boolean).join(" · ");

  return (
    <Table.Row data-testid={`transfer-line-${item.id}`}>
      <Table.Cell>
        <Stack gap="0">
          <Span fontWeight="medium">{item.name}</Span>
          <Span fontSize="xs" color="fg.muted">
            {item.sku}
          </Span>
          {note && (
            <Span fontSize="xs" color="warning.fg">
              {note}
            </Span>
          )}
        </Stack>
      </Table.Cell>
      <Table.Cell textAlign="end">{item.count.toString()}</Table.Cell>
      {picks !== undefined && (
        <Table.Cell data-testid={`transfer-line-${item.id}-picks`}>{picks || "—"}</Table.Cell>
      )}
      {putAway !== undefined && (
        <>
          <Table.Cell textAlign="end">{item.arrivedCount.toString()}</Table.Cell>
          <Table.Cell textAlign="end" color={broken > 0n ? "warning.fg" : undefined}>
            {broken.toString()}
          </Table.Cell>
          <Table.Cell textAlign="end" color={missing > 0n ? "warning.fg" : undefined}>
            {missing.toString()}
          </Table.Cell>
          <Table.Cell data-testid={`transfer-line-${item.id}-put-away`}>{putAway || "—"}</Table.Cell>
        </>
      )}
      {showPrices && (
        <Table.Cell textAlign="end" whiteSpace="nowrap">
          <Stack gap="0" align="end">
            <Span>{formatRupiah(item.total)}</Span>
            <Span fontSize="xs" color="fg.muted">
              {t("warehouseTransfer.table.perPiece", { amount: formatRupiah(item.priceUnit) })}
            </Span>
          </Stack>
        </Table.Cell>
      )}
    </Table.Row>
  );
}
