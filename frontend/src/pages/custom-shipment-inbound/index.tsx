import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Box, Button, Card, Flex, Heading, Icon, IconButton, Link, Span, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useShipmentChannelsByIds } from "../../features/shipment/queries";
import { useActors } from "../../features/users/queries";
import { useRackCodes } from "../../features/racks/queries";
import { CUSTOM_SHIPMENTS_PATH } from "../../features/customShipment/customShipments";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { CopyText } from "../../components/chrome/CopyText";
import { Fact } from "../../components/chrome/DetailSection";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { personName } from "../../lib/users";
import { useInboundParcel } from "../../features/restockResolution/queries";
import { goodOf, shortOf, valueOf } from "../../features/restockResolution/resolutions";
import { InboundStatusBadge } from "../../features/restockResolution/ResolutionSection";
import { InboundKindBadge } from "../../features/restockResolution/InboundRows";
import { InboundActions } from "../../features/restockResolution/InboundActions";

function parseId(raw: string | undefined): bigint {
  try {
    return raw ? BigInt(raw) : 0n;
  } catch {
    return 0n;
  }
}

// ONE INBOUND RESHIPPING PARCEL, as either side reads it (a-suppliers-reshipping-comes-in-as-a-custom-shipment; route
// `/inventories/custom-shipments/in/:parcelId`). The custom-shipment detail's shape — the title with its step and kind,
// the side's acts in the header, the parcel, its lines, its trail — read through CustomShipmentDetail:
//
//   the selling team   its lines priced (the seller's price values the stock, moves no money), Ubah Resi until Tiba,
//                      Ubah Harga until Terima, Tandai Hilang while on its way; the restock it settles is a link
//   the warehouse      no seller price — the server answers none (a-warehouse-sees-no-seller-money); Tandai Tiba with the
//                      door charge, then Terima; the rack each line's good units went on
//
// A parcel the team may not read, or an outbound one, reads as not found.
export function CustomShipmentInboundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { parcelId } = useParams();
  const { current } = useTeam();
  const isMobile = useIsMobile();
  const side = current?.teamType === TeamType.WAREHOUSE ? "warehouse" : "selling";
  const query = useInboundParcel({ teamId: current?.teamId, id: parseId(parcelId) });
  const parcel = query.data ?? undefined;
  const teams = useTeamsByIds({ ids: parcel ? [parcel.teamId, parcel.warehouseId] : [] });
  const couriers = useShipmentChannelsByIds(parcel ? [parcel.shipmentChannelId] : []);
  const actors = useActors(parcel ? [parcel.createdByUserId, parcel.arrivedByUserId, parcel.receivedByUserId, parcel.lostByUserId] : []);
  // The rack codes are the warehouse's own shelves — read by the warehouse only (the selling team reads none).
  const racks = useRackCodes({ warehouseId: parcel?.warehouseId ?? 0n, enabled: side === "warehouse" && parcel?.status === "RECEIVED" });
  const back = () => navigate(side === "selling" ? CUSTOM_SHIPMENTS_PATH : "/inventories/restock");

  if (query.isPending && current) return <ListSkeleton heading rows={3} testId="inbound-loading" />;
  if (!parcel) {
    return (
      <Stack gap="section">
        <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="inbound-back" onClick={back}>
          <Icon as={ArrowLeft} boxSize="4" />
          {t("customShipment.detail.back")}
        </Button>
        <Text color="error.fg" data-testid="inbound-not-found">
          {t("customShipment.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  const teamName = (id: bigint) => teams.data?.[id.toString()]?.name || t("customShipment.teamRef", { id: id.toString() });
  const who = (id: bigint) => (id > 0n ? personName(actors.data?.get(id.toString()), t("restock.table.userRef", { id: id.toString() })) : "");
  const priced = side === "selling";
  const counted = parcel.status === "RECEIVED";
  const showRack = counted && side === "warehouse";
  const title = t("restockResolution.inbound.title", { id: parcel.id.toString() });

  const trail = [
    { key: "created", label: t("restockResolution.inbound.trail.created"), at: parcel.createdAtUnix, by: parcel.createdByUserId },
    { key: "arrived", label: t("restockResolution.inbound.trail.arrived"), at: parcel.arrivedAtUnix, by: parcel.arrivedByUserId },
    { key: "received", label: t("restockResolution.inbound.trail.received"), at: parcel.receivedAtUnix, by: parcel.receivedByUserId },
    { key: "lost", label: t("restockResolution.inbound.trail.lost"), at: parcel.lostAtUnix, by: parcel.lostByUserId, detail: parcel.lostReason },
  ].filter((step) => step.at > 0n);

  return (
    <Stack gap="section" data-testid="inbound-detail-page" data-side={side}>
      {isMobile ? (
        <Flex align="center" gap="2">
          <IconButton size="xs" variant="ghost" aria-label={t("customShipment.detail.back")} data-testid="inbound-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
          </IconButton>
          <Heading size="md" data-testid="inbound-title">
            #{parcel.id.toString()}
          </Heading>
          <InboundStatusBadge status={parcel.status} />
          <Spacer />
          <InboundActions parcel={parcel} side={side} variant="compact" />
        </Flex>
      ) : (
        <>
          <Button size="xs" variant="ghost" alignSelf="flex-start" data-testid="inbound-back" onClick={back}>
            <Icon as={ArrowLeft} boxSize="4" />
            {t("customShipment.detail.back")}
          </Button>
          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="md" data-testid="inbound-title">
              {title}
            </Heading>
            <InboundStatusBadge status={parcel.status} />
            <InboundKindBadge />
            <Spacer />
            <InboundActions parcel={parcel} side={side} variant="buttons" />
          </Flex>
        </>
      )}
      {isMobile && (
        <Box>
          <InboundKindBadge />
        </Box>
      )}

      <Card.Root data-testid="inbound-parcel-card">
        <Card.Body>
          <Stack gap="card">
            <Flex gap="section" wrap="wrap">
              <Fact label={t("restockResolution.inbound.from")}>
                <Text data-testid="inbound-supplier">{parcel.supplierName || t("restockResolution.inbound.supplierUnknown")}</Text>
              </Fact>
              <Fact label={side === "selling" ? t("restockResolution.inbound.to") : t("restockResolution.inbound.owner")}>
                <Text data-testid="inbound-other">{teamName(side === "selling" ? parcel.warehouseId : parcel.teamId)}</Text>
              </Fact>
              <Fact label={t("restockResolution.inbound.forLabel")}>
                <Link colorPalette="brand" onClick={() => navigate(`/inventories/restock/${parcel.restockId}`)} data-testid="inbound-restock">
                  {t("restockResolution.inbound.restockRef", { id: parcel.restockId.toString() })}
                </Link>
              </Fact>
            </Flex>
            <Flex gap="section" wrap="wrap">
              <Fact label={t("restock.detail.courier")}>
                <ShipmentChannelBadge channelId={parcel.shipmentChannelId} channel={couriers.data?.get(parcel.shipmentChannelId.toString())} />
              </Fact>
              <Fact label={t("restock.detail.tracking")}>
                {parcel.resi ? (
                  <CopyText value={parcel.resi} mono testId="inbound-resi" />
                ) : (
                  <Text color="fg.muted" data-testid="inbound-resi">
                    {t("restockResolution.inbound.noResi")}
                  </Text>
                )}
              </Fact>
            </Flex>
            {(parcel.doorCharge > 0 || counted) && (
              <Stack gap="0.5" data-testid="inbound-door-charge">
                <Text fontSize="sm" fontWeight="bold">
                  {t("restock.detail.courierCharge")}
                  {": "}
                  {parcel.doorCharge > 0 ? formatRupiahNumber(parcel.doorCharge) : t("restockResolution.inbound.noCharge")}
                </Text>
                {parcel.doorCharge > 0 && (
                  <Text fontSize="xs" color="fg.muted">
                    {parcel.doorChargeNote}
                    {" — "}
                    {t(
                      counted
                        ? side === "selling"
                          ? "restockResolution.inbound.chargeOwedSelling"
                          : "restockResolution.inbound.chargeOwedWarehouse"
                        : "restockResolution.inbound.chargeNoted",
                      { warehouse: teamName(parcel.warehouseId), team: teamName(parcel.teamId) },
                    )}
                  </Text>
                )}
              </Stack>
            )}
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root data-testid="inbound-lines-card">
        <Card.Header>
          <Card.Title>{t("restockResolution.inbound.lines")}</Card.Title>
          {priced && <Card.Description>{t("restockResolution.inbound.priceHint")}</Card.Description>}
        </Card.Header>
        <Card.Body>
          <Box overflowX="auto">
            <Table.Root size="sm" data-testid="inbound-lines">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("restock.detail.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("restockResolution.inbound.sentHeader")}</Table.ColumnHeader>
                  {priced && <Table.ColumnHeader textAlign="end">{t("restock.detail.unitPrice")}</Table.ColumnHeader>}
                  {counted && (
                    <>
                      <Table.ColumnHeader textAlign="end">{t("restockResolution.inbound.goodHeader")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("restockResolution.inbound.broken")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("restockResolution.inbound.shortHeader")}</Table.ColumnHeader>
                      {showRack && <Table.ColumnHeader>{t("restockResolution.inbound.rackHeader")}</Table.ColumnHeader>}
                    </>
                  )}
                  {priced && <Table.ColumnHeader textAlign="end">{t("restock.detail.lineTotal")}</Table.ColumnHeader>}
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {parcel.lines.map((line) => (
                  <Table.Row key={line.id.toString()} data-testid={`inbound-line-${line.productId}`}>
                    <Table.Cell>
                      <Stack gap="0">
                        <Span>{line.name}</Span>
                        <Span fontSize="xs" color="fg.muted">
                          {line.productCode}
                        </Span>
                      </Stack>
                    </Table.Cell>
                    <Table.Cell textAlign="end">{line.count.toString()}</Table.Cell>
                    {priced && <Table.Cell textAlign="end" whiteSpace="nowrap">{formatRupiahNumber(line.priceUnit ?? 0)}</Table.Cell>}
                    {counted && (
                      <>
                        <Table.Cell textAlign="end" data-testid={`inbound-good-${line.productId}`}>
                          {goodOf(line).toString()}
                        </Table.Cell>
                        <Table.Cell textAlign="end" color={(line.broken ?? 0n) > 0n ? "warning.fg" : undefined}>
                          {(line.broken ?? 0n).toString()}
                        </Table.Cell>
                        <Table.Cell textAlign="end" color={shortOf(line) > 0n ? "warning.fg" : undefined} data-testid={`inbound-shortcount-${line.productId}`}>
                          {shortOf(line).toString()}
                        </Table.Cell>
                        {showRack && <Table.Cell>{(line.rackId > 0n && racks.data?.[line.rackId.toString()]) || "—"}</Table.Cell>}
                      </>
                    )}
                    {priced && <Table.Cell textAlign="end" whiteSpace="nowrap">{formatRupiahNumber((line.priceUnit ?? 0) * Number(line.count))}</Table.Cell>}
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
          {priced && (
            <Flex justify="space-between" mt="card" fontWeight="bold" data-testid="inbound-total">
              <Span>{t("restockResolution.inbound.value")}</Span>
              <Span>{formatRupiahNumber(valueOf(parcel))}</Span>
            </Flex>
          )}
        </Card.Body>
      </Card.Root>

      <Card.Root data-testid="inbound-trail">
        <Card.Header>
          <Card.Title>{t("restock.detail.tab.timeline")}</Card.Title>
        </Card.Header>
        <Card.Body>
          <Stack gap="2">
            {trail.map((step) => (
              <Flex key={step.key} gap="2" wrap="wrap" fontSize="sm" data-testid={`inbound-trail-${step.key}`}>
                <Text fontWeight="bold">{step.label}</Text>
                <Text color="fg.muted">
                  {formatUnixDateTimeShort(step.at)}
                  {who(step.by) && ` · ${who(step.by)}`}
                </Text>
                {"detail" in step && step.detail && <Text w="full">{step.detail}</Text>}
              </Flex>
            ))}
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
