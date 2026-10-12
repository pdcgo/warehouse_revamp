import type { ReactNode } from "react";
import { Stack, Text } from "@chakra-ui/react";

// One labelled read-only fact on a restock detail page, shared by both sides (#105 / #133).
//
// `value` is a ReactNode, not a string: most fields are plain text, but some render a component (the
// courier is a ShippingBadge). An empty string still falls back to the muted "—" every other detail
// page shows; a component decides its own empty state.
export function DetailField({
  label,
  value,
  testId,
}: {
  label: string;
  value: ReactNode;
  testId?: string;
}) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      {/* `lineClamp` caps the HEIGHT; it does nothing about WIDTH — a value with no spaces in it (a
          courier tracking number, an order reference pasted from a marketplace) is one long word, and
          one long word does not wrap. It pushes the grid column wider than its share, and the page
          scrolls sideways. `wordBreak` is what makes it break mid-token; `minW="0"` on the Stack above
          is what lets the column shrink to receive it. */}
      <Text as="div" fontSize="sm" lineClamp={3} wordBreak="break-word" data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}
