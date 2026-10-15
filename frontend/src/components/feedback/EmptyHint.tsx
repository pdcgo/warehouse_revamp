import type { ElementType, ReactNode } from "react";
import { EmptyState, Icon, VStack } from "@chakra-ui/react";

export const description =
  "What an empty table or list says instead of a bare line of grey text: an icon for what would be here, a title saying it is empty, a line on why or what to do, and — where there is one — the action that fills it or clears the filter. In a dashed box where the rows would be. Two cases read differently: nothing yet (the subject's icon) and nothing matches (a search-off icon and a Clear Filters). The title keeps the old sentence, so a test that read the line still reads it.";

// AN EMPTY LIST SAYS SO, AND SAYS WHAT NEXT (owner: *"aku ingin table atau list yang kosong ada empty hint atau semacam
// itu, karena yang sekarang terlalu polos"*, `an-empty-list-shows-a-hint`):
//
//   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
//            ( 🏭 )
//      Belum ada pemasok
//      Tambahkan pemasok tempat tim ini membeli stok.
//          [+ Tambah Pemasok]
//   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
//
// Chakra's EmptyState, in the box the rows would fill. `sm` inside a card or a tab, where a tall block would push the
// rest off the screen. It fades in where the rows were (`motion-is-small-quick-and-shared`) — once, when the list
// empties; a refresh that finds it still empty keeps it mounted and still.
export function EmptyHint({
  icon,
  title,
  description,
  action,
  size = "md",
  testId,
}: {
  /** What would be here — the subject's icon; a search-off icon when nothing matches a filter. */
  icon: ElementType;
  /** That it is empty — the sentence the screen said before. */
  title: ReactNode;
  /** Why, or what to do about it. */
  description?: ReactNode;
  /** The action that fills it, or the one that clears the filter. */
  action?: ReactNode;
  size?: "sm" | "md";
  testId?: string;
}) {
  return (
    <EmptyState.Root
      size={size}
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border"
      rounded="l2"
      animationStyle="swap"
      data-testid={testId}
    >
      <EmptyState.Content>
        <EmptyState.Indicator>
          <Icon as={icon} />
        </EmptyState.Indicator>
        <VStack textAlign="center" gap="1">
          <EmptyState.Title>{title}</EmptyState.Title>
          {description && <EmptyState.Description>{description}</EmptyState.Description>}
        </VStack>
        {action}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
