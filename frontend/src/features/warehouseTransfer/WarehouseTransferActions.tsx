import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Box, Button, Field, HStack, Icon, IconButton, Input, Menu, Portal, Stack } from "@chakra-ui/react";
import { ClipboardCheck, MoreHorizontal, PackageCheck, PackageOpen, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { WarehouseTransfer } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { WarehouseTransferStatus as S } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import { useArriveWarehouseTransfer, useProcessWarehouseTransfer, useShipWarehouseTransfer } from "./queries";
import { directionFor } from "./summary";
import type { PendingList } from "../../features/pending/registry";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { ShipmentChannelSelect } from "../../components/pickers/ShipmentChannelSelect";
import { ReceiptUpload, type ReceiptValue, emptyReceipt } from "../../components/orders/ReceiptUpload";

// WHAT A WAREHOUSE MAY DO TO A TRANSFER, BY STATUS AND BY SIDE — the one matrix both the warehouse list's rows and the
// warehouse detail's header read (the-team-opens-the-sender-ships-the-receiver-accepts). A warehouse is A for the
// transfers leaving it and B for those coming to it, so which acts it sees depends on which end it is:
//
//   A (outgoing)  created  → Process        confirm and print the pick list; from here the team cannot cancel
//                 process  → Ship           courier, tracking number, label photo (the-sender-enters-the-courier-at-ship)
//   B (incoming)  shipped  → Sign · Accept  a box opened and counted on arrival is signed and accepted as one act
//                 arrived  → Accept         signed for, waiting to be counted
//                 lost     → Sign           the box turned up after all — signed for as arrived
//
// Cancelling, marking lost and editing the cost are the SELLING team's, and never appear here.
export type WarehouseTransferAction = "process" | "ship" | "arrive" | "accept";

export function warehouseTransferActions(
  status: S,
  side: "outgoing" | "incoming" | "none",
): WarehouseTransferAction[] {
  if (side === "outgoing") {
    if (status === S.CREATED) return ["process"];
    if (status === S.PROCESS) return ["ship"];

    return [];
  }
  if (side === "incoming") {
    if (status === S.SHIPPED) return ["arrive", "accept"];
    if (status === S.ARRIVED) return ["accept"];
    if (status === S.LOST) return ["arrive"];
  }

  return [];
}

const LOOK: Record<WarehouseTransferAction, { icon: LucideIcon; labelKey: string; slug: string; primary?: boolean }> = {
  process: { icon: ClipboardCheck, labelKey: "warehouseTransfer.actions.process", slug: "process", primary: true },
  ship: { icon: Truck, labelKey: "warehouseTransfer.actions.ship", slug: "ship", primary: true },
  arrive: { icon: PackageOpen, labelKey: "warehouseTransfer.actions.arrive", slug: "arrive" },
  accept: { icon: PackageCheck, labelKey: "warehouseTransfer.actions.accept", slug: "accept", primary: true },
};

export interface WarehouseTransferActionsProps {
  transfer: WarehouseTransfer;
  /** The warehouse reading it — A or B, which decides the acts. */
  teamId: bigint;
  /** `row` — small labelled buttons for a list row. `buttons` — a desktop header. `menu` — one ⋯, for a phone header. */
  variant: "row" | "buttons" | "menu";
  /** The screen's pending list — it must carry `labelPhoto`. */
  pending: PendingList<string>;
}

export function WarehouseTransferActions({ transfer, teamId, variant, pending }: WarehouseTransferActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"" | "process" | "ship" | "arrive">("");

  const actions = warehouseTransferActions(transfer.status, directionFor(transfer, teamId));
  if (actions.length === 0) return null;

  const id = transfer.id.toString();

  function run(action: WarehouseTransferAction) {
    if (action === "accept") {
      // Accepting is COUNTING and PUTTING AWAY, line by line — a form with sections, so a PAGE, not a dialog.
      navigate(`/inventories/transfer/${id}/accept`);
      return;
    }
    setDialog(action);
  }

  return (
    <>
      {variant === "menu" ? (
        <Menu.Root>
          <Menu.Trigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t("warehouseTransfer.actions.menu")}
              data-testid={`transfer-actions-${id}`}
            >
              <Icon as={MoreHorizontal} boxSize="4" />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                {actions.map((action) => (
                  <Menu.Item
                    key={action}
                    value={action}
                    data-testid={`transfer-action-${LOOK[action].slug}-${id}`}
                    onSelect={() => run(action)}
                  >
                    <Icon as={LOOK[action].icon} boxSize="4" />
                    {t(LOOK[action].labelKey)}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      ) : (
        <HStack gap={variant === "row" ? "1" : "2"} justify="end" wrap="wrap">
          {actions.map((action) => (
            <Button
              key={action}
              size={variant === "row" ? "xs" : undefined}
              variant={LOOK[action].primary ? "solid" : "outline"}
              colorPalette={LOOK[action].primary ? "brand" : undefined}
              data-testid={`transfer-action-${LOOK[action].slug}-${id}`}
              onClick={() => run(action)}
            >
              <Icon as={LOOK[action].icon} boxSize="4" />
              {t(LOOK[action].labelKey)}
            </Button>
          ))}
        </HStack>
      )}

      {dialog === "process" && <ProcessDialog transfer={transfer} teamId={teamId} onClose={() => setDialog("")} />}
      {dialog === "ship" && (
        <ShipDialog transfer={transfer} teamId={teamId} pending={pending} onClose={() => setDialog("")} />
      )}
      {dialog === "arrive" && <ArriveDialog transfer={transfer} teamId={teamId} onClose={() => setDialog("")} />}
    </>
  );
}

// PROCESS — A confirms it will send the box and starts picking. It is the moment the team loses its cancel
// (cancel-before-processed-lost-only-in-transit), so it confirms, in the brand colour: it is not destructive.
function ProcessDialog({
  transfer,
  teamId,
  onClose,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const process = useProcessWarehouseTransfer();

  async function confirm() {
    try {
      await process.mutateAsync({ teamId, transferId: transfer.id });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.processed") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.processFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("warehouseTransfer.process.title", { id: transfer.id.toString() })}
      message={t("warehouseTransfer.process.message")}
      confirmLabel={t("warehouseTransfer.actions.process")}
      dismissLabel={t("warehouseTransfer.process.dismiss")}
      onConfirm={confirm}
    />
  );
}

// SHIP — A hands the box over and records what is on the label: the courier, the tracking number, a photo of it
// (the-sender-enters-the-courier-at-ship). All optional: a warehouse's own vehicle has none
// (a-transfer-may-travel-without-a-courier).
function ShipDialog({
  transfer,
  teamId,
  pending,
  onClose,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  pending: PendingList<string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ship = useShipWarehouseTransfer();
  const [shipmentId, setShipmentId] = useState(0n);
  const [receipt, setReceipt] = useState("");
  const [labelPhoto, setLabelPhoto] = useState<ReceiptValue>(emptyReceipt);

  async function confirm() {
    try {
      await ship.mutateAsync({
        teamId,
        transferId: transfer.id,
        shipmentId,
        receipt: receipt.trim(),
        receiptFile: labelPhoto.documentId,
      });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.shipped") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.shipFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("warehouseTransfer.ship.title", { id: transfer.id.toString() })}
      message={t("warehouseTransfer.ship.message")}
      confirmLabel={t("warehouseTransfer.actions.ship")}
      dismissLabel={t("warehouseTransfer.ship.dismiss")}
      onConfirm={confirm}
    >
      <Stack gap="field">
        <Field.Root>
          <Field.Label>{t("warehouseTransfer.ship.courier")}</Field.Label>
          <Box w="full" data-testid="transfer-ship-courier">
            <ShipmentChannelSelect
              value={shipmentId > 0n ? shipmentId : undefined}
              onChange={setShipmentId}
              placeholder={t("warehouseTransfer.ship.courierPlaceholder")}
            />
          </Box>
        </Field.Root>
        <Field.Root>
          <Field.Label>{t("warehouseTransfer.ship.tracking")}</Field.Label>
          <Input
            value={receipt}
            maxLength={100}
            data-testid="transfer-ship-tracking"
            onChange={(e) => setReceipt(e.target.value)}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>
            <HStack gap="1.5">
              {t("warehouseTransfer.ship.labelPhoto")}
              <NotImplemented list={pending} id="labelPhoto" />
            </HStack>
          </Field.Label>
          <Box w="full" data-testid="transfer-ship-label">
            <ReceiptUpload teamId={teamId} value={labelPhoto} onChange={setLabelPhoto} />
          </Box>
          <Field.HelperText>{t("warehouseTransfer.ship.optionalHint")}</Field.HelperText>
        </Field.Root>
      </Stack>
    </ConfirmDialog>
  );
}

// SIGN FOR THE BOX — B received it: shipped (or lost) → arrived. After this the team can no longer set it lost.
function ArriveDialog({
  transfer,
  teamId,
  onClose,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const arrive = useArriveWarehouseTransfer();
  const late = transfer.status === S.LOST;

  async function confirm() {
    try {
      await arrive.mutateAsync({ teamId, transferId: transfer.id });
      toaster.create({ type: "success", title: t("warehouseTransfer.toast.arrived") });
    } catch (err) {
      toaster.create({ type: "error", title: t("warehouseTransfer.toast.arriveFailed"), description: rpcError(err) });
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      destructive={false}
      title={t("warehouseTransfer.arrive.title", { id: transfer.id.toString() })}
      message={late ? t("warehouseTransfer.arrive.messageLost") : t("warehouseTransfer.arrive.message")}
      confirmLabel={t("warehouseTransfer.actions.arrive")}
      dismissLabel={t("warehouseTransfer.arrive.dismiss")}
      onConfirm={confirm}
    />
  );
}
