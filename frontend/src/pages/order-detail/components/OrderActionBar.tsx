import { Button, Flex, Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";

import { NotImplemented } from "../../../features/pending/NotImplemented";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { useOrderActions } from "../../../features/orders/useOrderActions";
import type { RowAction } from "../../../features/orders/rowActions";
import type { OrderStageId } from "../../../features/orders/stages";
import { ORDER_DETAIL_PENDING } from "../pending";

// THE ORDER'S ACTIONS AS BUTTONS — and `⋯` only when there are too many (owner: *"action lebih baik
// langsung muncul, tapi baru kasih opsi ... kalau kebanyakan"*).
//
// The list folds every action behind a kebab because it is a ROW, and twenty rows of buttons is a wall.
// A detail page is about ONE order and has the room — and hiding the only thing somebody came to do
// behind a click costs that click every time.
//
// ⚠ THE RUNNER IS SHARED (`useOrderActions`), so a button here and an item in the list's kebab confirm,
// toast and mutate identically. Only the drawing differs.
//
// ⚠ THE SPLIT, and why each rule:
//
//   ≤ LIMIT actions        → all inline — the common case; every stage but one has one or two
//   > LIMIT                → LIMIT − 1 inline + `⋯` with the rest, so the menu never holds ONE item
//                            (a menu for a single action is a click for nothing)
//   destructive overflow   → Batalkan, Retur, Jadikan Lost fold into `⋯` before a forward action
//   first                    does; the button in reach is the one that moves the order ON
//
// Only one stage reaches the limit today — `processed` at PACKED, read by the warehouse (four) — so the
// collapse is real but rare, which is the point.

/**
 * How many buttons fit before the rest fold.
 *
 * ⚠ THE PHONE GETS NONE (owner: *"heading yang sticky top terlalu ramai"*). One labelled button beside
 * the title was enough to wrap the sticky block onto a second row, with its ⚠ beside it. On a phone every
 * action lives behind `⋯` — one fixed icon slot, even when it holds a single action, because there the
 * cost of a menu is one tap and the cost of a button is the header's height.
 */
const LIMIT = 3;
const LIMIT_COMPACT = 0;

/** Which actions stay as buttons and which fold into `⋯`. Pure, so the rule reads in one place. */
export function splitActions(
  actions: RowAction[],
  limit: number,
): { inline: RowAction[]; overflow: RowAction[] } {
  // Forward actions first, destructive ones last, keeping each group's own order from the table — in
  // the row of buttons as well as in the fold, so a red "Batalkan" is never the first thing in reach.
  const ranked = [
    ...actions.filter((a) => !a.destructive),
    ...actions.filter((a) => a.destructive),
  ];

  if (limit === 0) {
    return { inline: [], overflow: ranked };
  }

  if (ranked.length <= limit) {
    return { inline: ranked, overflow: [] };
  }

  // ⚠ ONE FEWER THAN THE LIMIT, so `⋯` always holds at least two. With four actions and a limit of
  // three, "three buttons + a menu of one" is a menu nobody needed.
  const keep = Math.max(1, limit - 1);

  return { inline: ranked.slice(0, keep), overflow: ranked.slice(keep) };
}

export function OrderActionBar({
  teamId,
  orderId,
  status,
  stage,
  warehouseId,
  compact = false,
}: {
  teamId: bigint | undefined;
  orderId: bigint;
  status: OrderStatus;
  stage: OrderStageId | undefined;
  warehouseId: bigint;
  /** A phone: no buttons, every action in `⋯`. */
  compact?: boolean;
}) {
  const { t } = useTranslation();

  const { actions, press, dialog } = useOrderActions({
    teamId,
    orderId,
    status,
    stage,
    warehouseId,
    pendingNs: ORDER_DETAIL_PENDING.ns,
  });

  // An end state offers nothing, and nothing is drawn — not an empty bar, not a disabled button.
  if (actions.length === 0) {
    return dialog;
  }

  const { inline, overflow } = splitActions(actions, compact ? LIMIT_COMPACT : LIMIT);

  return (
    <>
      <Flex gap="2" align="center" wrap="wrap" justify="flex-end" data-testid="order-action-bar">
        {inline.map((action) => (
          <Button
            key={action.id}
            variant="outline"
            // A status is a ROLE, never a hue — `error` for the destructive ones.
            colorPalette={action.destructive ? "error" : "gray"}
            data-testid={`order-action-${action.id}`}
            onClick={() => press(action)}
          >
            <Icon as={action.icon} boxSize="4" />
            {t(`orders.rowAction.${action.id}`)}
            {action.pending && <NotImplemented list={ORDER_DETAIL_PENDING} id={action.pending} />}
          </Button>
        ))}

        {overflow.length > 0 && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                variant="outline"
                aria-label={t("orders.actions")}
                data-testid="order-action-more"
              >
                <Icon as={MoreHorizontal} boxSize="4" />
              </IconButton>
            </Menu.Trigger>

            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  {overflow.map((action) => (
                    <Menu.Item
                      key={action.id}
                      value={action.id}
                      color={action.destructive ? "fg.error" : undefined}
                      data-testid={`order-action-${action.id}`}
                      onClick={() => press(action)}
                    >
                      <Icon as={action.icon} boxSize="4" />
                      {t(`orders.rowAction.${action.id}`)}
                      {action.pending && (
                        <NotImplemented list={ORDER_DETAIL_PENDING} id={action.pending} />
                      )}
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        )}
      </Flex>

      {dialog}
    </>
  );
}
