import { Badge, Flex, Tabs } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { ALL_STAGE, ORDER_STAGES } from "./stages";

// THE STATUS FILTER: one tab per status, plus All (one-tab-per-status), in the status diagram's order.
// Every tab is a real status now (00015), so each carries its count — a 0 is a measurement.
//
// The seller's order list draws it. Drafts is not on it — the drafts are a list of their own, reached from the menu
// (`the-drafts-are-a-list-of-their-own`). The warehouse's list draws its own steps.
export function StageTabs({
  value,
  onSelect,
  count,
}: {
  /** The active tab: a stage id, or `ALL_STAGE`. */
  value: string;
  onSelect: (value: string) => void;
  /** The badge for one tab. */
  count: (value: string) => number;
}) {
  const { t } = useTranslation();

  return (
    <Flex align="center" gap="2" w="full" minW="0">
      <Tabs.Root
        value={value}
        onValueChange={(e) => onSelect(e.value)}
        flex="1"
        minW="0"
      >
        {/* ⚠ ONE ROW (owner), AND IT SCROLLS SIDEWAYS when it does not fit (one-tab-per-status) — thirteen
            tabs do not fit a laptop, let alone a phone. Scrolling was refused once, while four of the
            tabs could hold no order and would have hidden off the edge with nothing saying they exist;
            every tab is a real status now, so that reason is gone and wrapping to three rows is not.

            ⚠ A TRIGGER MUST REFUSE TO SHRINK. A flex child shrinks before it scrolls, so without
            `flexShrink="0"` the labels squash into each other instead. */}
        <Tabs.List flexWrap="nowrap" overflowX="auto" overflowY="hidden" maxW="full">
          <Tabs.Trigger
            value={ALL_STAGE}
            flexShrink="0"
            whiteSpace="nowrap"
            data-testid={`orders-tab-${ALL_STAGE}`}
          >
            {t("orders.tab.allStatus")}
            <Badge
              size="xs"
              variant="subtle"
              data-testid={`orders-tab-count-${ALL_STAGE}`}
            >
              {count(ALL_STAGE)}
            </Badge>
          </Tabs.Trigger>

          {ORDER_STAGES.map((stage) => (
            <Tabs.Trigger
              key={stage.id}
              value={stage.id}
              flexShrink="0"
              whiteSpace="nowrap"
              data-testid={`orders-tab-${stage.id}`}
            >
              {t(`orders.stage.${stage.id}`)}
              <Badge size="xs" variant="subtle" data-testid={`orders-tab-count-${stage.id}`}>
                {count(stage.id)}
              </Badge>
            </Tabs.Trigger>
          ))}

          {/* One underline, sliding to the picked tab (motion-is-small-quick-and-shared). The rows under it do not fade:
              a tab is a filter (a-filter-answers-as-it-changes). */}
          <Tabs.Indicator />
        </Tabs.List>
      </Tabs.Root>

    </Flex>
  );
}
