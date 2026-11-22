import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, Flex, HStack, Icon, Span, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { Redo2 } from "lucide-react";

import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { useTeamsByIds } from "../teams/queries";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { useActors } from "../users/queries";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { CopyText } from "../../components/chrome/CopyText";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { PRESSABLE } from "../../lib/motion";
import { personName } from "../../lib/users";
import type { InboundParcel } from "./resolutions";
import { inboundParcelPath, unitsOf, valueOf } from "./resolutions";
import { InboundStatusBadge } from "./ResolutionSection";
import { InboundActions } from "./InboundActions";

// THE INBOUND RESHIPPING PARCELS ON THE LISTS THAT ALREADY EXIST, beside today's rows (the accepted prototype's places):
//
//   the warehouse's Restok Masuk   its incoming list — *"the warehouse then sees it in its incoming list like a restock on
//                                  its way"* (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A): a row per
//                                  parcel at the top, in the restock tab of its step, Tandai Tiba / Terima on it
//   the seller's Kirim Paket       custom shipments go both ways now: the inbound ones among the outbound (newest first,
//                                  the list's one order) under Semua, and their own kind in the Kind filter
//
// Read through the real lists (CustomShipmentList — direction INBOUND for the warehouse; both ways for the seller), paged.

/** The kind's badge — a supplier sending goods IN (the way back of a reship, turned round). */
export function InboundKindBadge() {
  const { t } = useTranslation();

  return (
    <Badge variant="outline" colorPalette="cyan" flexShrink={0} data-testid="custom-shipment-kind-reshipping">
      <HStack gap="1">
        <Icon as={Redo2} boxSize="3" />
        {t("restockResolution.inbound.kind")}
      </HStack>
    </Badge>
  );
}

/** Which inbound step a restock status tab holds — a parcel's step read as a restock's; undefined = every step (Semua). */
export function inboundStatusOfTab(tab: string): InboundParcel["status"] | undefined | null {
  if (tab === "all") return undefined;
  const step = ({ ongoing: "ON_THE_WAY", arrived: "ARRIVED", accepted: "RECEIVED", lost: "LOST" } as const)[tab as "ongoing"];
  // A tab no inbound step sits in (Dibatalkan) holds none.
  return step ?? null;
}

function ItemsCell({ parcel }: { parcel: InboundParcel }) {
  const { t } = useTranslation();
  const [first, ...rest] = parcel.lines;

  return (
    <Stack gap="0" minW="0" data-testid={`inbound-items-${parcel.id}`}>
      <Span fontSize="sm" wordBreak="break-word">
        {first?.name ?? "—"}
        {rest.length > 0 && <Span color="fg.muted"> {t("customShipment.table.more", { count: rest.length })}</Span>}
      </Span>
      <Span fontSize="xs" color="fg.muted">
        {t("customShipment.table.itemsSummary", { count: parcel.lines.length, pieces: unitsOf(parcel).toString() })}
      </Span>
    </Stack>
  );
}

const supplierOf = (t: (key: string) => string, p: InboundParcel) => p.supplierName || t("restockResolution.inbound.supplierUnknown");

// ── THE WAREHOUSE'S RESTOK MASUK — rows in its table's ten columns, blocks on a phone ─────────────────────────────────────

