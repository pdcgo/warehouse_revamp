import { Badge, Box, Flex, Tabs } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDERS_LIST_PENDING } from "../pending";
import { ALL_STAGE, ORDER_STAGES, stageIsOnTheWire } from "../stages";

/** The value the DRAFTS tab carries — not a stage: a draft is a different record in a different table. */
export const DRAFTS_TAB = "drafts";

// THE STATUS FILTER, OVER THE OWNER'S EIGHT (owner).
//
// `docs/business/order/context.md` §Order Status decided the set; this strip is that set, in that
// order, whatever the contract can currently serve. The alternative — tabs that mirror the six enum
// values the build happens to have — would put a vocabulary on screen that the owner's own doc
// already records as stale, and the screen would have to be rebuilt when the migration lands.
//
// ⚠ FOUR OF THE EIGHT CAN NEVER BE ANYTHING BUT 0 TODAY, and one more counts but cannot filter. Both
// are the same cause — the enum has not migrated — so both carry ONE mark, `statusSet`, rather than
// five. See `pending.ts`.
//
// ⚠ IT IS A PREVIEW-LOCAL COPY OF `features/orders/OrderTabs`, deliberately. That one is shared by
// the live order list and the drafts screen, and it renders the six proto statuses; changing it would
// change two screens that are not being reviewed. When this preview is promoted it replaces that one.
export function StageTabs({
  value,
  onSelect,
  count,
  draftCount,
}: {
  /** The active tab: a stage id, `ALL_STAGE`, or `DRAFTS_TAB`. */
  value: string;
  onSelect: (value: string) => void;
  /** The badge for one tab. */
  count: (value: string) => number;
  /** Undefined hides the badge — a screen that has not counted them shows no number, not a 0. */
  draftCount?: number;
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
        {/* ⚠ ONE ROW (owner). Three things were traded to get there, and the order matters:
  
          1. It SCROLLED first — wrong, because four of the eight statuses cannot hold a row yet and are
             on screen precisely so a reader knows they are coming. Scrolling put those four off the
             edge with nothing saying they exist.
          2. Then it WRAPPED — honest, but two rows at laptop width and four on a phone.
          3. Now the four identical marks are ONE mark on the strip. They all pointed at the same
             pending entry, so saying it four times bought nothing but width.

          MEASURED, at the end: one row from 1100px up — every laptop including 1366×768. Two rows at
          1024, four at 360. The single mark shares the strip's row, so it costs back some of the
          ~140px it saved; that is why the break lands at 1100 rather than the 993px of content alone.
  
          ⚠ IT STILL WRAPS ON A PHONE, and that is arithmetic rather than a decision — 993px will never
          fit 360. `flexWrap` stays so the overflow lands as a second row rather than off the edge.
  
          ⚠ A TRIGGER MUST REFUSE TO SHRINK. A flex child shrinks before it wraps, so without
          `flexShrink="0"` the labels squashed into each other instead of moving to the next line. */}
        <Tabs.List flexWrap="wrap" maxW="full" rowGap="1">
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

              {/* A stage the contract cannot hold shows NO COUNT at all. A "0" there is a measurement —
                "no orders are completed" — and this is not one: nothing can ever be. The absence is
                the honest rendering, and the strip's single mark says why. */}
              {stageIsOnTheWire(stage) && (
                <Badge
                  size="xs"
                  variant="subtle"
                  data-testid={`orders-tab-count-${stage.id}`}
                >
                  {count(stage.id)}
                </Badge>
              )}
            </Tabs.Trigger>
          ))}

          {/* DRAFTS IS THE LAST TAB (owner), and selecting it LEAVES — the drafts screen is its own
            route with its own selection and bulk delete. */}
          <Tabs.Trigger
            value={DRAFTS_TAB}
            flexShrink="0"
            whiteSpace="nowrap"
            data-testid={`orders-tab-${DRAFTS_TAB}`}
          >
            {t("orders.tab.drafts")}
            {draftCount !== undefined && (
              <Badge
                size="xs"
                variant="subtle"
                data-testid={`orders-tab-count-${DRAFTS_TAB}`}
              >
                {draftCount}
              </Badge>
            )}
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      {/* ONE MARK FOR THE WHOLE STRIP, not one per empty tab. Four badges saying the same sentence is
          four times the width for no extra information. */}
      <Box flexShrink="0">
        <NotImplemented list={ORDERS_LIST_PENDING} id="statusSet" />
      </Box>
    </Flex>
  );
}
