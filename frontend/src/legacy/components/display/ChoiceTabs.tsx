import type { ElementType, ReactNode } from "react";
import { Button, Group, Icon } from "@chakra-ui/react";

export interface ChoiceTabItem<T> {
  value: T;
  name: ReactNode;
  icon?: ElementType;
  disabled?: boolean;
  hidden?: boolean;
  // A count or a total shown after the name — "Unpaid 12". Worth having as its own field rather than
  // baked into `name`, because it is what makes a tab worth clicking.
  badge?: ReactNode;
}

// ChoiceTabs is a row of tabs used as a VALUE PICKER — a filter, not navigation.
//
// It is deliberately separate from `NavTabs`. They look similar and mean opposite things:
//
//   NavTabs     — each tab is a PLACE. It has a URL, it is linkable and shareable, and the back
//                 button moves between them.
//   ChoiceTabs  — each tab is a VALUE handed to the screen you are already on. "Show me the unpaid
//                 ones." No URL, no history entry.
//
// Using navigation tabs for a filter puts a history entry behind every filter click, so backing out
// of a screen means clicking back once per filter you tried. Using choice tabs for navigation makes
// a page nobody can link to.
//
// `clearable` allows the selected tab to be clicked OFF, back to no filter. That is only coherent
// for a filter — which is another reason the two components are separate.
export const description =
  "A row of tabs used as a value picker (a filter), not as navigation — no URL and no history entry. Optionally clearable, so the filter can be turned off.";

export interface ChoiceTabsProps<T> {
  value?: T;
  items: Array<ChoiceTabItem<T>>;
  onChange?(value?: T): void;
  // Let a click on the ACTIVE tab clear the selection. Only meaningful for a filter — see above.
  clearable?: boolean;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
}

export function ChoiceTabs<T>({
  value,
  items,
  onChange,
  clearable,
  disabled,
  size = "sm",
}: ChoiceTabsProps<T>) {
  return (
    <Group attached={false} gap="1" overflowX="auto" data-testid="choice-tabs">
      {items
        .filter((i) => !i.hidden)
        .map((item, i) => {
          const selected = item.value === value;

          return (
            <Button
              key={i}
              size={size}
              // Selected reads as filled, unselected as quiet. A row of equally-weighted buttons
              // does not say which filter is currently applied.
              variant={selected ? "subtle" : "ghost"}
              colorPalette={selected ? "brand" : "gray"}
              disabled={disabled || item.disabled}
              aria-pressed={selected}
              data-testid={`choice-tab-${String(item.value)}`}
              onClick={() => {
                // Clicking the active tab clears it when clearable, and otherwise does nothing —
                // re-emitting the value it already has would make every list refetch for no change.
                if (selected) {
                  if (clearable) onChange?.(undefined);
                  return;
                }

                onChange?.(item.value);
              }}
            >
              {item.icon && <Icon as={item.icon} boxSize="3.5" />}
              {item.name}
              {item.badge}
            </Button>
          );
        })}
    </Group>
  );
}
