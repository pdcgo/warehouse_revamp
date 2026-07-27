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
      <Text as="div" fontSize="sm" lineClamp={3} data-testid={testId}>
        {value || "—"}
      </Text>
    </Stack>
  );
}
