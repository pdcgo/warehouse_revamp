import type { ElementType, ReactNode } from "react";
import { EmptyState, Icon, VStack } from "@chakra-ui/react";
import { Inbox } from "lucide-react";

// EmptyHint is what a list shows when it has nothing to show.
//
// An empty table with no message is the single most confusing state in an operator tool, because the
// three things it could mean are indistinguishable: the filter excluded everything, the data has not
// loaded, or there genuinely is nothing here. All three look like a blank rectangle, and the reader's
// next move is different for each — widen the filter, wait, or go create something.
//
// So this component makes the caller SAY which one it is. The `title` names the state and the
// children say what to do about it; both are optional in the type, but a screen that passes neither
// has re-created the blank rectangle.
export const description =
  "The empty state for a list — an icon, a title naming WHY it is empty, and what to do next. An empty table with no message is indistinguishable from a broken one.";

export interface EmptyHintProps {
  // A lucide component. Defaults to an inbox — replace it whenever the screen has a more specific
  // subject, since a matching icon is the fastest read of what is missing.
  icon?: ElementType;
  // What state this is: "No orders yet", "No results for this filter".
  title?: string;
  // What to do about it — a sentence, or an action.
  children?: ReactNode;
}

export function EmptyHint({ icon = Inbox, title, children }: EmptyHintProps) {
  return (
    <EmptyState.Root size="sm" data-testid="empty-hint">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <Icon as={icon} />
        </EmptyState.Indicator>

        <VStack textAlign="center" gap="1">
          {title && <EmptyState.Title>{title}</EmptyState.Title>}
          {children && <EmptyState.Description>{children}</EmptyState.Description>}
        </VStack>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
