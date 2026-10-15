import { useTranslation } from "react-i18next";
import { Badge, Tabs } from "@chakra-ui/react";
import { ORDER_STATUS_TABS } from "./statusTabs";

export interface OrderTabsProps {
  /** The active tab: a status value. */
  value: string;
  /** Called with the newly selected tab value. */
  onSelect: (value: string) => void;
  /** The badge for one status tab. */
  count: (value: string) => number;
}

// The warehouse order list's tab strip — the statuses. Drafts is not on it: the drafts are a list of their own, reached
// from the menu (`the-drafts-are-a-list-of-their-own`), and a warehouse never has one.
export function OrderTabs({ value, onSelect, count }: OrderTabsProps) {
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

        {/* One underline, sliding to the picked tab (motion-is-small-quick-and-shared). The rows under it do not fade:
            a tab is a filter (a-filter-answers-as-it-changes). */}
        <Tabs.Indicator />
      </Tabs.List>
    </Tabs.Root>
  );
}