/** The warehouse reads no seller price — the server answers none (a-warehouse-sees-no-seller-money), and none is drawn. */
export function WarehouseInboundRows({ parcels, phone }: { parcels: InboundParcel[]; phone: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const teams = useTeamsByIds({ ids: parcels.map((p) => p.teamId) });
  const couriers = useShipmentChannelsByIds(parcels.map((p) => p.shipmentChannelId));
  const actors = useActors(parcels.map((p) => p.arrivedByUserId));
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (parcels.length === 0) return null;

  const owner = (p: InboundParcel) => teams.data?.[p.teamId.toString()]?.name || t("restock.teamRef", { id: p.teamId.toString() });
  const forLine = (p: InboundParcel) => t("restockResolution.inbound.forRestock", { id: p.restockId.toString(), team: owner(p) });
  const open = (p: InboundParcel) => navigate(inboundParcelPath(p.id));

  if (phone) {
    return (
      <>
        {parcels.map((p) => (
          <Stack key={p.id.toString()} data-testid={`inbound-row-${p.id}`} borderWidth="1px" borderRadius="md" p="4" gap="2" {...PRESSABLE} onClick={() => open(p)}>
            <Flex align="center" gap="2" wrap="wrap">
              <Text fontWeight="bold">#{p.id.toString()}</Text>
              <InboundStatusBadge status={p.status} />
              <InboundKindBadge />
              <Text fontSize="xs" color="fg.muted" ms="auto" whiteSpace="nowrap">
                {formatUnixDateTimeShort(p.createdAtUnix)}
              </Text>
            </Flex>
            <Text fontSize="sm" truncate>
              {supplierOf(t, p)}
              <Span fontSize="xs" color="fg.muted">{` · ${forLine(p)}`}</Span>
            </Text>
            <Flex align="center" gap="2" wrap="wrap" onClick={stop}>
              <ShipmentChannelBadge channelId={p.shipmentChannelId} channel={couriers.data?.get(p.shipmentChannelId.toString())} />
              {p.resi && <CopyText value={p.resi} mono maxW="10rem" testId={`inbound-resi-${p.id}`} />}
            </Flex>
            <ItemsCell parcel={p} />
            <Flex justify="end" pt="1" onClick={stop}>
              <InboundActions parcel={p} side="warehouse" variant="row" />
            </Flex>
          </Stack>
        ))}
      </>
    );
  }

  return (
    <>
      {parcels.map((p) => {
        const by = p.arrivedByUserId > 0n ? personName(actors.data?.get(p.arrivedByUserId.toString())) : "";

        return (
          <Table.Row key={p.id.toString()} data-testid={`inbound-row-${p.id}`} cursor="pointer" onClick={() => open(p)}>
            <Table.Cell />
            <Table.Cell>
              <Stack gap="1" align="start">
                <Span fontWeight="medium">#{p.id.toString()}</Span>
                <InboundKindBadge />
              </Stack>
            </Table.Cell>
            <Table.Cell minW="36">
              <Stack gap="0" minW="0">
                <Span lineClamp={1}>{supplierOf(t, p)}</Span>
                <Span fontSize="xs" color="fg.muted" lineClamp={1} data-testid={`inbound-for-${p.id}`}>
                  {forLine(p)}
                </Span>
              </Stack>
            </Table.Cell>
            <Table.Cell>
              <ItemsCell parcel={p} />
            </Table.Cell>
            <Table.Cell onClick={stop}>
              <Stack gap="0" align="start" minW="0">
                <ShipmentChannelBadge channelId={p.shipmentChannelId} channel={couriers.data?.get(p.shipmentChannelId.toString())} />
                {p.resi && <CopyText value={p.resi} mono maxW="10rem" testId={`inbound-resi-${p.id}`} />}
              </Stack>
            </Table.Cell>
            <Table.Cell>
              <InboundStatusBadge status={p.status} />
            </Table.Cell>
            <Table.Cell>
              <Span color="fg.muted">—</Span>
            </Table.Cell>
            <Table.Cell>
              <Span fontSize="xs" whiteSpace="nowrap">
                {formatUnixDateTimeShort(p.createdAtUnix)}
              </Span>
            </Table.Cell>
            <Table.Cell>
              {p.arrivedAtUnix > 0n ? (
                <Stack gap="0">
                  <Span fontSize="xs" whiteSpace="nowrap">
                    {formatUnixDateTimeShort(p.arrivedAtUnix)}
                  </Span>
                  {by && (
                    <Span fontSize="xs" color="fg.muted" whiteSpace="nowrap">
                      {t("restock.table.by", { name: by })}
                    </Span>
                  )}
                </Stack>
              ) : (
                <Span color="fg.muted">—</Span>
              )}
            </Table.Cell>
            <Table.Cell textAlign="end" onClick={stop}>
              <InboundActions parcel={p} side="warehouse" variant="row" />
            </Table.Cell>
          </Table.Row>
        );
      })}
    </>
  );
}

// ── THE SELLER'S KIRIM PAKET — one row in its table's nine columns, a block on a phone ───────────────────────────────────

/** The page's inbound parcels on the seller's list — their names (warehouse, courier, who asked) resolved in one read each. */
export function SellingInboundRows({ parcels, phone }: { parcels: InboundParcel[]; phone: boolean }) {
  const { t } = useTranslation();
  const teams = useTeamsByIds({ ids: parcels.map((p) => p.warehouseId) });
  const couriers = useShipmentChannelsByIds(parcels.map((p) => p.shipmentChannelId));
  const actors = useActors(parcels.map((p) => p.createdByUserId));
  if (parcels.length === 0) return null;

  return (
    <>
      {parcels.map((p) => (
        <SellingInboundRow
          key={p.id.toString()}
          parcel={p}
          phone={phone}
          warehouseName={teams.data?.[p.warehouseId.toString()]?.name || t("customShipment.teamRef", { id: p.warehouseId.toString() })}
          courier={couriers.data?.get(p.shipmentChannelId.toString())}
          by={p.createdByUserId > 0n ? personName(actors.data?.get(p.createdByUserId.toString())) : ""}
        />
      ))}
    </>
  );
}

/** One inbound parcel on the seller's list — the page resolves the names for the whole page (warehouse, courier, who). */
export function SellingInboundRow({
  parcel: p,
  phone,
  warehouseName,
  courier,
  by,
}: {
  parcel: InboundParcel;
  phone: boolean;
  warehouseName: string;
  courier?: ShipmentChannel;
  by: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stop = (e: MouseEvent) => e.stopPropagation();
  const open = () => navigate(inboundParcelPath(p.id));
  const fromLine = t("restockResolution.inbound.fromSupplier", { name: supplierOf(t, p) });
  const forLine = t("restockResolution.inbound.forRestockShort", { id: p.restockId.toString() });

  if (phone) {
    return (
      <Stack data-testid={`custom-shipment-row-in-${p.id}`} borderWidth="1px" borderRadius="md" p="4" gap="2" minW="0" {...PRESSABLE} onClick={open}>
        <Flex align="center" gap="2" minW="0" wrap="wrap">
          <Text fontWeight="bold">#{p.id.toString()}</Text>
          <InboundStatusBadge status={p.status} />
          <InboundKindBadge />
          <Spacer />
          <Box display="inline-flex" onClick={stop}>
            <InboundActions parcel={p} side="selling" variant="compact" />
          </Box>
        </Flex>
        <Text fontSize="sm" fontWeight="medium" wordBreak="break-word">
          {fromLine}
          <Span color="fg.muted" fontWeight="normal">{` · ${forLine}`}</Span>
        </Text>
        <Text fontSize="sm">{warehouseName}</Text>
        <Flex align="flex-start" justify="space-between" gap="3" minW="0">
          <ItemsCell parcel={p} />
          <Text fontWeight="bold" whiteSpace="nowrap">
            {formatRupiahNumber(valueOf(p))}
          </Text>
        </Flex>
        <Flex align="center" gap="2" wrap="wrap">
          <ShipmentChannelBadge channelId={p.shipmentChannelId} channel={courier} />
          <Span fontSize="xs" color="fg.muted">
            {p.resi || t("restockResolution.inbound.noResi")}
          </Span>
        </Flex>
        <Text fontSize="xs" color="fg.muted" truncate>
          {formatUnixDateTimeShort(p.createdAtUnix)}
          {by && ` · ${t("customShipment.table.by", { name: by })}`}
        </Text>
      </Stack>
    );
  }

  return (
    <Table.Row data-testid={`custom-shipment-row-in-${p.id}`} cursor="pointer" _hover={{ bg: "bg.subtle" }} onClick={open}>
      <Table.Cell>
        <Stack gap="1" align="start">
          <Span fontWeight="medium">#{p.id.toString()}</Span>
          <InboundStatusBadge status={p.status} />
        </Stack>
      </Table.Cell>
      <Table.Cell>
        <InboundKindBadge />
      </Table.Cell>
      <Table.Cell>
        <Stack gap="0">
          <Span>{fromLine}</Span>
          <Span fontSize="xs" color="fg.muted">
            {forLine}
          </Span>
        </Stack>
      </Table.Cell>
      <Table.Cell>{warehouseName}</Table.Cell>
      <Table.Cell>
        <ItemsCell parcel={p} />
      </Table.Cell>
      <Table.Cell onClick={stop}>
        <Stack gap="0" align="start">
          <ShipmentChannelBadge channelId={p.shipmentChannelId} channel={courier} />
          <Span fontSize="xs" color="fg.muted">
            {p.resi || t("restockResolution.inbound.noResi")}
          </Span>
        </Stack>
      </Table.Cell>
      <Table.Cell>
        <Stack gap="0">
          <Span fontSize="sm" whiteSpace="nowrap">
            {formatUnixDateTimeShort(p.createdAtUnix)}
          </Span>
          {by && (
            <Span fontSize="xs" color="fg.muted">
              {t("customShipment.table.by", { name: by })}
            </Span>
          )}
        </Stack>
      </Table.Cell>
      <Table.Cell textAlign="end" whiteSpace="nowrap" data-testid={`inbound-value-${p.id}`}>
        {formatRupiahNumber(valueOf(p))}
      </Table.Cell>
      <Table.Cell textAlign="end" onClick={stop}>
        <InboundActions parcel={p} side="selling" variant="compact" />
      </Table.Cell>
    </Table.Row>
  );
}
