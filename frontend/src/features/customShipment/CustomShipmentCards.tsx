import { useTranslation } from "react-i18next";
import { Badge, Card, Flex, Icon, SimpleGrid, Span, Stack, Table, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import { useTeamsByIds } from "../teams/queries";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { useFinancialAccountsByIds } from "../financialAccount/queries";
import { DetailField } from "../restock/DetailField";
import { TeamItem } from "../../components/entity/TeamItem";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import type { CustomShipment, CustomShipmentPick } from "./customShipments";
import { unitsOf } from "./customShipments";
import { CustomShipmentKindBadge, payerKey } from "./CustomShipmentBadges";

// The cards both custom-shipment pages show — the parcel and its lines — in one place, so the selling team and the
// warehouse read one parcel the same way. What differs by reader is the reader's own: the selling team sees its money
// (the goods' value, its account and ongkir — a-sample-is-a-stock-out-at-batch-value: *the team sees every sample of
// its goods*); the warehouse sees none of it (a-warehouse-sees-no-seller-money), only the ongkir IT paid
// (the-warehouse-sees-the-ongkir-it-paid) — and its pick list.

/** Where it goes, how, and who pays — the parcel as the person writing the label reads it. */
export function ParcelCard({ shipment, side }: { shipment: CustomShipment; side: "selling" | "warehouse" }) {
  const { t } = useTranslation();
  const teams = useTeamsByIds({ ids: [shipment.teamId, shipment.warehouseId] });
  const couriers = useShipmentChannelsByIds([shipment.shipmentChannelId]);
  const accounts = useFinancialAccountsByIds(side === "selling" ? shipment.teamId : undefined, [shipment.financeAccountId]);
  const team = (id: bigint) => {
    const found = teams.data?.[id.toString()];

    return { teamId: id, teamName: found?.name, teamType: found?.type, imageUrl: found?.imageUrl };
  };
  const owner = teams.data?.[shipment.teamId.toString()]?.name ?? "";
  const handedOver = shipment.status === "HANDED_OVER";
  const account = accounts.data?.get(shipment.financeAccountId.toString());

  // THE ONGKIR, as this reader may know it. The team's own (*Kami bayar*): its account and cost, the cost editable until
  // the handover. The warehouse's (*Gudang bayar*): typed at the handover — "—" until then, then the amount and who owes
  // it back. A warehouse reading a *Kami bayar* parcel learns only that it must not pay the courier.
  // The cost is read only where the server SENT it: a warehouse reading a *Kami bayar* parcel receives none
  // (a-warehouse-sees-no-seller-money) and is never shown one.
  const cost = shipment.shippingCost ?? 0;
  const ongkir =
    shipment.payer === "TEAM"
      ? side === "selling"
        ? cost > 0
          ? formatRupiahNumber(cost)
          : t("customShipment.detail.costNotYet")
        : t("customShipment.detail.doNotPay")
      : handedOver
        ? side === "selling"
          ? t("customShipment.detail.owedToWarehouse", { amount: formatRupiahNumber(cost) })
          : t("customShipment.detail.owedByTeam", { amount: formatRupiahNumber(cost), team: owner })
        : t("customShipment.detail.costAtHandover");

  return (
    <Card.Root data-testid="custom-shipment-parcel-card">
      <Card.Header>
        <Card.Title>{t("customShipment.detail.parcel")}</Card.Title>
      </Card.Header>
      <Card.Body>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="card">
          <DetailField
            label={t("customShipment.detail.kind")}
            value={
              <Flex align="center" gap="2" wrap="wrap">
                <CustomShipmentKindBadge kind={shipment.kind} />
                {shipment.restockId > 0n && (
                  <Span fontSize="sm" color="fg.muted" data-testid="custom-shipment-restock">
                    {t("customShipment.detail.fromRestock", { id: shipment.restockId.toString() })}
                  </Span>
                )}
              </Flex>
            }
            testId="custom-shipment-detail-kind"
          />
          <DetailField
            label={side === "selling" ? t("customShipment.detail.warehouse") : t("customShipment.detail.owner")}
            value={<TeamItem team={team(side === "selling" ? shipment.warehouseId : shipment.teamId)} />}
            testId="custom-shipment-detail-other-team"
          />
          <DetailField
            label={t("customShipment.detail.recipient")}
            value={
              <Stack gap="0">
                <Span fontWeight="medium">{shipment.recipient.name}</Span>
                <Span>{shipment.recipient.phone}</Span>
              </Stack>
            }
            testId="custom-shipment-detail-recipient"
          />
          <DetailField
            label={t("customShipment.detail.address")}
            value={<Text whiteSpace="pre-wrap">{shipment.recipient.address}</Text>}
            testId="custom-shipment-detail-address"
          />
          <DetailField
            label={t("customShipment.detail.courier")}
            value={
              <ShipmentChannelBadge
                channelId={shipment.shipmentChannelId}
                channel={couriers.data?.get(shipment.shipmentChannelId.toString())}
              />
            }
            testId="custom-shipment-detail-courier"
          />
          <DetailField
            label={t("customShipment.detail.payer")}
            value={t(payerKey(shipment.payer, side), { team: owner })}
            testId="custom-shipment-detail-payer"
          />
          <DetailField label={t("customShipment.detail.ongkir")} value={ongkir} testId="custom-shipment-detail-ongkir" />
          {side === "selling" && shipment.payer === "TEAM" && (
            <DetailField
              label={t("customShipment.detail.account")}
              value={account?.name ?? t("customShipment.detail.accountRef", { id: shipment.financeAccountId.toString() })}
              testId="custom-shipment-detail-account"
            />
          )}
          {shipment.resi && (
            <DetailField label={t("customShipment.detail.resi")} value={shipment.resi} testId="custom-shipment-detail-resi" />
          )}
          <DetailField
            label={t("customShipment.detail.created")}
            value={formatUnixDateTime(shipment.createdAtUnix)}
            testId="custom-shipment-detail-created"
          />
          {/* The warehouse reads the team's note in its own card above the pick list, as an order's notes are read. */}
          {side === "selling" && shipment.note && (
            <DetailField label={t("customShipment.detail.note")} value={shipment.note} testId="custom-shipment-detail-note" />
          )}
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * The lines. `showValue` — the selling team's sample value (the batch value its take drew). `picks` — the warehouse's
 * pick list: a sample's racks as StockPickLocations answered them for its take, as the order pick page's (every rack its
 * units came from, each with its count); a reship's units were never on a rack
 * (a-restocks-broken-units-are-just-broken-for-now), so it says where they come from instead. No `picks` — not the pick list.
 */
export function LinesCard({
  shipment,
  showValue,
  picks,
}: {
  shipment: CustomShipment;
  showValue: boolean;
  picks?: CustomShipmentPick[];
}) {
  const { t } = useTranslation();
  const showPicks = picks !== undefined;
  const reship = shipment.kind === "RESTOCK_RESHIP";
  const value = showValue && !reship;

  return (
    <Card.Root data-testid="custom-shipment-lines-card">
      <Card.Header>
        <Card.Title>{showPicks ? t("customShipment.pick.title") : t("customShipment.detail.lines")}</Card.Title>
        {reship && (
          <Card.Description data-testid="custom-shipment-lines-broken-hint">
            {t("customShipment.detail.brokenHint", { id: shipment.restockId.toString() })}
          </Card.Description>
        )}
      </Card.Header>
      <Card.Body>
        <Table.Root size="sm" data-testid="custom-shipment-lines">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("customShipment.table.product")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("customShipment.table.qty")}</Table.ColumnHeader>
              {showPicks && !reship && <Table.ColumnHeader>{t("customShipment.table.rack")}</Table.ColumnHeader>}
              {reship && <Table.ColumnHeader>{t("customShipment.table.brokenNote")}</Table.ColumnHeader>}
              {value && <Table.ColumnHeader textAlign="end">{t("customShipment.table.value")}</Table.ColumnHeader>}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shipment.items.map((item) => {
              const racks = (picks ?? []).filter((pick) => pick.productId === item.productId);

              return (
                <Table.Row key={item.id.toString()} data-testid={`custom-shipment-line-${item.productId}`}>
                  <Table.Cell>
                    <Stack gap="0">
                      <Text>{item.name}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {item.productCode}
                      </Text>
                    </Stack>
                  </Table.Cell>
                  <Table.Cell textAlign="end" data-testid={`custom-shipment-qty-${item.productId}`}>
                    {item.quantity.toString()}
                  </Table.Cell>
                  {showPicks && !reship && (
                    <Table.Cell>
                      {racks.length === 0 ? (
                        <Flex align="center" gap="1" color="fg.muted">
                          <Icon as={TriangleAlert} boxSize="4" />
                          <Text fontSize="sm">{t("customShipment.pick.noRack")}</Text>
                        </Flex>
                      ) : (
                        // EVERY rack the take drew from, each with its own count — two racks are two walks
                        // (the order pick page's rule, #135/#151).
                        <Stack gap="1">
                          {racks.map((pick) => (
                            <Flex
                              key={pick.rackId.toString()}
                              align="center"
                              gap="2"
                              data-testid={`custom-shipment-rack-${item.productId}-${pick.rackId}`}
                            >
                              {/* Rack 0 is the UNPLACED pile — a place, said in words (the order pick page's #135). */}
                              <Badge colorPalette="brand">{pick.rackId === 0n ? t("picking.table.unplaced") : pick.rackCode}</Badge>
                              <Text fontSize="sm">×{pick.quantity.toString()}</Text>
                            </Flex>
                          ))}
                        </Stack>
                      )}
                    </Table.Cell>
                  )}
                  {reship && (
                    <Table.Cell color={item.brokenNote ? undefined : "fg.muted"} data-testid={`custom-shipment-broken-${item.productId}`}>
                      {item.brokenNote || "—"}
                    </Table.Cell>
                  )}
                  {value && (
                    <Table.Cell textAlign="end" whiteSpace="nowrap" data-testid={`custom-shipment-value-${item.productId}`}>
                      {formatRupiahNumber(item.total ?? 0)}
                    </Table.Cell>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
        <Flex justify="space-between" mt="card" fontWeight="bold" data-testid="custom-shipment-lines-total">
          <Span>{t("customShipment.table.units", { count: Number(unitsOf(shipment)) })}</Span>
          {value && <Span data-testid="custom-shipment-total">{formatRupiahNumber(shipment.total ?? 0)}</Span>}
        </Flex>
      </Card.Body>
    </Card.Root>
  );
}
