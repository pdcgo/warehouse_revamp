import { useTranslation } from "react-i18next";
import { Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { ArrowRight, Eye, MoreHorizontal, PackageSearch, Printer, ScanLine, Undo2 } from "lucide-react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { WAREHOUSE_ORDERS_PENDING } from "../pending";
import type { WarehouseStep } from "../steps";
import { STEP_MOVES, isBack, rpcFor, stepLabelKey, stepOfStatus } from "../steps";

// ONE ORDER'S ACTIONS — the moves its step allows, by the owner's table, then the scans and the label.
//
// Every move on offer is ALLOWED; a move the RPCs cannot make yet still shows, with its ⚠, because the
// owner's table is the design and the RPCs are what is late.
export function RowActions({
  order,
  onMove,
  onValidate,
  onFind,
  onPrint,
  onOpen,
}: {
  order: Order;
  onMove: (to: WarehouseStep) => void;
  onValidate: () => void;
  onFind: () => void;
  onPrint: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const from = stepOfStatus(order.status);
  const moves = from ? STEP_MOVES[from] : [];
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
                  {rpcFor(from, to) === undefined && <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="stepMove" />}
                </Menu.Item>
              ))}

            {/* While the goods are being taken off the shelves — the scan that proves every line is exact. */}
            {(from === "picking" || from === "picked") && (
              <Menu.Item value="validate" data-testid={`pick-queue-validate-${order.id}`} onClick={onValidate}>
                <Icon as={ScanLine} boxSize="4" />
                {t("warehouseOrders.row.validate")}
                <NotImplemented list={WAREHOUSE_ORDERS_PENDING} id="barcode" />
              </Menu.Item>
            )}

            {/* Once it is boxed it goes into a sack — finding it again is a scan through the pile. */}
            {(from === "packed" || from === "handover") && (
              <Menu.Item value="find" data-testid={`pick-queue-find-${order.id}`} onClick={onFind}>
                <Icon as={PackageSearch} boxSize="4" />
                {t("warehouseOrders.row.findParcel")}
              </Menu.Item>
            )}

            <Menu.Item value="print" disabled={!hasReceipt} data-testid={`pick-queue-print-${order.id}`} onClick={onPrint}>
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
