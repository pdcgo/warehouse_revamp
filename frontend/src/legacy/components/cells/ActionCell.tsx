import type { ElementType } from "react";
import { HStack, Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { MoreHorizontal } from "lucide-react";
import { Tooltip } from "../feedback/Tooltip";
import { palette, type Tone } from "../tone";

export interface ActionCellItem {
  title: string;
  icon: ElementType;
  tone?: Tone;
  hidden?: boolean;
  disabled?: boolean;
  onAction?(): void;
}

// How many actions may stay inline before they collapse into an overflow menu.
//
// ⚠ This is the app's rule, not a preference (CLAUDE.md): roughly three or more row actions go
// behind a single kebab. A row of five icon buttons repeated down forty rows is two hundred targets
// competing with the data the table exists to show, and on a phone it is wider than the row.
const INLINE_LIMIT = 2;

// ActionCell is the actions column of a table row.
//
// It makes the inline-versus-menu decision ONCE, from the number of visible actions, rather than
// leaving each screen to guess. That is the whole value: left to call sites, one table shows three
// buttons and the next shows a kebab for the same three, and the reader has to learn each table
// separately.
//
// Every menu item carries a leading icon, and every inline button keeps its title as an accessible
// name with a tooltip — an icon-only button with no name is unusable by anyone not already familiar
// with the glyph.
export const description =
  "The row-actions column: up to two actions inline, three or more collapsed behind one overflow menu — the decision made once here rather than guessed per table.";

export interface ActionCellProps {
  items: ActionCellItem[];
}

export function ActionCell({ items }: ActionCellProps) {
  const shown = items.filter((i) => !i.hidden);

  if (shown.length === 0) return null;

  if (shown.length <= INLINE_LIMIT) {
    return (
      <HStack gap="1" justify="flex-end" data-testid="action-cell" data-mode="inline">
        {shown.map((item) => (
          <Tooltip key={item.title} content={item.title}>
            <IconButton
              size="xs"
              variant="ghost"
              colorPalette={palette(item.tone, "plain")}
              disabled={item.disabled}
              aria-label={item.title}
              data-testid={`action-${item.title}`}
              onClick={(e) => {
                // Rows are links; an action must not also open the row it sits in.
                e.preventDefault();
                e.stopPropagation();
                item.onAction?.();
              }}
            >
              <Icon as={item.icon} boxSize="4" />
            </IconButton>
          </Tooltip>
        ))}
      </HStack>
    );
  }

  return (
    <HStack justify="flex-end" data-testid="action-cell" data-mode="menu">
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label="Actions"
            data-testid="action-menu-trigger"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon as={MoreHorizontal} boxSize="4" />
          </IconButton>
        </Menu.Trigger>

        <Portal>
          <Menu.Positioner>
            <Menu.Content>
              {shown.map((item) => (
                <Menu.Item
                  key={item.title}
                  value={item.title}
                  disabled={item.disabled}
                  color={item.tone === "error" ? "fg.error" : undefined}
                  data-testid={`action-${item.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onAction?.();
                  }}
                >
                  {/* Every menu item carries a leading icon — the app's menu rule. */}
                  <Icon as={item.icon} boxSize="4" />
                  {item.title}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    </HStack>
  );
}
