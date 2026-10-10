import { useTranslation } from "react-i18next";
import { Box, Card, Flex, HStack, Icon, Separator, Stack, Text, Timeline } from "@chakra-ui/react";
import {
  ArrowRight,
  Ban,
  ClipboardCheck,
  Clock,
  FilePlus2,
  PackageCheck,
  PackageOpen,
  PackageX,
  Pencil,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  WarehouseTransfer,
  WarehouseTransferLog,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferStatus as S } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useTransferActors } from "./queries";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { UserItem } from "../../components/entity/UserItem";
import { formatUnixDateTime } from "../../lib/datetime";

// THE TRAIL — `transfer.logs`, oldest first (every-transfer-status-change-is-logged). People from three teams move one
// transfer — the selling team, Warehouse A, Warehouse B — and this is where "who declared it lost" and "when did A ship"
// are read. Who did it is resolved by id at read time, never a snapshot.

type Kind = "created" | "edit" | "status";

function kindOf(log: WarehouseTransferLog): Kind {
  if (log.fromStatus === S.UNSPECIFIED) return "created";
  if (log.fromStatus === log.toStatus) return "edit";

  return "status";
}

const STATUS_LOOK: Partial<Record<S, { icon: LucideIcon; titleKey: string; palette: string }>> = {
  [S.PROCESS]: { icon: ClipboardCheck, titleKey: "warehouseTransfer.timeline.process", palette: "purple" },
  [S.SHIPPED]: { icon: Truck, titleKey: "warehouseTransfer.timeline.shipped", palette: "cyan" },
  [S.ARRIVED]: { icon: PackageOpen, titleKey: "warehouseTransfer.timeline.arrived", palette: "orange" },
  [S.ACCEPTED]: { icon: PackageCheck, titleKey: "warehouseTransfer.timeline.accepted", palette: "green" },
  [S.LOST]: { icon: PackageX, titleKey: "warehouseTransfer.timeline.lost", palette: "red" },
  [S.CANCELLED]: { icon: Ban, titleKey: "warehouseTransfer.timeline.cancelled", palette: "gray" },
};

function lookOf(log: WarehouseTransferLog): { icon: LucideIcon; titleKey: string; palette?: string } {
  switch (kindOf(log)) {
    case "created":
      return { icon: FilePlus2, titleKey: "warehouseTransfer.timeline.created" };
    case "edit":
      return { icon: Pencil, titleKey: "warehouseTransfer.timeline.edited" };
    default:
      return STATUS_LOOK[log.toStatus] ?? { icon: Clock, titleKey: "warehouseTransfer.timeline.changed" };
  }
}

// The step that has NOT happened yet, while it still can — the honest end of the sequence rather than a dead stop.
const AWAITING: Partial<Record<S, string>> = {
  [S.CREATED]: "warehouseTransfer.timeline.awaitingProcess",
  [S.PROCESS]: "warehouseTransfer.timeline.awaitingShip",
  [S.SHIPPED]: "warehouseTransfer.timeline.awaitingArrival",
  [S.ARRIVED]: "warehouseTransfer.timeline.awaitingCount",
};

export function TransferTimeline({ transfer }: { transfer: WarehouseTransfer }) {
  const { t } = useTranslation();
  const actors = useTransferActors(transfer.logs.map((log) => log.actorUserId));
  const awaitingKey = AWAITING[transfer.status] ?? "";

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="transfer-detail-timeline">
      <Card.Body>
        <Timeline.Root size="lg" variant="subtle">
          {transfer.logs.map((log, i) => (
            <LogStep
              key={log.id > 0n ? log.id.toString() : `i${i}`}
              log={log}
              actor={actors.data?.get(log.actorUserId.toString())}
            />
          ))}

          {awaitingKey && (
            <Timeline.Item data-testid="transfer-timeline-awaiting">
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

function LogStep({ log, actor }: { log: WarehouseTransferLog; actor?: PublicUser }) {
  const { t } = useTranslation();
  const kind = kindOf(log);
  const look = lookOf(log);
  const fallback = log.actorUserId > 0n ? t("warehouseTransfer.table.userRef", { id: log.actorUserId.toString() }) : "";

  return (
    <Timeline.Item data-testid={`transfer-timeline-${log.id}`} data-kind={kind}>
      <Timeline.Connector>
        <Timeline.Separator />
        <Timeline.Indicator colorPalette={look.palette} color={look.palette ? "colorPalette.fg" : "fg.muted"}>
          <Icon as={look.icon} boxSize="4" />
        </Timeline.Indicator>
      </Timeline.Connector>
      <Timeline.Content>
        <Flex align="center" gap="card" wrap="wrap">
          {actor ? (
            <Box w="auto" maxW="72" flexShrink="0" data-testid={`transfer-timeline-${log.id}-by`}>
              <UserItem user={actor} />
            </Box>
          ) : (
            fallback && (
              <Text fontSize="sm" fontWeight="medium" flexShrink="0">
                {fallback}
              </Text>
            )
          )}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" />}

          <Stack gap="1" minW="0" flex="1">
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t(look.titleKey)}</Timeline.Title>
              {kind === "status" ? (
                <HStack gap="1" data-testid={`transfer-timeline-${log.id}-move`}>
                  <WarehouseTransferStatusBadge status={log.fromStatus} />
                  <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                  <WarehouseTransferStatusBadge status={log.toStatus} />
                </HStack>
              ) : (
                <WarehouseTransferStatusBadge status={log.toStatus} />
              )}
            </HStack>
            {kind !== "created" && log.description && (
              <Text
                fontSize="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                data-testid={`transfer-timeline-${log.id}-description`}
              >
                {log.description}
              </Text>
            )}
            <Timeline.Description>
              {log.atUnix > 0n ? formatUnixDateTime(log.atUnix) : t("warehouseTransfer.timeline.noDate")}
            </Timeline.Description>
          </Stack>
        </Flex>
      </Timeline.Content>
    </Timeline.Item>
  );
}
