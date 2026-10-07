import type { ReactNode } from "react";
import { Box, HStack, Icon, IconButton } from "@chakra-ui/react";
import { Menu, X } from "lucide-react";
import { useSidebar } from "./SidebarContext";

// The ids the slot components below portal into. Exported so a caller cannot mistype one and get a
// silently-empty top bar.
export const TOPBAR_LEFT_SLOT = "legacy-topbar-left";
export const TOPBAR_RIGHT_SLOT = "legacy-topbar-right";

export const description =
  "The mobile top bar: a hamburger that morphs to a close icon, the brand, and two portal slots a page fills with its own actions.";

export interface MobileTopbarProps {
  logo?: ReactNode;
  // Hide the menu button — for a screen that is a step in a flow rather than a destination (a
  // scanning session), where opening the nav mid-task is not something to offer.
  hideMenu?: boolean;
}

export function MobileTopbar({ logo, hideMenu }: MobileTopbarProps) {
  const sidebar = useSidebar();
  const expanded = sidebar?.expanded ?? false;

  return (
    <HStack
      hideFrom="md"
      position="sticky"
      top="0"
      zIndex="docked"
      w="full"
      px="2"
      py="1.5"
      gap="2"
      justify="space-between"
      bg="bg"
      borderBottomWidth="1px"
      data-testid="mobile-topbar"
    >
      <HStack flex="1" justify="flex-start" gap="1.5" minW="0">
        {!hideMenu && (
          <IconButton
            size="sm"
            variant="ghost"
            onClick={sidebar?.toggleExpanded}
            aria-label={expanded ? "Close menu" : "Open menu"}
            aria-expanded={expanded}
            data-testid="topbar-menu"
          >
            {/* One control, two icons — NOT two buttons. The button is the same target before and
                after, so a second tap closes what the first opened without the target moving. */}
            <Icon as={expanded ? X : Menu} boxSize="5" />
          </IconButton>
        )}

        {/* Portal targets. A page mounts its own actions here through TopbarSlot, so the bar does
            not need to know about every screen that might want a button in it. */}
        <Box id={TOPBAR_LEFT_SLOT} display="flex" alignItems="center" gap="1.5" minW="0" />
      </HStack>

      {logo}

      <HStack id={TOPBAR_RIGHT_SLOT} flex="1" justify="flex-end" gap="1.5" minW="0" />
    </HStack>
  );
}
