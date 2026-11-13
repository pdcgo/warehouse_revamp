import { useTranslation } from "react-i18next";
import { create } from "@bufbuild/protobuf";
import { Box, Card, Flex, HStack, Icon, Separator, Stack, Text, Timeline } from "@chakra-ui/react";
import {
  ArrowRight,
  Ban,
  ClipboardCheck,
  ClipboardPen,
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
import {
  WarehouseTransferLogSchema,
  WarehouseTransferStatus as S,
} from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import type { ReceivedCountCorrection } from "../../gen/warehouse/inventory/v1/received_count_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { useTransferActors } from "./queries";
import { WarehouseTransferStatusBadge } from "../../components/badges/WarehouseTransferStatusBadge";
import { UserItem } from "../../components/entity/UserItem";
import { RootTeamBadge } from "../../components/entity/ActorName";
import { formatUnixDateTime } from "../../lib/datetime";
import { trailOf } from "../receivedCount/corrections";
import { CorrectionStep } from "../restock/RestockTimeline";

// THE TRAIL — `transfer.logs`, oldest first (every-transfer-status-change-is-logged). People from three teams move one
// transfer — the selling team, Warehouse A, Warehouse B — and this is where "who declared it lost" and "when did A ship"
// are read. Who did it is resolved by id at read time, never a snapshot. KOREKSI JUMLAH TERIMA's rows sit in the same
// trail, by time (`transfer.count_corrections`) — their own kind, never a status row.

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
  const actors = useTransferActors([
    ...transfer.logs.map((log) => log.actorUserId),
    ...transfer.countCorrections.map((c) => c.actorUserId),
  ]);
  const awaitingKey = AWAITING[transfer.status] ?? "";
  const trail = trailOf(transfer.logs, transfer.countCorrections);
  const nameOf = (c: ReceivedCountCorrection) => transfer.items.find((item) => item.id === c.itemId)?.name ?? "";

  return (
    <Card.Root maxW="full" overflow="hidden" data-testid="transfer-detail-timeline">
      <Card.Body>
        <Timeline.Root size="lg" variant="subtle">
          {trail.map((step, i) =>
            step.kind === "log" ? (
              <LogStep
                key={step.log.id > 0n ? step.log.id.toString() : `i${i}`}
                log={step.log}
                actor={actors.data?.get(step.log.actorUserId.toString())}
              />
            ) : (
              <LogStep
                key={`c${step.correction.id}`}
                log={correctionLog(step.correction)}
                actor={actors.data?.get(step.correction.actorUserId.toString())}
                correction={step.correction}
                productName={nameOf(step.correction)}
              />
            ),
          )}

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

// A correction's row drawn by the trail's own step: its person, Root stamp and time — on an accepted transfer.
function correctionLog(c: ReceivedCountCorrection): WarehouseTransferLog {
  return create(WarehouseTransferLogSchema, {
    id: c.id,
    fromStatus: S.ACCEPTED,
    toStatus: S.ACCEPTED,
    actorUserId: c.actorUserId,
    atUnix: c.atUnix,
    isOverride: c.isOverride,
  });
}

function LogStep({
  log,
  actor,
  correction,
  productName = "",
}: {
  log: WarehouseTransferLog;
  actor?: PublicUser;
  /** The received-count correction this row stands for — its own kind, never a status row. */
  correction?: ReceivedCountCorrection;
  productName?: string;
}) {
  const { t } = useTranslation();
  const kind = correction ? "correction" : kindOf(log);
  const look = correction ? { icon: ClipboardPen, titleKey: "", palette: "orange" } : lookOf(log);
  const fallback = log.actorUserId > 0n ? t("warehouseTransfer.table.userRef", { id: log.actorUserId.toString() }) : "";
  // A correction's row id is its own table's — kept apart from the trail's ids.
  const testId = correction ? `transfer-timeline-c${correction.id}` : `transfer-timeline-${log.id}`;

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
          {/* A step Root or the System Administrator took from outside the team: the shared "by Root team" badge right
              after the person (an-override-shows-a-platform-badge). */}
          {(actor || fallback) && log.isOverride && <RootTeamBadge />}
          {(actor || fallback) && <Separator orientation="vertical" height="auto" alignSelf="stretch" />}

          <Stack gap="1" minW="0" flex="1">
            {correction ? (
              <CorrectionStep correction={correction} productName={productName} testId={testId} />
            ) : (
            <HStack gap="2" wrap="wrap">
              <Timeline.Title>{t(look.titleKey)}</Timeline.Title>
              {kind === "status" ? (
                <HStack gap="1" data-testid={`${testId}-move`}>
                  <WarehouseTransferStatusBadge status={log.fromStatus} />
                  <Icon as={ArrowRight} boxSize="3" color="fg.muted" />
                  <WarehouseTransferStatusBadge status={log.toStatus} />
                </HStack>
              ) : (
                <WarehouseTransferStatusBadge status={log.toStatus} />
              )}
            </HStack>
            )}
            {!correction && kind !== "created" && log.description && (
              <Text
                fontSize="sm"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                data-testid={`${testId}-description`}
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
