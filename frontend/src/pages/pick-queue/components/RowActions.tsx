import { useTranslation } from "react-i18next";
import { Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { ArrowRight, Eye, MoreHorizontal, PackageSearch, Printer, Undo2 } from "lucide-react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import type { WarehouseStep } from "../steps";
import { STEP_MOVES, isBack, stepLabelKey, stepOfStatus } from "../steps";

// ONE ORDER'S ACTIONS — the moves its step allows, by the owner's table, then finding the parcel, the label, and the
// order's pick page.
//
// ⚠ NEVER "Move to Picked": a confirmed order is picked on its pick page, after every line is scanned exact
// (the-item-scans-live-on-the-page) — Open Pick List is its way there. A monitoring team (`canMove` false) gets no move
// at all, only what reads.
export function RowActions({
  order,
  canMove,
  onMove,
  onFind,
  onPrint,
  onOpen,
}: {
  order: Order;
  /** Whether this person may move the order — false for a team they only monitor (canWrite). */
  canMove: boolean;
  onMove: (to: WarehouseStep) => void;
  onFind: () => void;
  onPrint: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const from = stepOfStatus(order.status);
  const moves = from && canMove ? STEP_MOVES[from] : [];
  const hasReceipt = Boolean(order.receipt?.documentId);

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("warehouseOrders.row.actions")}
          data-testid={`pick-queue-actions-${order.id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon as={MoreHorizontal} boxSize="4" />
        </IconButton>
      </Menu.Trigger>

      <Portal>
        <Menu.Positioner>
          <Menu.Content onClick={(e) => e.stopPropagation()}>
            {from &&
              moves.map((to) => (
                <Menu.Item
                  key={to}
                  value={`move-${to}`}
                  color={isBack(from, to) ? "fg.warning" : undefined}
                  data-testid={`pick-queue-move-${order.id}-${to}`}
                  onClick={() => onMove(to)}
                >
                  <Icon as={isBack(from, to) ? Undo2 : ArrowRight} boxSize="4" />
                  {t(isBack(from, to) ? "warehouseOrders.row.backTo" : "warehouseOrders.row.moveTo", {
                    step: t(stepLabelKey(to)),
                  })}
                </Menu.Item>
              ))}

            {/* Once it is boxed it goes into a sack — finding it again is a scan through the pile. */}
            {(from === "picked" || from === "handover") && (
              <Menu.Item value="find" data-testid={`pick-queue-find-${order.id}`} onClick={onFind}>
                <Icon as={PackageSearch} boxSize="4" />
                {t("warehouseOrders.row.findParcel")}
              </Menu.Item>
            )}

            {/* No handler while disabled — a disabled item's DOM click still fires. */}
            <Menu.Item
              value="print"
              disabled={!hasReceipt}
              data-testid={`pick-queue-print-${order.id}`}
              onClick={hasReceipt ? onPrint : undefined}
            >
              <Icon as={Printer} boxSize="4" />
              {hasReceipt ? t("warehouseOrders.row.printLabel") : t("warehouseOrders.row.noReceipt")}
            </Menu.Item>

            <Menu.Item value="open" data-testid={`pick-queue-open-${order.id}`} onClick={onOpen}>
              <Icon as={Eye} boxSize="4" />
              {t("warehouseOrders.row.open")}
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
