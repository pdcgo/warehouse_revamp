import { HStack, Text } from "@chakra-ui/react";
import type { StackProps } from "@chakra-ui/react";

// The brand mark: a minimalist pitched-roof warehouse with a roller door. Line style (stroke,
// currentColor, no fill) so it matches the lucide icons and inherits whatever text colour it sits
// in — no palette is baked in, since the visual identity's accent is still a placeholder. The same
// geometry lives in frontend/public/warehouse.svg (the favicon); keep the two in sync.
export function WarehouseMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 11 12 3l10 8" />
      <path d="M4 11v10h16V11" />
      <path d="M9.5 21v-6.5h5V21" />
      <path d="M9.5 17h5" />
      <path d="M9.5 19h5" />
    </svg>
  );
}

// Logo is the mark plus the "PDC Warehouse" wordmark, laid out horizontally. Pass showWordmark
// false for a mark-only usage (e.g. a collapsed sidebar).
export function Logo({
  size = 24,
  showWordmark = true,
  ...rest
}: { size?: number; showWordmark?: boolean } & StackProps) {
  return (
    <HStack gap="2.5" {...rest}>
      <WarehouseMark size={size} />
      {showWordmark && (
        <Text fontSize="lg" fontWeight="semibold" letterSpacing="tight" lineHeight="1">
          PDC Warehouse
        </Text>
      )}
    </HStack>
  );
}
