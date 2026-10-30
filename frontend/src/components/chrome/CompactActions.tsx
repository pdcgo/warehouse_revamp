import type { ElementType, ReactNode } from "react";
import { HStack, Icon, IconButton, Menu, Portal } from "@chakra-ui/react";
import { MoreHorizontal } from "lucide-react";

export const description =
  "A page header's actions on a phone: each one an ICON (its name the button's label), and past two, one ⋯ menu holding all of them with their names. The page's committing action is the brand fill, a destructive one red; a ⚠ mark sits beside its icon, or at the end of its menu line. The desktop keeps its labelled buttons — this is the phone's drawing of the same actions.";

/** How many icons a phone header holds before the actions fold into ⋯. */
export const COMPACT_LIMIT = 2;

export interface CompactAction {
  /** Stable key, and the menu item's value. */
  id: string;
  /** The action's name — the icon's label (spoken, and shown on a long press), the menu line's text. */
  label: string;
  icon: ElementType;
  onClick?: () => void;
  /** The page's one committing action ("New Order") — the brand fill. */
  primary?: boolean;
  /** Destructive ("Delete") — red. */
  danger?: boolean;
  /** A ⚠ mark (`NotImplemented`) — beside the icon, or at the end of the menu line. */
  mark?: ReactNode;
  /** The test id the desktop button carries, so a test finds the action on both. */
  testId?: string;
  disabled?: boolean;
}

// A PHONE'S HEADER ACTIONS ARE ICONS, AND PAST TWO THEY FOLD (owner: *"di mobile, action di atas itu sangat memakan
// tempat … munculkan icon saja sesuai actionnya dan jika lebih dari dua di situ pakai elipsis"*,
// `a-phone-header-action-is-an-icon`):
//
//   one or two                         three or more
//   Akun Keuangan        [⬇] [＋]      Pesanan                     [⋯]
//                                                                   ├ ⬇  Ekspor ⚠1
//                                                                   ├ ⬆  Impor ⚠2
//                                                                   └ ＋ Pesanan Baru
//
// A labelled button was what wrapped a phone header onto rows of its own. Two icons stay on the title's row and are
// still one tap; a third would crowd the title, so all of them go behind ⋯ with their names — never two icons and a
// menu of one.
export function CompactActions({
  actions,
  menuLabel,
  menuTestId,
}: {
  /** In reading order; a falsy entry (an action this person may not take) is left out. */
  actions: (CompactAction | false | null | undefined)[];
  /** The ⋯ button's label, said aloud — "Actions". */
  menuLabel: string;
  menuTestId?: string;
}) {
  const shown = actions.filter((action): action is CompactAction => Boolean(action));
  if (shown.length === 0) return null;

  if (shown.length <= COMPACT_LIMIT) {
    return (
      <HStack gap="1.5" flexShrink={0}>
        {shown.map((action) => (
          <HStack key={action.id} gap="0.5">
            <IconButton
              size="sm"
              variant={action.primary ? "solid" : "outline"}
              colorPalette={action.primary ? "brand" : action.danger ? "error" : "gray"}
              aria-label={action.label}
              title={action.label}
              disabled={action.disabled}
              data-testid={action.testId}
              onClick={action.onClick}
            >
              <Icon as={action.icon} boxSize="4" />
            </IconButton>
            {action.mark}
          </HStack>
        ))}
      </HStack>
    );
  }

  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <IconButton size="sm" variant="outline" colorPalette="gray" aria-label={menuLabel} flexShrink={0} data-testid={menuTestId}>
          <Icon as={MoreHorizontal} boxSize="4" />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            {shown.map((action) => (
              <Menu.Item
                key={action.id}
                value={action.id}
                color={action.danger ? "fg.error" : undefined}
                disabled={action.disabled}
                data-testid={action.testId}
                // A disabled item's DOM click still fires — the menu only skips SELECTING it — so it gets no handler.
                onClick={action.disabled ? undefined : action.onClick}
              >
                <Icon as={action.icon} boxSize="4" />
                {action.label}
                {action.mark}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
