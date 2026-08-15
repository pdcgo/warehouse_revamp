import { useTranslation } from "react-i18next";
import { Badge, Tabs } from "@chakra-ui/react";
import { ORDER_STATUS_TABS } from "./statusTabs";

// The value the DRAFTS tab carries. Not an OrderStatus — a draft is not an order in some state, it is
// a different record in a different table — so it lives beside the statuses rather than in
// ORDER_STATUS_TABS, and every caller has to decide what selecting it means.
export const DRAFTS_TAB = "drafts";

export interface OrderTabsProps {
  /** The active tab: a status value, or DRAFTS_TAB. */
  value: string;
  /** Called with the newly selected tab value. The caller decides whether that is a filter or a
   *  navigation — the two screens answer differently. */
  onSelect: (value: string) => void;
  /** The badge for one status tab. */
  count: (value: string) => number;
  /** How many drafts are waiting. Undefined hides the badge — a screen that has not counted them
   *  shows no number rather than a confident 0. */
  draftCount?: number;
}

// The order list's tab strip — the statuses, and DRAFTS at the end (owner).
//
// Drafts used to be a sidebar item of its own, on the argument that a draft was never an order and the
// menu should say so. It still is not an order, and the schema and the route still say so — but the
// PERSON does not go looking for "drafts", they go looking for the order they were half-way through
// typing. That is the orders screen, so this is where the way in belongs.
//
// It is SHARED between the two screens so the strip cannot drift: the same triggers in the same order,
// with the same counts, whichever of them you are standing on.
export function OrderTabs({ value, onSelect, count, draftCount }: OrderTabsProps) {
  const { t } = useTranslation();

  return (
    <Tabs.Root value={value} onValueChange={(e) => onSelect(e.value)}>
      <Tabs.List>
        {ORDER_STATUS_TABS.map((item) => (
          <Tabs.Trigger key={item.value} value={item.value} data-testid={`orders-tab-${item.value}`}>
            {t(item.labelKey)}
            <Badge size="xs" variant="subtle" data-testid={`orders-tab-count-${item.value}`}>
              {count(item.value)}
            </Badge>
          </Tabs.Trigger>
        ))}

        <Tabs.Trigger value={DRAFTS_TAB} data-testid={`orders-tab-${DRAFTS_TAB}`}>
          {t("orders.tab.drafts")}
          {draftCount !== undefined && (
            <Badge size="xs" variant="subtle" data-testid={`orders-tab-count-${DRAFTS_TAB}`}>
              {draftCount}
            </Badge>
          )}
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
  );
}
