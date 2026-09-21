import type { ElementType, ReactNode } from "react";
import { HStack, Icon, Text, Wrap } from "@chakra-ui/react";
import { Tooltip } from "../feedback/Tooltip";

export interface ListSummaryItem {
  icon?: ElementType;
  content: ReactNode;
  // Explains what the figure IS. Worth passing on anything an icon alone cannot name — see below.
  tooltip?: string;
  hidden?: boolean;
}

// ListSummary is the quiet line of facts under a row's title: "12 items · Rp 4,2jt · 2 days ago".
//
// It is the pattern that keeps a list scannable. A row needs a headline (the product, the order, the
// team) plus three or four supporting figures, and giving each of those its own column produces a
// table too wide to read on a phone and mostly empty on a desktop. Collapsing them into one wrapping
// line keeps the row one line tall when it fits and degrades gracefully when it does not.
//
// ⚠ AN ICON IS NOT A LABEL. "📦 12" is only legible to someone who already knows the row's shape, so
// each item takes a `tooltip` naming the figure. Without it the line is a row of numbers whose
// meaning has to be learned rather than read — which is precisely the failure mode of dense summary
// lines everywhere.
export const description =
  "The quiet wrapping line of supporting facts under a row's title — icon + value, each naming itself on hover, so a list stays one line tall without becoming a row of unlabelled numbers.";

export interface ListSummaryProps {
  items: ListSummaryItem[];
  size?: "sm" | "md";
  // Put a separator between items. Useful when the values are all numbers and would otherwise run
  // together at a glance.
  separated?: boolean;
}

export function ListSummary({ items, size = "md", separated }: ListSummaryProps) {
  const shown = items.filter((i) => !i.hidden);

  return (
    <Wrap
      gap={size === "sm" ? "1" : "2"}
      fontSize={size === "sm" ? "xs" : "sm"}
      color="fg.muted"
      data-testid="list-summary"
    >
      {shown.map((item, i) => (
        <HStack key={i} gap="1">
          {separated && i > 0 && (
            <Text aria-hidden color="fg.subtle">
              ·
            </Text>
          )}

          <Tooltip content={item.tooltip}>
            <HStack gap="1" data-testid="list-summary-item">
              {item.icon && <Icon as={item.icon} boxSize="3" flexShrink="0" />}
              {item.content}
            </HStack>
          </Tooltip>
        </HStack>
      ))}
    </Wrap>
  );
}
