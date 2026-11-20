import { useTranslation } from "react-i18next";
import { Box, Card, Flex, HStack, Icon, Separator, Stack, Text, Timeline } from "@chakra-ui/react";
import { ArrowRight, Ban, Clock, FilePlus2, PackageCheck, Pencil, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useActors } from "../users/queries";
import { UserItem } from "../../components/entity/UserItem";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import type { CustomShipment, CustomShipmentLog, CustomShipmentStatus } from "./customShipments";
import { noteOfLog } from "./customShipments";
import { CustomShipmentStatusBadge } from "./CustomShipmentBadges";
import { GoodsMissingStep } from "./GoodsMissing";

// THE TRAIL — `shipment.logs`, oldest first, as the transfer's (TransferTimeline): who moved it, when, and from which
// status. People from two teams move one parcel — the selling team creates it, edits its ongkir, cancels it; the
// warehouse picks it and hands it over — and this is where "who handed it over, and what did the courier cost" is read.
// The steps are requested → picked → handed over (its end), or cancelled; the step not taken yet ends the trail, muted,
// while it still can be. The warehouse's *Barang tidak ketemu* note (backlog #88 P6) is a row of its own kind — from = to
// as a cost edit, so its `kind` (never its statuses) says what it is — drawn by GoodsMissingStep.

type Kind = "created" | "edit" | "status";

const kindOf = (log: CustomShipmentLog): Kind =>
  log.fromStatus === "NONE" ? "created" : log.kind === "COST_EDIT" || log.fromStatus === log.toStatus ? "edit" : "status";

const STATUS_LOOK: Partial<Record<CustomShipmentStatus, { icon: LucideIcon; titleKey: string; palette: string }>> = {
  PICKED: { icon: PackageCheck, titleKey: "customShipment.timeline.picked", palette: "purple" },
  HANDED_OVER: { icon: Truck, titleKey: "customShipment.timeline.handedOver", palette: "green" },
  CANCELLED: { icon: Ban, titleKey: "customShipment.timeline.cancelled", palette: "gray" },
};

const AWAITING: Partial<Record<CustomShipmentStatus, string>> = {
  REQUESTED: "customShipment.timeline.awaitingPick",
  PICKED: "customShipment.timeline.awaitingHandover",
};

export function CustomShipmentTimeline({
  shipment,
  side,
}: {
  shipment: CustomShipment;
  side: "selling" | "warehouse";
}) {
  const { t } = useTranslation();
  const actors = useActors(shipment.logs.map((log) => log.actorUserId));
  const awaitingKey = AWAITING[shipment.status] ?? "";

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="custom-shipment-timeline">
      <Card.Header>
        <Card.Title>{t("customShipment.timeline.title")}</Card.Title>
      </Card.Header>
      <Card.Body>
        <Timeline.Root size="lg" variant="subtle">
          {shipment.logs.map((log) =>
            log.kind === "GOODS_MISSING" ? (
              <GoodsMissingStep key={`missing-${log.id}`} note={noteOfLog(log)} shipment={shipment} side={side} />
            ) : (
              <Step
                key={log.id.toString()}
                log={log}
                shipment={shipment}
                side={side}
                actor={actors.data?.get(log.actorUserId.toString())}
              />
            ),
          )}

          {awaitingKey && (
            <Timeline.Item data-testid="custom-shipment-timeline-awaiting">
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator color="fg.muted" opacity={0.6}>
                  <Icon as={Clock} boxSize="4" />
                </Timeline.Indicator>
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title color="fg.muted">{t(awaitingKey)}</Timeline.Title>
              </Timeline.Content>
            </Timeline.Item>
          )}
        </Timeline.Root>
      </Card.Body>
    </Card.Root>
  );
}

function Step({
  log,
  shipment,
  side,
  actor,
}: {
  log: CustomShipmentLog;
  shipment: CustomShipment;
  side: "selling" | "warehouse";
  actor?: Parameters<typeof UserItem>[0]["user"];
}) {
  const { t } = useTranslation();
  const kind = kindOf(log);
  const look =
    kind === "created"
      ? { icon: FilePlus2, titleKey: "customShipment.timeline.created", palette: "blue" }
      : kind === "edit"
        ? { icon: Pencil, titleKey: "customShipment.timeline.costEdited", palette: undefined }
        : (STATUS_LOOK[log.toStatus] ?? { icon: Clock, titleKey: "customShipment.timeline.changed", palette: undefined });
  const testId = `custom-shipment-timeline-${log.id}`;
  const fallback = log.actorUserId > 0n ? t("customShipment.userRef", { id: log.actorUserId.toString() }) : "";

  // What the handover settled about the courier, said on its own row: the warehouse's cost when it paid (both sides
  // read it — it is the warehouse's own money and the team's debt), else that the team paid; and the resi when typed.
  const handoverFacts =
    kind === "status" && log.toStatus === "HANDED_OVER"
      ? [
          shipment.payer === "WAREHOUSE"
            ? t("customShipment.timeline.warehousePaid", { amount: formatRupiahNumber(shipment.shippingCost ?? 0) })
            : t(side === "selling" ? "customShipment.timeline.teamPaid" : "customShipment.timeline.teamPaidForWarehouse"),
          shipment.resi ? t("customShipment.timeline.resi", { resi: shipment.resi }) : "",
        ].filter(Boolean)
      : [];

  return (
    <Timeline.Item data-testid={testId} data-kind={kind}>
      <Timeline.Connector>
        <Timeline.Separator />
        <Timeline.Indicator colorPalette={look.palette} color={look.palette ? "colorPalette.fg" : "fg.muted"}>
          <Icon as={look.icon} boxSize="4" />
        </Timeline.Indicator>
      </Timeline.Connector>
      <Timeline.Content>
        <Flex align="center" gap="card" wrap="wrap">
          {actor ? (
            <Box w="auto" maxW="72" flexShrink="0" data-testid={`${testId}-by`}>
              <UserItem user={actor} />
            </Box>
          ) : (
            fallback && (
              <Text fontSize="sm" fontWeight="medium" flexShrink="0">
                {fallback}
              </Text>
            )
          )}
          {(actor || fallback) && log.isOverride && <RootTeamBadge />}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" />}

          <Stack gap="1" minW="0" flex="1">
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t(look.titleKey)}</Timeline.Title>
              {kind === "status" ? (
                <HStack gap="1" data-testid={`${testId}-move`}>
                  <CustomShipmentStatusBadge status={log.fromStatus as CustomShipmentStatus} />
                  <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                  <CustomShipmentStatusBadge status={log.toStatus} />
                </HStack>
              ) : (
                kind === "created" && <CustomShipmentStatusBadge status={log.toStatus} />
              )}
            </HStack>
            {log.description && (
              <Text fontSize="sm" wordBreak="break-word" data-testid={`${testId}-description`}>
                {log.description}
              </Text>
            )}
            {handoverFacts.map((fact) => (
              <Text key={fact} fontSize="sm" data-testid={`${testId}-fact`}>
                {fact}
              </Text>
            ))}
            <Timeline.Description>{formatUnixDateTime(log.atUnix)}</Timeline.Description>
          </Stack>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}
