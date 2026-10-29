import { Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Eye, MoreHorizontal } from "lucide-react";

import { useOrderActions } from "../../../features/orders/useOrderActions";
import type { OrderStageId } from "../../../features/orders/stages";

// THE ROW'S ACTIONS — the house kebab, rendering the owner's per-status table (`rowActions.ts`).
//
// ⚠ IT ONLY DRAWS. Which actions an order offers is `rowActions.ts`; what pressing one does is
// `useOrderActions`, shared with the detail page's button bar. Two screens drawing the same actions
// differently is fine; two screens RUNNING them differently is the drift a shared runner prevents.
//
// ⚠ A KEBAB, BECAUSE THIS IS A ROW. Twenty rows of two or three buttons each is a wall between the
// person and the table. The detail page is about ONE order and has the room, so it shows buttons and
// folds only the overflow.
//
// ⚠ ALL SEVEN ARE REAL: cancel calls `OrderCancel`, the moves call `OrderStatusChange`, and Edit Resi opens its
// dialog (`OrderReceiptUpdate`).

export function OrderRowActions({
  teamId,
  orderId,
  stage,
  warehouseId,
}: {
  /** The team whose list this is — the caller, not the order's owner. */
  teamId: bigint | undefined;
  orderId: bigint;
  /** Which status the order is in — the key to the action table. */
  stage: OrderStageId | undefined;
  /** The warehouse fulfilling it. Equal to `teamId` when a crew is reading its own queue. */
  warehouseId: bigint;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { actions, press, dialog } = useOrderActions({
    teamId,
    orderId,
    stage,
    warehouseId,
  });

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={t("orders.actions")}
            data-testid={`order-actions-${orderId}`}
          >
            <Icon as={MoreHorizontal} boxSize="4" />
          </IconButton>
        </Menu.Trigger>

        <Portal>
          <Menu.Positioner>
            <Menu.Content>
              {/* Always first, and always real — every order can be opened. */}
              <Menu.Item
                value="detail"
                data-testid={`order-detail-${orderId}`}
                onClick={() => navigate(`/orders/${orderId}`)}
              >
                <Icon as={Eye} boxSize="4" />
                {t("orders.viewDetail")}
              </Menu.Item>

              {actions.map((action) => (
                <Menu.Item
                  key={action.id}
                  value={action.id}
                  color={action.destructive ? "fg.error" : undefined}
                  data-testid={`order-${action.id}-${orderId}`}
                  onClick={() => press(action)}
                >
                  <Icon as={action.icon} boxSize="4" />
                  {t(`orders.rowAction.${action.id}`)}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      {dialog}
    </>
  );
}
